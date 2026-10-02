import { describe, expect, it } from "vitest";
import { diasEnTexto, propuestaDeDia } from "../propuestaDia";
import type { RecurrenceSpec } from "@/domain/types";

const D = 0, L = 1, M = 2, X = 3, J = 4, V = 5, S = 6;

const domingo: RecurrenceSpec = { kind: "weekly", every: 1, weekdays: [D] };
const viernes: RecurrenceSpec = { kind: "weekly", every: 1, weekdays: [V] };

describe("diasEnTexto: que dia pide el texto", () => {
  it("los viernes", () => {
    expect(diasEnTexto("Revisión semanal los viernes")).toEqual([V]);
  });

  it("el viernes (singular) es fecha, no dia de rutina", () => {
    expect(diasEnTexto("Reunion el viernes")).toBeNull();
  });

  it("varios dias", () => {
    expect(diasEnTexto("Estudio los lunes y miércoles")).toEqual([L, X]);
  });

  it("sin dia: null, no lista vacia", () => {
    expect(diasEnTexto("Comprar pan")).toBeNull();
    expect(diasEnTexto("Revisión semanal")).toBeNull();
    expect(diasEnTexto("Tarea diaria")).toBeNull();
  });
});

describe("propuestaDeDia: solo cuando hay algo que proponer", () => {
  // EL CASO QUE SE REPORTO.
  it("«los viernes» sobre una tarea que se repite los domingos", () => {
    const p = propuestaDeDia("Revisión semanal los viernes", domingo);
    expect(p).not.toBeNull();
    expect(p!.weekdays).toEqual([V]);
    expect(p!.texto).toBe("cada viernes");
    expect(p!.spec).toEqual({ kind: "weekly", every: 1, weekdays: [V] });
    expect(p!.esNueva).toBe(false);
  });

  it("si ya dice viernes, no hay nada que proponer", () => {
    expect(propuestaDeDia("Revisión semanal los viernes", viernes)).toBeNull();
  });

  // El caso que haria dano si se hiciera a lo bruto.
  it("corregir una errata sin tocar el dia NO propone nada", () => {
    expect(propuestaDeDia("Revisión seminanal los viernes", viernes)).toBeNull();
    expect(propuestaDeDia("Revisión semanal", viernes)).toBeNull();
    expect(propuestaDeDia("Revision", viernes)).toBeNull();
  });

  it("borrar las palabras del dia NO propone nada (no se pierde la rutina)", () => {
    expect(propuestaDeDia("Revisión semanal los viernes", viernes)).toBeNull();
    // Y el caso simetrico: el texto ya no nombra dia, la tarea si.
    expect(propuestaDeDia("Revisión semanal los viernes", domingo)).not.toBeNull();
  });

  it("una tarea que no se repetia y el texto si propone: es nueva", () => {
    const p = propuestaDeDia("Gimnasio los martes", undefined);
    expect(p!.esNueva).toBe(true);
    expect(p!.weekdays).toEqual([M]);
  });

  it("una rutina semanal SIN dia fijo tambien es un cambio", () => {
    // «cada semana» no dice qué día, y por eso el texto sí tiene algo que decir.
    const p = propuestaDeDia("Revisión semanal los viernes", { kind: "weekly", every: 1 });
    expect(p!.weekdays).toEqual([V]);
    expect(p!.esNueva).toBe(false);
  });

  it("de una rutina mensual a una semanal: tambien lo avisa", () => {
    const p = propuestaDeDia("Pagar el alquiler los lunes", { kind: "monthly", every: 1, dayOfMonth: 1 });
    expect(p!.weekdays).toEqual([L]);
    expect(p!.esNueva).toBe(false);
  });

  it("no se rompe con dias repetidos ni desordenados", () => {
    expect(propuestaDeDia("Clase los miércoles y lunes y miércoles", domingo)!.weekdays).toEqual([L, X]);
    expect(propuestaDeDia("Clase los miércoles y lunes", { kind: "weekly", every: 1, weekdays: [L, X] })).toBeNull();
  });

  it("no le importa el resto del texto", () => {
    expect(propuestaDeDia("Revisión de los papeles los viernes", domingo)!.weekdays).toEqual([V]);
  });

  // Con una lista de 7 dias la propuesta no puede ser identica por casualidad.
  it("el sabado contra la semana entera se propone", () => {
    const p = propuestaDeDia("Repaso los sábados", { kind: "weekly", every: 1, weekdays: [D, L, M, X, J, V, S] });
    expect(p!.weekdays).toEqual([S]);
  });
});