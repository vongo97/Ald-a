import { describe, expect, it } from "vitest";
import { parseDate } from "../dateparser";
import { toISODate } from "@/domain/dateutils";

const T = new Date(2026, 8, 22); // martes 22 sep 2026, fijo para tests

describe("parseDate (español)", () => {
  it("hoy", () => {
    expect(parseDate("llamar a juan hoy", T).date).toBe(toISODate(T));
  });

  it("mañana", () => {
    expect(parseDate("comprar pan mañana", T).date).toBe("2026-09-23");
  });

  it("pasado mañana", () => {
    expect(parseDate("entregar informe pasado mañana", T).date).toBe("2026-09-24");
  });

  it("en 3 días", () => {
    expect(parseDate("pagar renta en 3 días", T).date).toBe("2026-09-25");
  });

  it("en 2 semanas", () => {
    expect(parseDate("revisar coche en 2 semanas", T).date).toBe("2026-10-06");
  });

  it("el jueves", () => {
    // martes 22 → próximo jueves 24
    expect(parseDate("cita dentista el jueves", T).date).toBe("2026-09-24");
  });

  it("el próximo lunes", () => {
    expect(parseDate("reunión el próximo lunes", T).date).toBe("2026-09-28");
  });

  it("el 5 de marzo (año siguiente si ya pasó)", () => {
    expect(parseDate("viaje el 5 de marzo", T).date).toBe("2027-03-05");
  });

  it("5/10 con formato hispano = 5 de octubre", () => {
    expect(parseDate("pago 5/10", T).date).toBe("2026-10-05");
  });

  it("hora 15:30", () => {
    const r = parseDate("reunión hoy 15:30", T);
    expect(r.time).toBe("15:30");
  });

  it("hora 3pm", () => {
    expect(parseDate("gimnasio a las 3pm", T).time).toBe("15:00");
  });

  it("a las 9 de la noche", () => {
    expect(parseDate("cena a las 9 de la noche", T).time).toBe("21:00");
  });

  it("mediodía", () => {
    expect(parseDate("comida al mediodía", T).time).toBe("12:00");
  });

  it("recurrencia cada 2 semanas", () => {
    const r = parseDate("basura cada 2 semanas", T);
    expect(r.recurrence).toEqual({ kind: "weekly", every: 2 });
  });

  it("recurrencia diaria", () => {
    expect(parseDate("tomar vitaminas diario", T).recurrence).toEqual({ kind: "daily", every: 1 });
  });

  it("todos los lunes (recurrencia + fecha)", () => {
    const r = parseDate("clase todos los lunes", T);
    expect(r.recurrence).toEqual({ kind: "weekly", every: 1, weekdays: [1] });
    expect(r.date).toBe("2026-09-28");
  });

  it("el primer lunes del mes", () => {
    const r = parseDate("junta el primer lunes del mes", T);
    expect(r.date).toBe("2026-10-05"); // primer lunes de octubre
    expect(r.recurrence).toEqual({ kind: "monthly", every: 1, nthWeekday: { nth: 1, weekday: 1 } });
  });

  // --- "los <día>" a secas: el plural ES la seña de rutina -------------------
  // "los viernes" es como se dice. Antes solo se entendía "cada viernes" o
  // "todos los viernes", así que una rutina tan natural salía como
  // semanal-sin-día o directamente sin leer.
  describe("plural suelto (como lo dice la gente)", () => {
    it("los viernes", () => {
      const r = parseDate("Revisión semanal los viernes", T);
      expect(r.recurrence).toEqual({ kind: "weekly", every: 1, weekdays: [5] });
      expect(r.date).toBe("2026-09-25");
    });

    it("los martes, sin más", () => {
      expect(parseDate("Gimnasio los martes", T).recurrence).toEqual({
        kind: "weekly",
        every: 1,
        weekdays: [2],
      });
    });

    it("los lunes y miércoles → los dos días", () => {
      const r = parseDate("estudio los lunes y miércoles", T);
      expect(r.recurrence).toEqual({ kind: "weekly", every: 1, weekdays: [1, 3] });
      // El martes 22: el MIÉRCOLES 23 es antes que el lunes 28. Coje el
      // primero que llega, no el primero de la lista.
      expect(r.date).toBe("2026-09-23");
    });

    it("no repite un día dos veces", () => {
      expect(parseDate("los lunes y los lunes", T).recurrence).toEqual({
        kind: "weekly",
        every: 1,
        weekdays: [1],
      });
    });
  });

  // --- El artículo decide: "el viernes" es UNA fecha, "los viernes" una rutina.
  describe("el artículo no es decorativo", () => {
    it("el viernes sigue siendo fecha puntual, sin recurrencia", () => {
      const r = parseDate("reunión el viernes", T);
      expect(r.recurrence).toBeUndefined();
      expect(r.date).toBe("2026-09-25");
    });

    it("los viernes es rutina, y aun así trae fecha", () => {
      const r = parseDate("reunión los viernes", T);
      expect(r.recurrence).toEqual({ kind: "weekly", every: 1, weekdays: [5] });
      expect(r.date).toBe("2026-09-25");
    });

    it("no se come los plurales que no son días", () => {
      expect(parseDate("los dos días", T).recurrence).toBeUndefined();
      expect(parseDate("los próximos días", T).recurrence).toBeUndefined();
    });
  });
});
