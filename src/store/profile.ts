/**
 * Almacenamiento del perfil de usuario.
 *
 * Local: localStorage (objeto pequeño, un solo registro).
 * Sync: cifrado con AES-GCM antes de subir a Supabase.
 *
 * La clave de cifrado se deriva del user_id de Supabase + un salt fijo.
 * Sin sesión no hay sync, solo local.
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

// ─── CIFRADO AES-GCM ─────────────────────────────────────────────────────────

const SALT = "ald-a-profile-v1";

/** Deriva una clave AES a partir del user_id de Supabase. */
async function deriveKey(userId: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(`${userId}:${SALT}`),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(SALT),
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Cifra el perfil para sync seguro. */
async function encryptProfile(profile: UserProfile, userId: string): Promise<string> {
  const key = await deriveKey(userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(profile));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  // Combinar iv + ciphertext en un solo base64
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

/** Descifra el perfil desde Supabase. */
async function decryptProfile(encoded: string, userId: string): Promise<UserProfile | null> {
  try {
    const key = await deriveKey(userId);
    const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(decrypted)) as UserProfile;
  } catch {
    return null;
  }
}

// ─── SYNC SUPABASE ───────────────────────────────────────────────────────────

async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/**
 * Sube el perfil cifrado a Supabase.
 * Tabla necesaria: user_profiles (id uuid PK, encrypted text, updated_at timestamptz)
 */
export async function pushProfile(): Promise<boolean> {
  const userId = await getUserId();
  const profile = loadProfile();
  if (!userId || !profile) return false;

  try {
    const encrypted = await encryptProfile(profile, userId);
    const { error } = await supabase
      .from("user_profiles")
      .upsert({
        id: userId,
        encrypted,
        updated_at: profile.updatedAt,
      });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Descarga y descifra el perfil desde Supabase.
 * Si existe en la nube, lo guarda localmente.
 */
export async function pullProfile(): Promise<UserProfile | null> {
  const userId = await getUserId();
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("encrypted, updated_at")
      .eq("id", userId)
      .single();

    if (error || !data?.encrypted) return null;

    const remote = await decryptProfile(data.encrypted, userId);
    if (!remote) return null;

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

/** Push + pull del perfil (una sola llamada desde el flujo de sync). */
export async function syncProfile(): Promise<void> {
  await pushProfile();
  await pullProfile();
}
