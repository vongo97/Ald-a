import { afterEach, describe, expect, it, vi } from "vitest";
import { chat, extractJson, friendlyLlmError, llmStatus } from "../client";
import type { Settings } from "@/domain/types";

const settings: Settings = { provider: "openai", apiKey: "sk-test", model: "gpt-test", baseUrl: "" };

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("llmStatus", () => {
  it("inactive sin clave", () => {
    expect(llmStatus({ ...settings, apiKey: "  " })).toBe("inactive");
  });
  it("active con clave", () => {
    expect(llmStatus(settings)).toBe("active");
  });
});

describe("chat", () => {
  it("OpenAI: devuelve el texto del primer choice", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      okResponse({ choices: [{ message: { content: "hola" } }] }),
    );
    const res = await chat({ settings, fetchFn }, { system: "s", user: "u" });
    expect(res).toMatchObject({ ok: true, data: "hola", usedLlm: true });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse(String(init.body)).model).toBe("gpt-test");
  });

  it("Anthropic: usa x-api-key y lee content[].text", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      okResponse({ content: [{ type: "text", text: "bonjour" }] }),
    );
    const res = await chat(
      { settings: { ...settings, provider: "anthropic", model: "claude-x" }, fetchFn },
      { system: "s", user: "u" },
    );
    expect(res.ok).toBe(true);
    expect(res.data).toBe("bonjour");
    const headers = (fetchFn.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("Gemini: llama a generateContent y lee candidates[0].content.parts[0].text", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      okResponse({
        candidates: [
          { content: { parts: [{ text: "hola desde gemini" }] } },
        ],
      }),
    );
    const res = await chat(
      { settings: { ...settings, provider: "gemini", apiKey: "AIza123", model: "gemini-1.5-flash" }, fetchFn },
      { system: "sys", user: "prompt" },
    );
    expect(res.ok).toBe(true);
    expect(res.data).toBe("hola desde gemini");
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(url).toContain("gemini-1.5-flash");
    // La clave va en cabecera, NO en la query string (?key=): las URLs acaban en
    // logs de proxies y en la clave de la caché del service worker.
    expect(url).not.toContain("key=");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("AIza123");
    const body = JSON.parse(String(init.body));
    expect(body.contents[0].parts[0].text).toBe("prompt");
    expect(body.systemInstruction.parts[0].text).toBe("sys");
  });

  it("sin clave: degradación sin llamar a la red", async () => {
    const fetchFn = vi.fn();
    const res = await chat(
      { settings: { ...settings, apiKey: "" }, fetchFn },
      { system: "s", user: "u" },
    );
    expect(res).toMatchObject({ ok: false, usedLlm: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("HTTP 500 dos veces y éxito al tercer intento", async () => {
    vi.useFakeTimers();
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Response("boom", { status: 500 }))
      .mockRejectedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(okResponse({ choices: [{ message: { content: "ok" } }] }));
    const p = chat({ settings, fetchFn }, { system: "s", user: "u" });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("fallo persistente: error con usedLlm true", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn().mockRejectedValue(new Response("nope", { status: 503 }));
    const p = chat({ settings, fetchFn }, { system: "s", user: "u" });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.usedLlm).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("HTTP 401 → sin reintentos (4xx no sirve de nada) y error traducido", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn().mockResolvedValue(new Response("bad key", { status: 401 }));
    const p = chat({ settings, fetchFn }, { system: "s", user: "u" });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.error).toContain("clave API");
    expect(res.error).toContain("401");
    // El cuerpo crudo del proveedor no se cuela en la UI…
    expect(res.error).not.toContain("bad key");
    // …y no se gastan reintentos con una clave que no va a funcionar
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("respuesta vacía → reintenta con presupuesto holgado (4096) y luego funciona", async () => {
    vi.useFakeTimers();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ choices: [{ message: { content: "" } }] }))
      .mockResolvedValueOnce(okResponse({ choices: [{ message: { content: "ok" } }] }));
    const p = chat({ settings, fetchFn }, { system: "s", user: "u", maxTokens: 800 });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.ok).toBe(true);
    expect(res.data).toBe("ok");
    const body0 = JSON.parse(String((fetchFn.mock.calls[0] as [string, RequestInit])[1].body));
    const body1 = JSON.parse(String((fetchFn.mock.calls[1] as [string, RequestInit])[1].body));
    expect(body0.max_tokens).toBe(800);
    expect(body1.max_tokens).toBe(4096);
  });

  it("respuesta vacía persistente → error con el nombre del modelo", async () => {
    vi.useFakeTimers();
    // Response nueva en cada intento: el body solo se puede leer una vez
    const fetchFn = vi.fn().mockImplementation(() =>
      Promise.resolve(okResponse({ choices: [{ message: { content: "" } }] })),
    );
    const p = chat({ settings, fetchFn }, { system: "s", user: "u" });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.error).toContain("gpt-test");
    expect(res.error).toContain("vacía");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("429 de ráfaga: sin reintentos y aviso con el modelo", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: "Rate limit reached for requests" } }), {
          status: 429,
        }),
      ),
    );
    const p = chat({ settings, fetchFn }, { system: "s", user: "u" });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.error).toContain("peticiones");
    expect(res.error).toContain("gpt-test");
    // Un 429 no se reintenta: cada intento cuenta contra la cuota
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("429 de cuota: distingue el tipo de límite", async () => {
    const fetchFn = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: "You exceeded your current quota" } }), {
          status: 429,
        }),
      ),
    );
    const res = await chat({ settings, fetchFn }, { system: "s", user: "u" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("cuota");
    expect(res.error).toContain("gpt-test");
  });
});

describe("friendlyLlmError", () => {
  it("HTTP → motivo accionable en español", () => {
    expect(friendlyLlmError('HTTP 401: {"error":{"message":"bad"}}')).toContain("clave API");
    expect(friendlyLlmError("HTTP 404: no")).toContain("modelo");
    expect(friendlyLlmError("HTTP 429: no")).toContain("límite");
    expect(friendlyLlmError("HTTP 500: no")).toContain("caído");
    expect(friendlyLlmError("HTTP 418: no")).toContain("418");
  });

  it("429: modelo incluido y ráfaga distinguible de cuota", () => {
    expect(friendlyLlmError("HTTP 429: no", "gpt-x")).toContain("gpt-x");
    expect(friendlyLlmError("HTTP 429: Rate limit reached for requests", "gpt-x")).toContain(
      "peticiones",
    );
    expect(friendlyLlmError('HTTP 429: {"message":"exceeded your current quota"}', "gpt-x")).toContain(
      "cuota",
    );
  });

  it("timeout, red y respuesta vacía", () => {
    expect(friendlyLlmError("The user aborted a request.")).toContain("20 s");
    expect(friendlyLlmError("Failed to fetch")).toContain("conexión");
    expect(friendlyLlmError("Respuesta vacía del modelo")).toContain("modelo");
    // Con nombre de modelo (formato real de chatOnce) lo conserva en el aviso
    expect(
      friendlyLlmError("Respuesta vacía del modelo «openai/gpt-oss-20b»"),
    ).toContain("openai/gpt-oss-20b");
  });

  it("desconocido: se pasa recortado", () => {
    expect(friendlyLlmError("algo raro")).toBe("algo raro");
    expect(friendlyLlmError("x".repeat(200))).toHaveLength(91); // 90 + "…"
  });
});

describe("extractJson", () => {
  it("objeto directo", () => {
    expect(extractJson<{ a: number }>("{\"a\":1}")).toEqual({ a: 1 });
  });
  it("con fence de código", () => {
    expect(extractJson<{ a: number }>("```json\n{\"a\":2}\n```")).toEqual({ a: 2 });
  });
  it("con preámbulo de texto", () => {
    expect(extractJson<{ a: number }>("Claro, aquí tienes: {\"a\":3} saludos")).toEqual({ a: 3 });
  });
  it("devuelve null si no hay JSON", () => {
    expect(extractJson("no hay nada")).toBeNull();
  });
});
