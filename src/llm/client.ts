import type { Settings } from "@/domain/types";

export type LlmStatus = "inactive" | "active" | "error";

export interface LlmContext {
  settings: Settings;
  /** Inyectable para tests. */
  fetchFn?: typeof fetch;
  now?: () => number;
}

export interface LlmResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  /** true si se usó la IA; false si hubo degradación a modo local. */
  usedLlm: boolean;
}

const TIMEOUT_MS = 20_000;
const RETRIES = 2;
const BACKOFF_MS = 800;

export function llmStatus(settings: Settings): LlmStatus {
  return settings.apiKey.trim() ? "active" : "inactive";
}

function endpoint(settings: Settings): string {
  const base = settings.baseUrl.trim().replace(/\/$/, "");
  if (base) return base;
  if (settings.provider === "anthropic") {
    return "https://api.anthropic.com/v1/messages";
  }
  if (settings.provider === "gemini") {
    const model = settings.model.trim() || "gemini-3.8-flash";
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(settings.apiKey.trim())}`;
  }
  if (settings.provider === "groq") {
    return "https://api.groq.com/openai/v1/chat/completions";
  }
  return "https://api.openai.com/v1/chat/completions";
}

interface FetchOptions {
  system: string;
  user: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

async function chatOnce(ctx: LlmContext, opts: FetchOptions): Promise<string> {
  const { settings } = ctx;
  const fetchFn = ctx.fetchFn ?? fetch;
  // El modelo realmente usado (por defecto del proveedor si no hay elección):
  // se incluye en el error de «respuesta vacía» para que el aviso diga qué
  // modelo falla.
  const model =
    settings.provider === "gemini"
      ? settings.model.trim() || "gemini-3.8-flash"
      : settings.provider === "anthropic"
        ? settings.model || "claude-haiku-4.5"
        : settings.model || (settings.provider === "groq" ? "openai/gpt-oss-20b" : "gpt-4o");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  if (opts.signal) opts.signal.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    let res: Response;
    if (settings.provider === "gemini") {
      res = await fetchFn(endpoint(settings), {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: opts.user }] }],
          systemInstruction: { parts: [{ text: opts.system }] },
          generationConfig: {
            maxOutputTokens: opts.maxTokens ?? 1024,
          },
        }),
      });
    } else if (settings.provider === "anthropic") {
      res = await fetchFn(endpoint(settings), {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": settings.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model,
          max_tokens: opts.maxTokens ?? 1024,
          system: opts.system,
          messages: [{ role: "user", content: opts.user }],
        }),
      });
    } else {
      res = await fetchFn(endpoint(settings), {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: opts.maxTokens ?? 1024,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
        }),
      });
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await safeText(res)}`);
    const json = (await res.json()) as Record<string, unknown>;
    let text = "";
    if (settings.provider === "gemini") {
      const candidates = json.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined;
      text = candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    } else if (settings.provider === "anthropic") {
      text = ((json.content as { text?: string }[] | undefined)?.map((c) => c.text ?? "").join("") ?? "");
    } else {
      text = ((json.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content ?? "");
    }
    if (!text) throw new Error(`Respuesta vacía del modelo «${model}»`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/** Chat con reintentos; devuelve null si no hay clave o falla todo (degradación). */
export async function chat(ctx: LlmContext, opts: FetchOptions): Promise<LlmResult<string>> {
  if (llmStatus(ctx.settings) === "inactive") {
    return { ok: false, error: "IA desactivada: falta la clave API", usedLlm: false };
  }
  let lastError = "";
  // Modelos de razonamiento: se gastan los tokens pensando y el contenido
  // final sale vacío. Ante «respuesta vacía» se reintenta con presupuesto
  // holgado — el tope (max_tokens) solo limita lo máximo, se paga lo que se
  // genera de verdad, así que subirlo no cuesta nada.
  let maxTokens = opts.maxTokens;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const text = await chatOnce(ctx, { ...opts, maxTokens });
      return { ok: true, data: text, usedLlm: true };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (/Respuesta vac[ií]a/i.test(lastError) && (maxTokens ?? 1024) < 4096) {
        maxTokens = 4096;
      }
      if (opts.signal?.aborted) break;
      if (attempt < RETRIES) {
        const wait = BACKOFF_MS * 2 ** attempt;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  // El crudo (con el cuerpo del proveedor) va a la consola para depurar;
  // el motivo corto y accionable es lo que se muestra en la UI.
  console.warn("[IA] fallo tras reintentos:", lastError);
  return { ok: false, error: friendlyLlmError(lastError), usedLlm: true };
}

/**
 * Traduce el error crudo del proveedor («HTTP 401: {json del proveedor}…»)
 * a un motivo corto y accionable en español: es lo que aparece en los toasts
 * de captura, desglose, plan y «Probar conexión». El texto crudo se queda en
 * la consola del navegador.
 */
export function friendlyLlmError(raw: string): string {
  const http = /HTTP (\d{3})/.exec(raw);
  if (http) {
    const s = http[1];
    if (s === "401" || s === "403") return `clave API inválida o sin permisos — revísala en Ajustes [${s}]`;
    if (s === "404") return `el modelo o la URL no existen en ese proveedor — revísalo en Ajustes [404]`;
    if (s === "429") return `límite de uso alcanzado — prueba en unos minutos [429]`;
    if (s === "400" || s === "422") return `el proveedor rechazó la petición — revisa el modelo en Ajustes [${s}]`;
    if (s.startsWith("5")) return `el proveedor está caído (${s}) — prueba en unos minutos`;
    return `el proveedor respondió ${s}`;
  }
  const empty = /Respuesta vac[ií]a del modelo «([^»]+)»/.exec(raw);
  if (empty) {
    return `el modelo «${empty[1]}» devolvió una respuesta vacía — si sigue así, prueba con otro modelo en Ajustes`;
  }
  if (/Respuesta vac[ií]a/i.test(raw)) {
    return "el modelo devolvió una respuesta vacía — prueba con otro modelo en Ajustes";
  }
  if (/abort/i.test(raw)) return "sin respuesta en 20 s — ¿sin conexión o proveedor lento?";
  if (/failed to fetch|networkerror|fetch failed/i.test(raw)) {
    return "sin conexión o el navegador bloqueó la petición";
  }
  if (/falta la clave API/i.test(raw)) return "falta la clave API — configúrala en Ajustes";
  return raw.length > 90 ? `${raw.slice(0, 90)}…` : raw;
}

/** Extrae el primer objeto JSON de una respuesta (tolerante a ```json fences). */
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  try {
    return JSON.parse(candidate.slice(start)) as T;
  } catch {
    // Último intento: recortar al último cierre balanceado
    const openCh = candidate[start];
    const closeCh = openCh === "[" ? "]" : "}";
    const end = candidate.lastIndexOf(closeCh);
    if (end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
