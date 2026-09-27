import { describe, expect, it, vi } from "vitest";
import { parseDayPlan } from "../planParser";
import type { Settings } from "@/domain/types";

const settings: Settings = { provider: "openai", apiKey: "sk-test", model: "gpt-test", baseUrl: "" };

/** Fake de red: el LLM responde con `content` (formato OpenAI). */
function llm(content: string) {
  return vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }),
    );
}

const DAY_TEXT = `tengo un día bastante cargado. Despierto a las 7, me voy al gimnasio de 8 a 9:30.
Luego trabajo en casa de 10 a 13. A las 14 almuerzo con mi hermana.`;

describe("parseDayPlan", () => {
  it("extrae planTitle, fecha, actividades y children", async () => {
    const fetchFn = llm(
      JSON.stringify({
        date: "2026-09-28",
        planTitle: "Día cargado: gimnasio, teletrabajo y hermana",
        tasks: [
          {
            title: "Gimnasio",
            start: "08:00",
            end: "09:30",
            labels: ["salud"],
            reason: "temprano",
            children: [{ title: "Calentamiento", start: "08:00", end: "08:15", labels: [] }],
          },
        ],
        warning: "día completo",
      }),
    );

    const res = await parseDayPlan({ settings, fetchFn }, DAY_TEXT, "2026-09-28");

    expect(res.ok).toBe(true);
    expect(res.data?.planTitle).toBe("Día cargado: gimnasio, teletrabajo y hermana");
    expect(res.data?.date).toBe("2026-09-28");
    expect(res.data?.warning).toBe("día completo");
    expect(res.data?.tasks[0].children).toHaveLength(1);
    // El prompt pide el título del padre
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("planTitle");
  });

  it("sin planTitle devuelve undefined (la UI usará el fallback con fecha)", async () => {
    const fetchFn = llm(
      JSON.stringify({ date: "2026-09-28", tasks: [{ title: "Leer", start: "22:00", end: "22:30", labels: [] }] }),
    );
    const res = await parseDayPlan({ settings, fetchFn }, DAY_TEXT, "2026-09-28");
    expect(res.ok).toBe(true);
    expect(res.data?.planTitle).toBeUndefined();
  });

  it("descarta actividades sin título y recorta espacios", async () => {
    const fetchFn = llm(
      JSON.stringify({
        tasks: [
          { start: "08:00", end: "09:00" }, // sin título → fuera
          { title: "  Caminar  ", labels: [] },
        ],
      }),
    );
    const res = await parseDayPlan({ settings, fetchFn }, DAY_TEXT, "2026-09-28");
    expect(res.data?.tasks.map((t) => t.title)).toEqual(["Caminar"]);
  });

  it("si la respuesta no contiene JSON → error legible", async () => {
    const fetchFn = llm("lo siento, no puedo");
    const res = await parseDayPlan({ settings, fetchFn }, DAY_TEXT, "2026-09-28");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("No se pudieron extraer actividades del texto");
  });
});
