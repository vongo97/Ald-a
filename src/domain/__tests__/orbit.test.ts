import { describe, it, expect } from "vitest";
import {
  CX,
  CY,
  CARRILES,
  SW_ARCO,
  PAD_GRADOS,
  toMin,
  degOf,
  polar,
  tramoDe,
  arcSpan,
  packLanes,
  eyebrowDe,
  dyParaEtiquetas,
} from "../orbit";

describe("toMin / degOf / polar", () => {
  it("convierte HH:MM a minutos", () => {
    expect(toMin("00:00")).toBe(0);
    expect(toMin("09:05")).toBe(545);
    expect(toMin("23:59")).toBe(1439);
  });

  it("0° es mediodía arriba y 1440 min vuelven a 360°", () => {
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
