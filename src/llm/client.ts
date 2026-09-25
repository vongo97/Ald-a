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
          model: settings.model || "claude-haiku-4.5",
          max_tokens: opts.maxTokens ?? 1024,
          system: opts.system,
          messages: [{ role: "user", content: opts.user }],
        }),
      });
    } else {
      const defaultModel = settings.provider === "groq" ? "openai/gpt-oss-20b" : "gpt-4o";
      res = await fetchFn(endpoint(settings), {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.model || defaultModel,
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
    if (!text) throw new Error("Respuesta vacía del modelo");
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
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const text = await chatOnce(ctx, opts);
      return { ok: true, data: text, usedLlm: true };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (opts.signal?.aborted) break;
      if (attempt < RETRIES) {
        const wait = BACKOFF_MS * 2 ** attempt;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  return { ok: false, error: lastError, usedLlm: true };
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
