import { useState } from "react";
import { useSettings } from "@/store/SettingsContext";
import { useStore } from "@/store/useStore";
import { chat, llmStatus } from "@/llm/client";
import type { Settings } from "@/domain/types";
import { useInstallPrompt } from "@/notifications/useInstallPrompt";
import {
  notificationsSupported,
  notifPermission,
  requestNotifPermission,
} from "@/notifications/notifier";
import { exportDataToJSON, importDataFromJSON } from "@/store/sync";
import { supabase } from "@/store/supabase";
import { THEMES } from "@/store/themes";
import { loadProfile, clearProfile, syncProfile } from "@/store/profile";
import { PROFILE_QUESTIONS, type UserProfile } from "@/domain/profile";
import ProfileQuestionnaire from "@/components/ProfileQuestionnaire";
import WeekStrip from "@/components/WeekStrip";

export default function SettingsView() {
  const { settings, saveSettings } = useSettings();
  const pushToast = useStore((s) => s.pushToast);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const [draft, setDraft] = useState<Settings>(settings);
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<{value: string, label: string}[]>([]);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showCustomModel, setShowCustomModel] = useState(false);
  const { canInstall, installed, install } = useInstallPrompt();
  const [notifStatus, setNotifStatus] = useState(notificationsSupported() ? notifPermission() : "unsupported");
  
  // Auth states
  const [authLoading, setAuthLoading] = useState(false);
  const session = useStore((s) => s.session);
  const loadSession = useStore((s) => s.loadSession);

  const standardModels: Record<Settings["provider"], { value: string; label: string }[]> = {
    gemini: [
      { value: "", label: "gemini-3.8-flash (Por defecto, Recomendado)" },
      { value: "gemini-3.8-flash", label: "gemini-3.8-flash" },
      { value: "gemini-3.1-pro", label: "gemini-3.1-pro (Avanzado)" },
      { value: "gemini-3.5-flash-lite", label: "gemini-3.5-flash-lite (Rápido y económico)" },
    ],
    openai: [
      { value: "", label: "gpt-6-luna (Por defecto)" },
      { value: "gpt-6-astra", label: "gpt-6-astra (OpenAI)" },
      { value: "gpt-6-sol", label: "gpt-6-sol (OpenAI)" },
      { value: "gpt-6-luna", label: "gpt-6-luna (OpenAI)" },
    ],
    groq: [
      // Usar "⬇️ Cargar modelos" para obtener la lista exacta de tu cuenta
      { value: "", label: "openai/gpt-oss-20b (Por defecto)" },
      { value: "openai/gpt-oss-20b", label: "openai/gpt-oss-20b (Rápido)" },
      { value: "openai/gpt-oss-120b", label: "openai/gpt-oss-120b (Potente)" },
      { value: "qwen/qwen3.8-27b", label: "qwen/qwen3.8-27b" },
      { value: "meta-llama/llama-4-maverick-17b-128e-instruct", label: "llama-4-maverick-17b" },
    ],
    anthropic: [
      { value: "", label: "claude-haiku-4.5 (Por defecto)" },
      { value: "claude-sonnet-5", label: "claude-sonnet-5" },
      { value: "claude-opus-5.5", label: "claude-opus-5.5" },
      { value: "claude-fable-5.1", label: "claude-fable-5.1" },
    ]
  };

  const status = llmStatus(draft);

  const testConnection = async () => {
    if (!draft.apiKey.trim()) {
      setTestResult({ ok: false, msg: "Introduce una clave API para probar." });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await chat(
        { settings: draft },
        { system: "Eres un asistente.", user: "Responde solo con la palabra 'OK'." },
      );
      if (res.ok) {
        setTestResult({ ok: true, msg: "¡Conexión exitosa con la IA!" });
        pushToast("Conexión con IA exitosa");
      } else {
        setTestResult({ ok: false, msg: `Error: ${res.error ?? "No se pudo conectar"}` });
      }
    } catch (err) {
      setTestResult({ ok: false, msg: `Excepción: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setTesting(false);
    }
  };

  const loadModels = async () => {
    if (!draft.apiKey.trim()) {
      pushToast("Ingresa tu clave API primero");
      return;
    }
    setFetchingModels(true);
    try {
      let url = "";
      let headers: HeadersInit = {};
      
      if (draft.provider === "gemini") {
        url = "https://generativelanguage.googleapis.com/v1beta/models";
        headers = { "x-goog-api-key": draft.apiKey };
      } else if (draft.provider === "groq") {
        url = "https://api.groq.com/openai/v1/models";
        headers = { Authorization: `Bearer ${draft.apiKey}` };
      } else if (draft.provider === "anthropic") {
        url = "https://api.anthropic.com/v1/models";
        headers = { "x-api-key": draft.apiKey, "anthropic-version": "2023-06-01" };
      } else {
        const base = draft.baseUrl.trim().replace(/\/chat\/completions$/, "").replace(/\/$/, "");
        url = (base || "https://api.openai.com/v1") + "/models";
        headers = { Authorization: `Bearer ${draft.apiKey}` };
      }

      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      let models: string[] = [];
      if (draft.provider === "gemini") {
        models = (data.models || []).map((m: any) => m.name.replace("models/", ""));
      } else {
        models = (data.data || []).map((m: any) => m.id);
      }

      if (models.length > 0) {
        setFetchedModels(models.map(m => ({ value: m, label: m + " (API)" })));
        setDraft(d => ({ ...d, model: models[0] }));
        pushToast(`Se detectaron ${models.length} modelos`);
      } else {
        pushToast("El proveedor no devolvió modelos");
      }
    } catch (err) {
      pushToast("Error al cargar modelos: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setFetchingModels(false);
    }
  };

  const currentModels = Array.from(new Map([...standardModels[draft.provider], ...fetchedModels].map(m => [m.value, m])).values());

  return (
    <section className="max-w-xl">
      <header className="mb-3">
        <h1 className="font-display text-2xl font-semibold">Ajustes</h1>
      </header>

      <div className={`card mb-4 p-3 text-sm ${status === "active" ? "border-emerald-500/40 light:border-emerald-300 bg-emerald-500/10 light:bg-emerald-50 text-emerald-200 light:text-emerald-700" : "border-theme bg-surface text-primary"}`}>
        {status === "active"
          ? "✨ IA activa: desglose con LLM y planes sugeridos por el modelo."
          : "🧩 IA desactivada (modo local): las plantillas y scores funcionan sin red."}
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          saveSettings(draft);
          pushToast("Ajustes guardados correctamente");
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Proveedor</span>
          <select
            className="input"
            value={draft.provider}
            onChange={(e) => {
              setDraft({ ...draft, provider: e.target.value as Settings["provider"], model: "", baseUrl: "" });
              setShowCustomModel(false);
            }}
          >
            <option value="gemini">Google Gemini (Gratis en AI Studio - Recomendado)</option>
            <option value="groq">Groq (Rápido, Gratuito - Modelos Llama)</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI compatible (ChatGPT / OpenRouter / Ollama)</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-muted">
            Clave API {draft.provider === "gemini" && "(Obtén una gratis en aistudio.google.com)"}
          </span>
          <input
            className="input"
            type="password"
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            placeholder={
              draft.provider === "gemini"
                ? "AIzaSy… (Google AI Studio)"
                : draft.provider === "groq"
                ? "gsk_…"
                : draft.provider === "anthropic"
                ? "sk-ant-…"
                : "sk-…"
            }
            autoComplete="off"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-muted">Modelo</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              className="input flex-1"
              value={(!currentModels.some(m => m.value === draft.model) || showCustomModel) ? "custom" : draft.model}
              onChange={(e) => {
                if (e.target.value === "custom") {
                  setShowCustomModel(true);
                } else {
                  setShowCustomModel(false);
                  setDraft({ ...draft, model: e.target.value });
                }
              }}
            >
              {currentModels.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
              <option value="custom">Otro (Introducir manual)...</option>
            </select>
            {(!currentModels.some(m => m.value === draft.model) || showCustomModel) && (
              <input
                className="input flex-1"
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                placeholder="Ej: nombre-del-modelo"
              />
            )}
          </div>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-muted">URL base (opcional, para proxys compatibles)</span>
          <input
            className="input"
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            placeholder={
              draft.provider === "gemini"
                ? "https://generativelanguage.googleapis.com/..."
                : draft.provider === "groq"
                ? "https://api.groq.com/openai/v1/chat/completions (Automático)"
                : "https://mi-proxy.example.com/v1/chat/completions"
            }
          />
        </label>

        {testResult && (
          <div
            className={`rounded-lg p-2.5 text-xs ${
              testResult.ok
                ? "border border-emerald-500/40 light:border-emerald-300 bg-emerald-500/10 light:bg-emerald-50 text-emerald-300 light:text-emerald-600"
                : "border border-rose-500/40 light:border-rose-300 bg-rose-500/10 light:bg-rose-50 text-rose-300 light:text-rose-600"
            }`}
          >
            {testResult.msg}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button type="submit" className="btn-primary">
            Guardar
          </button>
          <button
            type="button"
            className="btn-ghost text-sky-400 light:text-sky-600"
            disabled={fetchingModels || !draft.apiKey.trim()}
            onClick={() => void loadModels()}
          >
            {fetchingModels ? "Cargando..." : "⬇️ Cargar modelos"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={testing || !draft.apiKey.trim()}
            onClick={() => void testConnection()}
          >
            {testing ? "Probando..." : "🔌 Probar conexión"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              const reset: Settings = { provider: "openai", apiKey: "", model: "", baseUrl: "", supabaseUrl: "", supabaseAnonKey: "" };
              setDraft(reset);
              saveSettings(reset);
              setTestResult(null);
              pushToast("Clave y ajustes eliminados");
            }}
          >
            Borrar clave
          </button>
        </div>
      </form>

      <div className="mt-5 space-y-2 text-xs text-muted">
        <p>
          💡 <span className="font-semibold text-primary">Recomendación gratuita:</span> Google ofrece una capa gratuita muy generosa en{" "}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-400 light:text-sky-600 underline hover:text-sky-300 hover:light:text-sky-600"
          >
            Google AI Studio
          </a>{" "}
          para el modelo <code>gemini-3.8-flash</code> sin requerir tarjeta de crédito para pruebas estándar.
        </p>
        <p className="text-muted">
          Otras opciones: seleccionando «OpenAI compatible» puedes conectar servicios como{" "}
          <span className="text-primary">OpenRouter</span> o{" "}
          <span className="text-primary">Ollama</span> para correr modelos 100% locales y privados en tu máquina usando el campo de URL base.
        </p>
      </div>

      {/* ── Sección Mi Perfil ── */}
      <div className="mt-6 rounded-xl border border-theme bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-primary">👤 Mi Perfil</h2>
        <p className="mb-3 text-xs text-muted">
          La IA lee tu perfil para personalizar horarios y recomendaciones.
        </p>
        <ProfileSettingsSection />
      </div>

      {/* ── Sección Apariencia ── */}
      <div className="mt-6 rounded-xl border border-theme bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-primary">🎨 Apariencia</h2>
        <p className="mb-3 text-xs text-muted">
          Elige la identidad visual de la app. Cada tema cambia colores, tipografía y efectos.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tema visual">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={theme === t.id}
              onClick={() => setTheme(t.id)}
              className={`flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all duration-150 ${
                theme === t.id
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-md"
                  : "border-theme hover:border-theme "
              }`}
            >
              {/* Preview de colores */}
              <span className="flex w-full items-center gap-1.5">
                <span
                  className="h-5 w-5 rounded-md border border-black/20"
                  style={{ backgroundColor: t.swatch }}
                  aria-hidden
                />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                  {t.mode === "dark" ? "🌙" : "☀️"} {t.mode}
                </span>
              </span>
              <span className="text-sm font-semibold text-primary">
                {t.label}
              </span>
              <span className="text-[11px] leading-tight text-muted">
                {t.blurb}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Sección App & Notificaciones ── */}
      <div className="mt-6 rounded-xl border border-theme bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-primary">📲 App &amp; Notificaciones</h2>
        <div className="space-y-3">

          {/* Instalar como app */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-primary">Instalar como app de escritorio</p>
              <p className="text-xs text-muted">
                {installed
                  ? "✅ App instalada. Puedes configurarla para abrirse al iniciar Windows."
                  : "Instala la app para usarla sin el navegador y configurar inicio automático con Windows."}
              </p>
            </div>
            {!installed && (
              <button
                type="button"
                className={`btn-ghost shrink-0 text-xs ${
                  canInstall ? "text-sky-400 light:text-sky-600" : "cursor-not-allowed text-muted"
                }`}
                disabled={!canInstall}
                onClick={() => void install()}
                title={canInstall ? "Instalar app" : "Abre la app en Chrome o Edge para poder instalarla"}
              >
                {canInstall ? "⬇️ Instalar" : "No disponible"}
              </button>
            )}
          </div>

          {/* Notificaciones */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-primary">Notificaciones de bloques de tiempo</p>
              <p className="text-xs text-muted">
                {notifStatus === "granted"
                  ? "✅ Activadas. Recibirás alertas 5 min antes y al inicio de cada bloque."
                  : notifStatus === "denied"
                  ? "❌ Bloqueadas. Actívalas en la configuración del navegador."
                  : notifStatus === "unsupported"
                  ? "Tu navegador no soporta notificaciones."
                  : "Actívalas para recibir alertas de tus bloques de tiempo."}
              </p>
            </div>
            {notifStatus === "default" && (
              <button
                type="button"
                className="btn-ghost shrink-0 text-xs text-sky-400 light:text-sky-600"
                onClick={async () => {
                  const granted = await requestNotifPermission();
                  setNotifStatus(granted ? "granted" : "denied");
                  pushToast(granted ? "Notificaciones activadas ✅" : "Permiso denegado");
                }}
              >
                🔔 Activar
              </button>
            )}
          </div>

        </div>
      </div>

      {/* ── Sección Sincronización & Backup ── */}
      <div className="mt-6 rounded-xl border border-theme bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-primary">💾 Backup &amp; Sincronización</h2>
        
        {/* Backup Local JSON */}
        <div className="mb-6 space-y-2">
          <p className="text-xs font-medium text-primary">Backup Local (Sin nube)</p>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => void exportDataToJSON()}>
              ⬇️ Exportar JSON
            </button>
            <label className="btn-ghost cursor-pointer text-xs">
              ⬆️ Importar JSON
              <input 
                type="file" 
                accept=".json" 
                className="hidden" 
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (confirm("Al importar se reemplazarán TODAS las tareas actuales. ¿Continuar?")) {
                    importDataFromJSON(file).then(() => {
                      pushToast("Datos importados con éxito");
                      setTimeout(() => window.location.reload(), 1000);
                    }).catch(err => pushToast(`Error: ${err.message}`));
                  }
                }} 
              />
            </label>
          </div>
        </div>

        {/* Sincronización en la Nube (Automática) */}
        <div className="space-y-3 pt-4 border-t border-theme mt-4">
          <p className="text-xs font-medium text-primary">Nube & Multi-dispositivo</p>
          
          {session ? (
            <div className="rounded-lg bg-emerald-500/10 light:bg-emerald-50 p-3 border border-emerald-500/20 light:border-emerald-200">
              <p className="text-xs text-emerald-300 light:text-emerald-600 mb-2">
                ✅ Sincronización automática activada.<br/>
                Conectado como: <strong>{session.user.email}</strong>
              </p>
              <button
                type="button"
                className="btn-ghost text-xs text-rose-400 light:text-rose-600"
                onClick={async () => {
                  await supabase.auth.signOut();
                  await loadSession();
                  // Purga el caché del service worker: las respuestas cacheadas
                  // de la API sobreviven al cierre de sesión y, en un
                  // dispositivo compartido, quedarían accesibles.
                  if ("caches" in window) {
                    const keys = await caches.keys();
                    await Promise.all(
                      keys.filter((k) => k !== "assets-v1").map((k) => caches.delete(k)),
                    );
                  }
                  pushToast("Sesión cerrada");
                }}
              >
                Cerrar Sesión
              </button>
            </div>
          ) : (
            <div className="rounded-lg bg-surface-hover p-3">
              <p className="text-xs text-muted mb-3">
                Conecta con Google para respaldar tus tareas automáticamente y compartirlas entre tus dispositivos.
              </p>
              <div className="flex flex-col gap-2">
                {/* Solo OAuth con Google: sin registro por correo no hay
                    contraseñas que guardar ni rate limits de Supabase. */}
                <button
                  type="button"
                  className="btn-ghost mt-2 flex items-center justify-center gap-2 border border-theme hover:bg-surface-hover"
                  disabled={authLoading}
                  onClick={async () => {
                    setAuthLoading(true);
                    const { error } = await supabase.auth.signInWithOAuth({
                      provider: "google",
                      options: { redirectTo: window.location.origin }
                    });
                    if (error) pushToast(`Error: ${error.message}`);
                    setAuthLoading(false);
                  }}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continuar con Google
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Sección de perfil en Ajustes: ver, editar o hacer el cuestionario. */
function ProfileSettingsSection() {
  const pushToast = useStore((s) => s.pushToast);
  const [profile, setProfile] = useState<UserProfile | null>(() => loadProfile());
  const [editing, setEditing] = useState(false);

  const handleDelete = () => {
    if (!confirm("¿Eliminar tu perfil? La IA dejará de personalizar recomendaciones.")) return;
    clearProfile();
    setProfile(null);
    pushToast("Perfil eliminado");
  };

  const handleSync = async () => {
    // Viaje completo: baja primero (solo si la nube tiene algo más nuevo) y
    // sube después. Subir sin bajar pisaría un perfil remoto más reciente.
    const result = await syncProfile();
    if (result.ok) {
      pushToast("Perfil sincronizado con la nube ☁️");
    } else {
      pushToast(`No se pudo sincronizar: ${result.error ?? "error desconocido"}`);
    }
  };

  if (editing || !profile) {
    return (
      <ProfileQuestionnaire
        canCancel={!!profile}
        onCancel={() => setEditing(false)}
        onComplete={() => {
          setProfile(loadProfile());
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-2">
      <WeekStrip />
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-surface-hover px-3 py-2">
          <span className="text-muted">☀️ Despertar</span>
          <span className="ml-2 text-primary font-medium">{profile.wakeTime}</span>
        </div>
        <div className="rounded-lg bg-surface-hover px-3 py-2">
          <span className="text-muted">🌙 Dormir</span>
          <span className="ml-2 text-primary font-medium">{profile.sleepTime}</span>
        </div>
        <div className="rounded-lg bg-surface-hover px-3 py-2">
          <span className="text-muted">🧠 Cronotipo</span>
          <span className="ml-2 text-primary font-medium capitalize">{profile.chronotype}</span>
        </div>
        <div className="rounded-lg bg-surface-hover px-3 py-2">
          <span className="text-muted">💼 Trabajo</span>
          <span className="ml-2 text-primary font-medium">{profile.workStart}–{profile.workEnd}</span>
        </div>
        <div className="rounded-lg bg-surface-hover px-3 py-2 col-span-2">
          <span className="text-muted">🏃 Actividades</span>
          <span className="ml-2 text-primary font-medium">{profile.activities.join(", ") || "—"}</span>
        </div>
        <div className="rounded-lg bg-surface-hover px-3 py-2 col-span-2">
          <span className="text-muted">☕ Descanso</span>
          <span className="ml-2 text-primary font-medium">{profile.breakMin} min</span>
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setEditing(true)} className="btn-ghost text-xs">
          ✏️ Editar
        </button>
        <button type="button" onClick={() => void handleSync()} className="btn-ghost text-xs">
          ☁️ Sincronizar
        </button>
        <button type="button" onClick={handleDelete} className="btn-danger text-xs ml-auto">
          🗑️ Eliminar
        </button>
      </div>
    </div>
  );
}
