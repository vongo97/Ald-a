import { describe, expect, it, vi } from "vitest";
import { breakdownTask, improveCapture } from "../tasks";
import type { Settings } from "@/domain/types";
import type { UserProfile } from "@/domain/profile";

const settings: Settings = { provider: "openai", apiKey: "sk-test", model: "gpt-test", baseUrl: "" };

/** Rutina de ejemplo: se levanta a las 6 (el usuario pidió que las propuestas salgan de aquí). */
const profile: UserProfile = {
  id: "p1",
  wakeTime: "06:00",
  sleepTime: "22:00",
  chronotype: "matutino",
  workStart: "09:00",
  workEnd: "18:00",
  activities: ["Ejercicio"],
  breakMin: 15,
  updatedAt: "2026-09-22T00:00:00.000Z",
};

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

  it("subtareas con clave en español «titulo» se aceptan", async () => {
    const fetchFn = llm(
      JSON.stringify({ title: "Día", subtasks: [{ titulo: "Desayunar", start: "07:00" }] }),
    );
    const res = await improveCapture({ settings, fetchFn }, LONG);
    expect(res.data?.subtasks?.[0]).toMatchObject({ title: "Desayunar", start: "07:00" });
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

  it("con perfil pide horarios según la rutina (se levanta a las 6 → a las 6)", async () => {
    const fetchFn = llm(
      JSON.stringify({
        title: "Día",
        subtasks: [{ title: "Gimnasio", start: "06:00", end: "07:00" }],
      }),
    );
    const res = await improveCapture({ settings, fetchFn }, LONG, profile);

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = String(init.body);
    expect(body).toContain("Se despierta a las 06:00"); // contexto del perfil
    expect(body).toContain("rutina del usuario"); // regla de propuesta
    expect(res.data?.subtasks?.[0]).toMatchObject({ start: "06:00", end: "07:00" });
  });

  it("sin perfil: las horas solo si el texto las indica (regla antigua)", async () => {
    const fetchFn = llm(JSON.stringify({ title: "X", subtasks: [] }));
    await improveCapture({ settings, fetchFn }, LONG);

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = String(init.body);
    expect(body).toContain("déjalas fuera");
    expect(body).not.toContain("Se despierta");
  });
});

describe("breakdownTask", () => {
  it("con perfil devuelve inicio/fin validados y duración saneada", async () => {
    const fetchFn = llm(
      JSON.stringify({
        subtasks: [
          { title: "Desayunar", durationMin: 30, start: "06:00", end: "06:30" },
          { title: "Correr", durationMin: "45", start: "a las 7", end: "08:00" },
          { title: "" }, // sin título → fuera
        ],
      }),
    );

    const res = await breakdownTask({ settings, fetchFn }, { title: "Mi rutina" }, profile);

    expect(res.ok).toBe(true);
    expect(res.data).toHaveLength(2);
    expect(res.data?.[0]).toMatchObject({ title: "Desayunar", durationMin: 30, start: "06:00", end: "06:30" });
    expect(res.data?.[1]?.durationMin).toBe(45); // "45" string → 45
    expect(res.data?.[1]?.start).toBeUndefined(); // no HH:mm → fuera
    expect(res.data?.[1]?.end).toBe("08:00");

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = String(init.body);
    expect(body).toContain("Se despierta a las 06:00");
    expect(body).toContain("HH:mm"); // pide start/end en el ejemplo JSON
  });

  it("sin perfil no pide horas", async () => {
    const fetchFn = llm(JSON.stringify({ subtasks: [{ title: "Paso 1", durationMin: 10 }] }));
    const res = await breakdownTask({ settings, fetchFn }, { title: "Vaga" });
    expect(res.data?.[0]?.start).toBeUndefined();

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).not.toContain("HH:mm");
  });

  it("respuesta sin JSON interpretable → error VISIBLE (nunca lista vacía muda)", async () => {
    const fetchFn = llm("Lo siento, no puedo desglosar eso porque…");
    const res = await breakdownTask({ settings, fetchFn }, { title: "Cualquiera" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Respuesta del modelo no interpretable");
  });

  it("JSON sin ninguna lista de subtareas → error visible", async () => {
    const fetchFn = llm(JSON.stringify({ foo: 1 }));
    const res = await breakdownTask({ settings, fetchFn }, { title: "Cualquiera" });
    expect(res.ok).toBe(false);
  });

  it("lista vacía declarada → ok con [] (motivo legítimo, no error)", async () => {
    const fetchFn = llm(JSON.stringify({ subtasks: [] }));
    const res = await breakdownTask({ settings, fetchFn }, { title: "Vaga" });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual([]);
  });

  it("tolera claves en español, array suelto y pasos como string", async () => {
    const fetchFn = llm(
      JSON.stringify([
        { titulo: "Paso con acento", durationMin: 20 },
        { pasos: "no soy objeto" },
        "Paso escrito como string",
      ]),
    );
    const res = await breakdownTask({ settings, fetchFn }, { title: "X" });
    expect(res.data?.map((s) => s.title)).toEqual(["Paso con acento", "Paso escrito como string"]);
    expect(res.data?.[0]?.durationMin).toBe(20);
  });

  it("clave alternativa «pasos» también se acepta", async () => {
    const fetchFn = llm(JSON.stringify({ pasos: [{ title: "A" }, { title: "B" }] }));
    const res = await breakdownTask({ settings, fetchFn }, { title: "X" });
    expect(res.data).toHaveLength(2);
  });
});
