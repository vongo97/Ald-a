import { describe, expect, it, vi } from "vitest";
import { improveCapture } from "../tasks";
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

const LONG = `tengo un día bastante cargado. Despierto a las 7, desayuno rápido y me voy al
gimnasio de 8 a 9:30. Luego trabajo en casa de 10 a 13 respondiendo correos. A las 14 almuerzo
con mi hermana. Por la tarde de 16 a 18 reunión con el equipo y después estudiar inglés.`;

describe("improveCapture", () => {
  it("captura larga → título corto + subtareas con horario", async () => {
    const fetchFn = llm(
      JSON.stringify({
        title: "Día cargado: gimnasio, teletrabajo, reunión e inglés",
        dueDate: "2026-09-28",
        dueTime: "",
        priority: 2,
        labels: ["gimnasio"],
        notes: "",
        subtasks: [
          { title: "Gimnasio", start: "08:00", end: "09:30" },
          { title: "Teletrabajo: correos y proyecto", start: "10:00", end: "13:00" },
          { title: "Leer o meditar" }, // sin horas en el texto → sin timeBlock
        ],
      }),
    );

    const res = await improveCapture({ settings, fetchFn }, LONG);

    expect(res.ok).toBe(true);
    expect(res.data?.title).toBe("Día cargado: gimnasio, teletrabajo, reunión e inglés");
    expect(res.data?.subtasks).toHaveLength(3);
    expect(res.data?.subtasks?.[0]).toMatchObject({ start: "08:00", end: "09:30" });
    expect(res.data?.subtasks?.[2]?.start).toBeUndefined();
    // El prompt pide subtasks cuando hay varias actividades
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("subtasks");
  });

  it("horas que no son HH:mm se descartan", async () => {
    const fetchFn = llm(
      JSON.stringify({ title: "Tarea", subtasks: [{ title: "X", start: "mañana", end: "13:00" }] }),
    );
    const res = await improveCapture({ settings, fetchFn }, LONG);
    expect(res.data?.subtasks?.[0]?.start).toBeUndefined();
    expect(res.data?.subtasks?.[0]?.end).toBe("13:00");
  });

  it("subtareas sin título se descartan; tarea única → sin subtasks", async () => {
    const fetchFn = llm(
      JSON.stringify({ title: "Comprar pan", subtasks: [{ start: "10:00" }, { title: "  " }] }),
    );
    const res = await improveCapture({ settings, fetchFn }, "comprar pan mañana");
    expect(res.ok).toBe(true);
    expect(res.data?.subtasks).toBeUndefined();
  });

  it("título alternativo «título» se acepta; sin ningún título → error", async () => {
    const fetchFn = llm(JSON.stringify({ "título": "Llamar al dentist", subtasks: [] }));
    const ok = await improveCapture({ settings, fetchFn }, "llamar al dentist");
    expect(ok.data?.title).toBe("Llamar al dentist");

    const fetchFn2 = llm(JSON.stringify({ dueDate: "2026-09-28" }));
    const bad = await improveCapture({ settings, fetchFn: fetchFn2 }, "...");
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe("Respuesta del modelo no interpretable");
  });
});
