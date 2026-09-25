import type { Settings } from "@/domain/types";

const KEY = "tareas.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  provider: "openai",
  apiKey: "",
  model: "",
  baseUrl: "",
  supabaseUrl: "",
  supabaseAnonKey: "",
};

const STALE_MODELS = new Set([
  // Deprecados por Groq en agosto 2026
  "llama3-70b-8192",
  "llama3-8b-8192",
  "llama-3.1-70b-versatile",
  "llama-3.1-8b-instant",
  "llama-3.2-11b-vision-preview",
  "llama-3.3-70b-versatile",
  "llama-4-scout-17b-16e-instruct",
  // Deprecados en septiembre 2026
  "groq/compound",
  "groq/compound-mini",
  "qwen/qwen3.6-27b",
]);

let cache: Settings | null = null;

export const settingsRepo = {

  load(): Settings {
    if (cache) return cache;
    try {
      const raw = localStorage.getItem(KEY);
      const loaded = raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULT_SETTINGS };
      // Limpiar modelos deprecados para que el usuario elija uno válido
      if (STALE_MODELS.has(loaded.model)) {
        loaded.model = "";
      }
      cache = loaded;
    } catch {
      cache = { ...DEFAULT_SETTINGS };
    }
    return cache;
  },

  save(s: Settings): void {
    cache = { ...s };
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // almacenamiento no disponible: se queda solo en memoria
    }
  },
};
