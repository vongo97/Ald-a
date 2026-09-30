import { describe, it, expect } from "vitest";
import {
  CX,
  CY,
  R_ARCO,
  CARRILES,
  SW_ARCO,
  SW_HIJO,
  HIT_ARCO,
  HIT_HIJO,
  PAD_GRADOS,
  toMin,
  degOf,
  polar,
  tramoDe,
  tieneHora,
  arcSpan,
  arcPath,
  arcoDelDia,
  minutosDeHoy,
  fracDia,
  desenrollar,
  HORAS_LECTURA,
  packLanes,
  eyebrowDe,
  dyParaEtiquetas,
  pintarReloj,
} from "../orbit";
import type { Task } from "@/domain/types";

/** Fábrica mínima de tareas para pintar el reloj en tests. */
const tarea = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  labels: [],
  priority: 3,
  importance: 3,
  status: "todo",
  order: 0,
  createdAt: "2026-09-29T08:00:00.000Z",
  ...extra,
});

describe("toMin / degOf / polar", () => {
  it("convierte HH:MM a minutos", () => {
    expect(toMin("00:00")).toBe(0);
    expect(toMin("09:05")).toBe(545);
    expect(toMin("23:59")).toBe(1439);
  });

  it("0° es medianoche arriba y 1440 min vuelven a 360°", () => {
    expect(degOf(0)).toBe(0);
    expect(degOf(720)).toBe(180);
    expect(degOf(1440)).toBe(360);
  });

  it("polar dibuja 0° arriba y 90° a la derecha, desde el centro 115,115", () => {
    const arriba = polar(72, 0);
    expect(arriba.x).toBeCloseTo(CX, 5);
    expect(arriba.y).toBeCloseTo(CY - 72, 5);

    const dcha = polar(72, 90);
    expect(dcha.x).toBeCloseTo(CX + 72, 5);
    expect(dcha.y).toBeCloseTo(CY, 5);
  });
});

describe("tramoDe", () => {
  it("usa el bloque completo", () => {
    expect(tramoDe({ timeBlock: { start: "16:00", end: "17:30" } })).toEqual([960, 1050]);
  });

  it("bloque invertido o que cruza medianoche se vuelve tramo de 30 min", () => {
    expect(tramoDe({ timeBlock: { start: "23:30", end: "00:15" } })).toEqual([1410, 1439]);
    expect(tramoDe({ timeBlock: { start: "23:45", end: "23:00" } })).toEqual([1425, 1439]);
  });

  it("hora suelta es un tramo de ±15 min, sin pasar de los límites del día", () => {
    expect(tramoDe({ dueTime: "18:30" })).toEqual([1095, 1125]);
    expect(tramoDe({ dueTime: "00:05" })).toEqual([0, 20]);
    expect(tramoDe({ dueTime: "23:58" })).toEqual([1423, 1439]);
    expect(tramoDe({ dueTime: "23:55" })).toEqual([1420, 1439]);
  });
});

describe("arcSpan — compensación de puntas redondas + padAngle", () => {
  it("un bloque de 90 min (22,5°) pinta exactamente su duración", () => {
    const cap = ((SW_ARCO / 2 / 72) * 180) / Math.PI;
    const margen = cap + PAD_GRADOS / 2;
    const { a, b } = arcSpan(72, 960, 1050); // 16:00 → 17:30
    expect(a).toBeCloseTo(degOf(960) + margen, 5);
    expect(b).toBeCloseTo(degOf(1050) - margen, 5);
    expect(b - a).toBeCloseTo(22.5 - 2 * margen, 5);
    // visible = path + 2 puntas redondeadas = duración - pad
    const visible = b - a + 2 * cap;
    expect(visible).toBeCloseTo(22.5 - PAD_GRADOS, 5);
  });

  it("tramos de 30 min o menos se reducen a un punto centrado", () => {
    const mid = degOf(1110); // 18:30
    const { a, b } = arcSpan(72, 1095, 1125);
    expect(a).toBeCloseTo(mid - 0.3, 5);
    expect(b).toBeCloseTo(mid + 0.3, 5);
  });

  it("a radio pequeño la compensación resta más grados", () => {
    const enAnillo = arcSpan(CARRILES[0], 960, 1050);
    const enCarrilInterno = arcSpan(CARRILES[3], 960, 1050);
    const spanAnillo = enAnillo.b - enAnillo.a;
    const spanInterno = enCarrilInterno.b - enCarrilInterno.a;
    // r pequeño ⇒ el cap ocupa más grados ⇒ más margen ⇒ path más corto
    expect(spanInterno).toBeLessThan(spanAnillo);
    expect(spanInterno).toBeGreaterThan(0);
  });
});

describe("packLanes", () => {
  it("tareas encadenadas comparten carril 0", () => {
    expect(packLanes([[0, 60], [60, 120], [120, 180]])).toEqual([0, 0, 0]);
  });

  it("solapes pasan al siguiente carril y vuelven cuando hay hueco", () => {
    // A 0-120, B 30-90 (solapa ⇒ carril 1), C 120-180 (carril 0 libre otra vez)
    expect(packLanes([[0, 120], [30, 90], [120, 180]])).toEqual([0, 1, 0]);
  });

  it("REGRESIÓN: 6 tareas seguidas nunca dan carriles fuera de rango", () => {
    // Todas se pisan (09:00-17:00): 4 carriles y el resto se apila en el último.
    const tramos = Array.from({ length: 6 }, () => [540, 1020] as [number, number]);
    const lanes = packLanes(tramos);
    expect(lanes).toHaveLength(6);
    for (const l of lanes) {
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThan(CARRILES.length);
    }
    // Los cuatro primeros ocupan los cuatro carriles
    expect(lanes.slice(0, 4)).toEqual([0, 1, 2, 3]);
  });
});

describe("eyebrowDe", () => {
  it("pinta el antetítulo del mockup: «DOMINGO · 27 SEP»", () => {
    expect(eyebrowDe("2026-09-27")).toBe("DOMINGO · 27 SEP");
  });

  it("meses de un dígito sin cero: «JUEVES · 1 OCT»", () => {
    expect(eyebrowDe("2026-10-01")).toBe("JUEVES · 1 OCT");
  });
});

describe("dyParaEtiquetas — ninguna etiqueta se pisa", () => {
  const ancho = 68;
  it("etiquetas separadas no se mueven", () => {
    const dyps = dyParaEtiquetas([
      { x: 30, y: 100, lado: "I", ancho },
      { x: 30, y: 40, lado: "I", ancho }, // 60 px arriba: sin choque
      { x: 200, y: 100, lado: "D", ancho },
    ]);
    expect(dyps).toEqual([0, 0, 0]);
  });

  it("dos del mismo lado y misma banda: la segunda se va hacia fuera (−14, arriba del centro)", () => {
    const dyps = dyParaEtiquetas([
      { x: 31, y: 100, lado: "I", ancho },
      { x: 20, y: 100, lado: "I", ancho }, // anclaje a 11 < 68 y Δy 0 ⇒ choque
    ]);
    expect(dyps).toEqual([0, -14]);
  });

  it("bajo el centro el empujón es hacia abajo (+): nunca hacia dentro del anillo", () => {
    const dyps = dyParaEtiquetas([
      { x: 93, y: 196, lado: "I", ancho },
      { x: 92, y: 196, lado: "I", ancho },
    ]);
    expect(dyps).toEqual([0, 14]);
    // la segunda queda a y=210 ⇒ radio desde el centro crece (sale del anillo)
    expect(Math.hypot(92 - 115, 210 - 115)).toBeGreaterThan(Math.hypot(92 - 115, 196 - 115));
  });

  it("las tres del mismo punto (sobre el centro) reparten [0, −14, −28] y la cuarta −42", () => {
    const p = (x: number) => ({ x, y: 100, lado: "I" as const, ancho });
    const dyps = dyParaEtiquetas([p(31), p(30), p(29), p(28)]);
    expect(dyps).toEqual([0, -14, -28, -42]);
  });

  it("ocho idénticas: todas encuentran tertulia propia hacia fuera/dentro", () => {
    const p = (x: number) => ({ x, y: 100, lado: "I" as const, ancho });
    const dyps = dyParaEtiquetas(Array.from({ length: 8 }, (_, i) => p(31 - i)));
    expect(dyps).toEqual([0, -14, -28, -42, -56, 14, 28, 42]);
    expect(new Set(dyps).size).toBe(8);
  });

  it("ninguna tertulia saca el texto de la tarjeta ni lo mete en el anillo", () => {
    // Cinco apiladas muy arriba: −28/−42/−56 se saldrían de la tarjeta
    // y +42/+56 bajarían hasta el anillo (radio < 78) ⇒ descartadas;
    // la quinta hace mejor esfuerzo solapándose con la cuarta.
    const dyps = dyParaEtiquetas(
      Array.from({ length: 5 }, (_, i) => ({ x: 100 - 2 * i, y: 6, lado: "I" as const, ancho })),
    );
    expect(dyps).toEqual([0, -14, 14, 28, 28]);
    for (const dy of dyps) {
      expect(6 + dy).toBeGreaterThanOrEqual(-14);
      expect(Math.hypot(100 - CX, 6 + dy - 115)).toBeGreaterThanOrEqual(78);
    }
  });

  it("REGRESIÓN: ninguna tertulia mete el ancla dentro del anillo (radio ≥ 78)", () => {
    // Seis idénticas abajo del centro: si alguna bajase hacia dentro
    // (y−14 ⇒ radio 70) el texto cruzaría los arcos de colores.
    const dyps = dyParaEtiquetas(
      Array.from({ length: 6 }, (_, i) => ({ x: 93 - i, y: 196, lado: "I" as const, ancho })),
    );
    expect(dyps).toEqual([0, 14, 28, 42, 56, 56]); // la 6ª, sin sitio: solape mejor que cruce
    for (const dy of dyps) {
      expect(Math.hypot(93 - CX, 196 + dy - 115)).toBeGreaterThanOrEqual(78);
    }
  });

  it("lados opuestos nunca compiten", () => {
    const dyps = dyParaEtiquetas([
      { x: 31, y: 100, lado: "I", ancho },
      { x: 199, y: 100, lado: "D", ancho },
    ]);
    expect(dyps).toEqual([0, 0]);
  });
});

describe("tieneHora", () => {
  it("bloque u hora suelta cuentan; nada no", () => {
    expect(tieneHora({ timeBlock: { start: "16:00", end: "17:00" } })).toBe(true);
    expect(tieneHora({ dueTime: "18:30" })).toBe(true);
    expect(tieneHora({})).toBe(false);
  });
});

describe("arcSpan — grosor propio (arcos-hijo)", () => {
  it("un arco fino compensa menos que uno grueso; el defecto sigue siendo SW_ARCO", () => {
    const fino = arcSpan(72, 960, 1050, SW_HIJO);
    const grueso = arcSpan(72, 960, 1050);
    expect(fino.b - fino.a).toBeGreaterThan(grueso.b - grueso.a);
    expect(arcSpan(72, 960, 1050).a).toBeCloseTo(grueso.a, 10);
    // …y la duración visible sigue siendo la real (duración − pad)
    const cap = ((SW_HIJO / 2 / 72) * 180) / Math.PI;
    expect(fino.b - fino.a + 2 * cap).toBeCloseTo(22.5 - PAD_GRADOS, 5);
  });
});

describe("zonas de toque — nunca alcanzan el carril vecino", () => {
  it("REGRESIÓN: media zona de toque < separación entre carriles (11 px)", () => {
    const separacion = CARRILES[0] - CARRILES[1]; // 72 − 61
    expect(separacion).toBe(11);
    // Con HIT_ARCO = 24 (la constante antigua) 24/2 = 12 > 11: el toque
    // caía en el centro del carril vecino y completaba otra tarea.
    expect(HIT_ARCO / 2).toBeLessThan(separacion);
    expect(HIT_HIJO / 2).toBeLessThan(separacion);
    expect(HIT_ARCO / 2).toBeGreaterThanOrEqual(SW_ARCO / 2); // cubre el arco pintado
    expect(HIT_HIJO / 2).toBeGreaterThanOrEqual(SW_HIJO / 2);
    // y sigue sin rozar el borde exterior del anillo (donde viven las etiquetas)
    expect(R_ARCO + HIT_ARCO / 2).toBeLessThan(84);
  });
});

describe("pintarReloj — despliegue en el reloj", () => {
  const padre = tarea("padre", { timeBlock: { start: "16:00", end: "17:30" } });
  const hija = tarea("hija", { parentId: "padre", timeBlock: { start: "16:00", end: "16:30" } });
  const hijaSinHora = tarea("hijaSinHora", { parentId: "padre" });

  it("cerrado: solo la raíz; abierto: el desglose (hija con arco, sin hora con etiqueta)", () => {
    const todas = [padre, hija, hijaSinHora];

    const cerrado = pintarReloj(todas, new Set());
    expect(cerrado.map((n) => n.task.id)).toEqual(["padre"]);
    expect(cerrado[0]).toMatchObject({ esRaiz: true, conHijos: true, abierto: false, nivel: 0, colorIdx: 0 });

    const abierto = pintarReloj(todas, new Set(["padre"]));
    expect(abierto.map((n) => n.task.id)).toEqual(["padre", "hija", "hijaSinHora"]);
    expect(abierto[1]).toMatchObject({
      esRaiz: false,
      raizId: "padre",
      colorIdx: 0,
      nivel: 1,
      conHijos: false,
      abierto: false,
      tramo: [960, 990],
    });
    // La hija sin hora no se sienta en un carril pero se ancla en el ángulo de la madre
    const nSin = abierto[2];
    expect(nSin.tramo).toBeNull();
    expect(nSin.ang).toBe(abierto[0].ang);
    expect(nSin.nivel).toBe(1);
  });

  it("la raíz nunca se completa al tocar: lleva casilla (conCheck = raíz || conHijos)", () => {
    // Regla de interacción: raíz ⇒ checkbox; hija con hijas propias ⇒ checkbox.
    const sola = tarea("sola", { dueTime: "18:30" });
    const [nSola] = pintarReloj([sola], new Set());
    expect(nSola.esRaiz && nSola.conHijos).toBe(false); // tocar la completa… pero es raíz: desglosa
    expect(nSola.esRaiz).toBe(true);
    expect(nSola.conHijos).toBe(false); // ⇒ toque = flujo de desglose
    const [nPadre] = pintarReloj([padre], new Set());
    expect(nPadre.esRaiz || nPadre.conHijos).toBe(true); // ⇒ casilla en la etiqueta
  });

  it("tarea con hora cuyo padre no está en el anillo (ausente o sin hora) es raíz", () => {
    const conPadreAusente = tarea("huerfana", { parentId: "del-otro-dia", dueTime: "10:00" });
    const [n1] = pintarReloj([conPadreAusente], new Set());
    expect(n1.esRaiz).toBe(true);

    const padreLibre = tarea("libre", { parentId: "ausente" }); // padre sin hora hoy
    const hijaConHora = tarea("hijaConHora", { parentId: "libre", dueTime: "10:00" });
    const nodos = pintarReloj([padreLibre, hijaConHora], new Set());
    expect(nodos.map((n) => n.task.id)).toEqual(["hijaConHora"]);
    expect(nodos[0].esRaiz).toBe(true);
  });

  it("las raíces se ordenan por hora y colorean por su índice", () => {
    const b = tarea("b", { timeBlock: { start: "12:00", end: "13:00" } });
    const a = tarea("a", { timeBlock: { start: "09:00", end: "10:00" } });
    const hijaDeB = tarea("hijaDeB", { parentId: "b", timeBlock: { start: "12:00", end: "12:30" } });
    const nodos = pintarReloj([b, a, hijaDeB], new Set(["b"]));
    expect(nodos.map((n) => n.task.id)).toEqual(["a", "b", "hijaDeB"]);
    expect(nodos.map((n) => n.colorIdx)).toEqual([0, 1, 1]); // la hija hereda el color de su raíz
  });

  it("una tarea sin hora nunca abre el reloj (vive en «Sin hora»)", () => {
    const libre = tarea("libre");
    expect(pintarReloj([libre], new Set())).toEqual([]);
    expect(pintarReloj([libre], new Set(["libre"]))).toEqual([]);
  });

  it("nieto: solo pinta si están abiertos su padre Y su abuela", () => {
    const raiz = tarea("raiz", { timeBlock: { start: "16:00", end: "18:00" } });
    const madre = tarea("madre", { parentId: "raiz", timeBlock: { start: "16:00", end: "17:00" } });
    const nieto = tarea("nieto", { parentId: "madre", timeBlock: { start: "16:00", end: "16:30" } });
    const soloRaiz = pintarReloj([raiz, madre, nieto], new Set(["raiz"]));
    expect(soloRaiz.map((n) => n.task.id)).toEqual(["raiz", "madre"]);
    const completo = pintarReloj([raiz, madre, nieto], new Set(["raiz", "madre"]));
    expect(completo.map((n) => n.task.id)).toEqual(["raiz", "madre", "nieto"]);
    expect(completo[2].nivel).toBe(2);
    expect(completo[2].raizId).toBe("raiz");
  });

  it("conHijos no exige hijas con hora (el despliegue también puede ser de etiquetas)", () => {
    const p = tarea("p", { timeBlock: { start: "16:00", end: "17:00" } });
    const h = tarea("h", { parentId: "p" });
    const [n] = pintarReloj([p, h], new Set());
    expect(n.conHijos).toBe(true);
    expect(n.abierto).toBe(false);
    const [n2] = pintarReloj([p, h], new Set(["p"]));
    expect(n2.abierto).toBe(true);
  });

  it("hijas ordenadas: con hora por su tramo, sin hora al final por orden", () => {
    const p = tarea("p", { timeBlock: { start: "16:00", end: "18:00" } });
    const tardia = tarea("tardia", { parentId: "p", order: 0, timeBlock: { start: "17:00", end: "17:30" } });
    const temprana = tarea("temprana", { parentId: "p", order: 1, timeBlock: { start: "16:00", end: "16:30" } });
    const sinHora = tarea("sinHora", { parentId: "p", order: 2 });
    const nodos = pintarReloj([p, tardia, temprana, sinHora], new Set(["p"]));
    expect(nodos.map((n) => n.task.id)).toEqual(["p", "temprana", "tardia", "sinHora"]);
  });

  it("REGRESIÓN: un bucle de padres no se cuelga, no pierde tareas y no duplica", () => {
    const a = tarea("a", { parentId: "b", timeBlock: { start: "09:00", end: "10:00" } });
    const b = tarea("b", { parentId: "a", timeBlock: { start: "09:00", end: "10:00" } });
    const nodos = pintarReloj([a, b], new Set(["a", "b"]));
    expect(nodos.map((n) => n.task.id).sort()).toEqual(["a", "b"]);
    expect(new Set(nodos.map((n) => n.task.id)).size).toBe(2); // sin duplicados

    // Bucle cerrado por debajo de una raíz legítima
    const raiz = tarea("raiz", { timeBlock: { start: "09:00", end: "10:00" } });
    const x = tarea("x", { parentId: "raiz", timeBlock: { start: "09:00", end: "10:00" } });
    const y = tarea("y", { parentId: "x", timeBlock: { start: "09:00", end: "10:00" } });
    const x2 = { ...x, parentId: "y" };
    const nodos2 = pintarReloj([raiz, x2, y], new Set(["raiz", "x", "y"]));
    expect(nodos2.length).toBeGreaterThanOrEqual(3); // nada desaparece
    expect(new Set(nodos2.map((n) => n.task.id)).size).toBe(nodos2.length);
  });
});

describe("packLanes — estabilidad de los carriles al desplegar", () => {
  it("las raíces no cambian de carril cuando se añade el desglose", () => {
    const raices: Array<[number, number]> = [[540, 600], [545, 660], [660, 720]];
    const hijos: Array<[number, number]> = [[550, 570], [545, 580]];
    const soloRaices = packLanes(raices);
    const conHijos = packLanes([...raices, ...hijos]);
    // packLanes es secuencial: los primeros N resultados son idénticos,
    // así que desplegar jamás mueve un arco de su carril.
    expect(conHijos.slice(0, raices.length)).toEqual(soloRaices);
    for (const l of conHijos) {
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThan(CARRILES.length);
    }
  });
});

describe("minutosDeHoy / fracDia — el reloj que sí marca la hora", () => {
  /** Fecha local con hora fija (los constructores con 'Z' se correrían). */
  const a = (h: number, m: number, s = 0) => new Date(2026, 8, 29, h, m, s);

  it("son los minutos del día, con los segundos dentro", () => {
    expect(minutosDeHoy(a(0, 0))).toBeCloseTo(0, 6);
    expect(minutosDeHoy(a(9, 30))).toBeCloseTo(570, 6);
    expect(minutosDeHoy(a(16, 0))).toBeCloseTo(960, 6);
    expect(minutosDeHoy(a(23, 59, 59))).toBeCloseTo(1439 + 59 / 60, 6);
  });

  it("REGRESIÓN: NO se trunca al minuto (si no, el segundero da tirones)", () => {
    // El bug era usar getHours()*60 + getMinutes: a las 22:39:30 salía
    // siempre 22:39 y la aguja se quedaba quieta medio minuto.
    expect(minutosDeHoy(a(22, 39, 30))).toBeCloseTo(1359 + 0.5, 6);
    expect(minutosDeHoy(a(22, 39, 0))).toBeCloseTo(1359, 6);
    expect(minutosDeHoy(a(22, 39, 30))).not.toBeCloseTo(1359, 3);
  });

  it("fracDia va de 0 a 1 a lo largo del día", () => {
    expect(fracDia(a(0, 0))).toBeCloseTo(0, 6);
    expect(fracDia(a(6, 0))).toBeCloseTo(0.25, 6);
    expect(fracDia(a(12, 0))).toBeCloseTo(0.5, 6);
    expect(fracDia(a(18, 0))).toBeCloseTo(0.75, 6);
    expect(fracDia(a(23, 59, 59))).toBeLessThan(1);
    expect(fracDia(a(23, 59, 59))).toBeGreaterThan(0.999);
  });

  it("la fracción de la tarde es la que la aguja muestra", () => {
    // El arco del día y la aguja se calculan del MISMO número: si no,
    // la punta del anillo y la aguja marcarían horas distintas.
    const ahora = a(22, 39, 30);
    expect(degOf(minutosDeHoy(ahora))).toBeCloseTo(360 * fracDia(ahora), 9);
  });
});

describe("desenrollar — la aguja no retrocede al cambiar de día", () => {
  it("el tick normal se respeta tal cual", () => {
    expect(desenrollar(0, 0.0167)).toBeCloseTo(0.0167, 6);
    expect(desenrollar(1359, 1359.5)).toBeCloseTo(1359.5, 6);
  });

  it("REGRESIÓN: cruzar medianoche no hace dar la vuelta a la aguja", () => {
    // Sin esto la rotación salta de ~359,9° a 0° y la aguja gira en
    // contra durante un segundo, una vez al día.
    expect(desenrollar(1439.99, 0.01)).toBeCloseTo(1440.01, 6);
    expect(degOf(desenrollar(1439.99, 0.01))).toBeGreaterThan(degOf(1439.99));
  });

  it("un retroceso pequeño (hora de verano) sí se respeta", () => {
    // 60 min hacia atrás es un ajuste de reloj, no un cambio de día.
    expect(desenrollar(600, 540)).toBe(540);
  });
});

describe("HORAS_LECTURA — las cifras del disco", () => {
  it("son las cuatro horas que anclan la lectura: 00 arriba, 06 dcha, 12 abajo, 18 izq", () => {
    expect([...HORAS_LECTURA]).toEqual([0, 6, 12, 18]);
    const [medianoche, seis, mediodia, seisPM] = HORAS_LECTURA.map((h) => polar(30, degOf(h * 60)));
    expect(medianoche.x).toBeCloseTo(CX, 5);
    expect(medianoche.y).toBeCloseTo(CY - 30, 5);
    expect(seis.x).toBeCloseTo(CX + 30, 5);
    expect(seis.y).toBeCloseTo(CY, 5);
    expect(mediodia.x).toBeCloseTo(CX, 5);
    expect(mediodia.y).toBeCloseTo(CY + 30, 5);
    expect(seisPM.x).toBeCloseTo(CX - 30, 5);
    expect(seisPM.y).toBeCloseTo(CY, 5);
  });
});

describe("arcPath", () => {
  it("une los dos extremos del arco con el barrido horario", () => {
    const d = arcPath(24, 0, 90);
    // 0° arriba (CX, CY-r) → 90° a la derecha (CX+r, CY)
    expect(d.startsWith(`M ${CX.toFixed(2)} ${(CY - 24).toFixed(2)}`)).toBe(true);
    expect(d.endsWith(`${(CX + 24).toFixed(2)} ${CY.toFixed(2)}`)).toBe(true);
    expect(d).toContain("A 24 24 0 0 1");
  });

  it("usa el arco largo (flag 1) cuando el span pasa de media vuelta", () => {
    expect(arcPath(24, 0, 179)).toContain("A 24 24 0 0 1");
    expect(arcPath(24, 0, 181)).toContain("A 24 24 0 1 1");
  });

  it("no envuelve: `a` siempre es menor que `b` (así lo dan arcSpan y arcoDelDia)", () => {
    // Si algún día alguien pasa el final antes que el principio, el path
    // sale invertido en vez de dar la vuelta entera. Mejor que se note.
    expect(arcPath(24, 300, 60)).toContain("A 24 24 0 0 1");
  });

  it("una vuelta completa no se dibuja (los extremos coinciden)", () => {
    // Por eso el anillo del día se pinta como arco 0→ahora y la pista
    // como un <circle> aparte: un path de 360° no pinta nada.
    expect(arcPath(24, 0, 360)).toContain("A 24 24 0 1 1");
    const p0 = polar(24, 0);
    const p360 = polar(24, 360);
    expect(p360.x).toBeCloseTo(p0.x, 6);
    expect(p360.y).toBeCloseTo(p0.y, 6);
  });
});

describe("arcoDelDia — el anillo del día transcurrido", () => {
  it("va siempre de medianoche (0°) a la hora actual", () => {
    expect(arcoDelDia(24, 960)).toEqual({ a: 0, b: 240 });
    expect(arcoDelDia(24, 1359.5)?.b).toBeCloseTo(degOf(1359.5), 6);
  });

  it("a mediodía está medio lleno y a las 23:59 casi entero", () => {
    expect(arcoDelDia(24, 720)!.b).toBeCloseTo(180, 6);
    expect(arcoDelDia(24, 720)!.b / 360).toBeCloseTo(0.5, 6);
    expect(arcoDelDia(24, 1439)!.b / 360).toBeGreaterThan(0.999);
  });

  it("antes de medianoche no pinta nada (y un radio 0 tampoco)", () => {
    expect(arcoDelDia(24, 0)).toBeNull();
    expect(arcoDelDia(24, -5)).toBeNull();
    expect(arcoDelDia(0, 600)).toBeNull();
  });

  it("nunca pasa de la vuelta completa aunque le den más de 24 h", () => {
    expect(arcoDelDia(24, 5000)!.b).toBe(360);
    expect(arcoDelDia(24, 1440)!.b).toBe(360);
  });

  it("justo pasada medianoche se ve un punto, no un arco de 0°", () => {
    // Con butt un span de 0 no deja marca: el día recién empezado
    // tiene que verse, aunque sea mínimo.
    const dia = arcoDelDia(24, 0.05);
    expect(dia).not.toBeNull();
    expect(dia!.b).toBeGreaterThan(0);
  });
});
