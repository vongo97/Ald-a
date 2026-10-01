/**
 * Almacenamiento del perfil de usuario.
 *
 * Local: localStorage (objeto pequeño, un solo registro).
 * Sync: se sube tal cual (JSON en texto) a Supabase, protegido por RLS.
 *
 * ─── ¿POR QUÉ NO HAY CIFRADO? ────────────────────────────────────────────────
 * Hasta la migración 0008 esto "cifraba" con AES-GCM derivando la clave de
 * `${userId}:${SALT}`. Como `userId` es la clave primaria de la tabla y el
 * salt está en este mismo archivo, cualquiera con un dump podía descifrarlo:
 * no aportaba confidencialidad, solo la apariencia de tenerla.
 *
 * El perfil son horas de sueño, cronotipo y rutina: es MENOS sensible que las
 * tareas, que ya viven en texto plano bajo RLS. Cifrar solo el perfil era
 * incoherente. La frontera de confianza es RLS (`id = auth.uid()`), igual que
 * en `tasks`, `projects` y `tombstones`. Si algún día hace falta
 * confidencialidad real frente al servidor, habrá que cifrar TODO (tareas
 * incluidas) con una clave que el servidor no conozca — ver el historial de
 * la conversación sobre las opciones con passphrase.
 */
import { supabase } from "./supabase";
import type { UserProfile } from "@/domain/profile";

const LOCAL_KEY = "ald-a:profile";

// ─── LOCAL ────────────────────────────────────────────────────────────────────

export function loadProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export function saveProfile(profile: UserProfile): void {
  profile.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(profile));
  } catch {
    // storage no disponible: se queda solo en memoria
  }
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    // ignore
  }
}

// ─── SYNC SUPABASE ───────────────────────────────────────────────────────────
//
// Tabla `user_profiles` (migración 0006, columna renombrada en 0008):
//   id uuid PK → auth.users(id), data text, updated_at timestamptz

async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Sube el perfil (JSON claro) a Supabase. */
export async function pushProfile(): Promise<{ ok: boolean; error?: string }> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "No hay sesión de Supabase activa" };

  const profile = loadProfile();
  if (!profile) return { ok: false, error: "No hay perfil guardado localmente" };

  try {
    const { error } = await supabase
      .from("user_profiles")
      .upsert({
        id: userId,
        data: JSON.stringify(profile),
        updated_at: profile.updatedAt,
      });

    if (error) {
      if (error.code === "42P01" || error.message?.includes("does not exist")) {
        return { ok: false, error: "Tabla user_profiles no existe — ejecuta la migración 0006 en Supabase" };
      }
      if (error.code === "42703" || /column .*encrypted|column .*data/i.test(error.message ?? "")) {
        return { ok: false, error: "Falta la columna `data` — ejecuta la migración 0008 en Supabase" };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Baja el perfil desde Supabase y lo guarda local si es más reciente.
 *
 * Las filas anteriores a la migración 0008 contienen base64 de AES-GCM, que
 * no es JSON válido: `JSON.parse` falla y se devuelve null en vez de romper.
 * El siguiente `pushProfile` sobrescribe esa fila con texto plano.
 */
export async function pullProfile(): Promise<UserProfile | null> {
  const userId = await getUserId();
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("data, updated_at")
      .eq("id", userId)
      .single();

    if (error || !data?.data) return null;

    let remote: UserProfile;
    try {
      remote = JSON.parse(data.data) as UserProfile;
    } catch {
      // Fila heredada (AES-GCM de 0006) o dato corrupto: se ignora sin ruido.
      return null;
    }

    // Guardar solo si es más reciente que lo local
    const local = loadProfile();
    if (!local || new Date(remote.updatedAt) > new Date(local.updatedAt)) {
      saveProfile(remote);
      return remote;
    }
    return local;
  } catch {
    return null;
  }
}

/**
 * Sincronización manual del perfil: **pull primero, luego push**.
 *
 * El orden importa y es el CONTRARIO al de las tareas. El perfil es una sola
 * fila con política «gana el más reciente», y `pushProfile` no compara fechas:
 * si subiéramos primero, pisaríamos en la nube un perfil más nuevo que el
 * local. Bajando primero (solo adopta el remoto si es más reciente) y subiendo
 * después, lo que se sube ya es el ganador real.
 */
export async function syncProfile(): Promise<{ ok: boolean; error?: string }> {
  await pullProfile();
  return pushProfile();
}
