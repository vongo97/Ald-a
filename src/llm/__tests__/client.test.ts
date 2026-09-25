import { afterEach, describe, expect, it, vi } from "vitest";
import { chat, extractJson, llmStatus } from "../client";
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
    expect(url).toContain("key=AIza123");
    expect(url).toContain("gemini-1.5-flash");
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
