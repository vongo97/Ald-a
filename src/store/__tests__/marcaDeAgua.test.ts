import { describe, expect, it } from "vitest";
import { avanzarMarca, desdeDondeMirar } from "../marcaDeAgua";

/**
 * La bajada era `select("*")` en cada sincronización. Al subir la frecuencia a
 * 30 segundos, eso pasó a ser «traerse la tabla entera cada medio minuto»:
 * invisibles con 14 tareas, y con unos cientos, cuota del proyecto y batería del
 * móvil. Estos tests fijan la aritmética que decide qué se pide.
 *
 * La consecuencia de equivocarse aquí no es un error visible: es una fila que no
 * se vuelve a pedir nunca. Por eso los casos que parecen paranoidos —el minuto de
 * margen, el reloj atrasado— están aquí y no son adornos.
 */
describe("desdeDondeMirar: por donde se empieza a mirar", () => {
  it("sin marca previa se mira TODO (no se filtra)", () => {
    // La primera bajada de un dispositivo tiene que ser completa. Si se
    // filtrara por una marca inventada, el dispositivo arrancaría vacío y con
    // la nube «al día», que es la peor forma de perder datos: no hay aviso.
    expect(desdeDondeMirar(null)).toBeNull();
  });

  it("con marca previa se resta un minuto de margen", () => {
    const desde = desdeDondeMirar("2026-10-02T12:00:00.000Z");
    expect(desde).toBe("2026-10-02T11:59:00.000Z");
  });

  it("el margen recupera la fila escrita en el MISMO instante que la marca", () => {
    // El caso que mata al filtro ingenuo. Postgres guarda `updated_at` con
    // precisión de microsegundos pero dos escrituras dentro del mismo segundo
    // pueden caer en el mismo valor; si una se escribe justo en la marca,
    // «mayor que la marca» la descarta para siempre y nunca vuelve a salir.
    // Un minuto de solape la hace volver.
    const marca = "2026-10-02T12:00:00.000Z";
    const filaEnElMismoInstante = Date.parse(marca);
    expect(filaEnElMismoInstante > Date.parse(desdeDondeMirar(marca)!)).toBe(true);
  });

  it("el margen absorbe un reloj DESVIADO dentro del margen", () => {
    // Un móvil cuyo reloj va 30 segundos adelantado guarda una marca 30 segundos
    // por delante de la nube. Sin margen, las filas escritas en ese rato se
    // declararían «ya bajadas» sin haberlas visto nunca.
    const marca = "2026-10-02T12:00:30.000Z"; // reloj adelantado
    const filaEnElTramo = "2026-10-02T12:00:10.000Z"; // escrita de verdad a las 12:00:10
    expect(Date.parse(filaEnElTramo) > Date.parse(desdeDondeMirar(marca)!)).toBe(true);
  });

  it("un reloj DESVIADO en minutos no se disimula, y es a propósito", () => {
    // Esto no se tapa con un margen mayor. Un reloj con minutos de desfase es un
    // problema del dispositivo, no del filtro: taparlo significaría volver a
    // bajar casi todo y perder el ahorro sin arreglar la causa. Y el lado
    // peligroso —el reloj Adelantado— solo se tapa dentro del margen.
    const marca = "2026-10-02T12:02:00.000Z";
    expect(Date.parse("2026-10-02T12:00:10.000Z") > Date.parse(desdeDondeMirar(marca)!)).toBe(false);
  });

  it("un reloj atrasado no cuesta nada", () => {
    // El caso contrario y el que da igual: guardar la marca en el pasado solo
    // hace que la siguiente bajada pregunte de más, y preguntar de más es
    // inofensivo porque la fusión compara por `updated_at`.
    const marca = "2026-10-02T11:58:00.000Z";
    expect(desdeDondeMirar(marca)).toBe("2026-10-02T11:57:00.000Z");
  });

  it("una marca corrupta se ignora en vez de romper la sincronización", () => {
    // Mejor una bajada completa que ninguna: perder datos por un `localStorage`
    // medio borrado sería el peor resultado posible de un ahorro de ancho de banda.
    expect(desdeDondeMirar("no-es-una-fecha")).toBeNull();
    expect(desdeDondeMirar("")).toBeNull();
  });

  it("una marca anterior a 1970 no se recorta al epoch", () => {
    // El código recortaba con `Math.max(0, …)` y con eso quitaba justo el margen
    // en el único caso en que más falta hacía. Un instante negativo es una
    // fecha válida para `timestamptz`, así que no hay motivo para recortarlo.
    expect(desdeDondeMirar("1970-01-01T00:00:00.000Z")).toBe("1969-12-31T23:59:00.000Z");
  });
});

describe("avanzarMarca: cuando se puede subir el listón", () => {
  it("sin marca previa, arranca en la hora de ahora", () => {
    const ahora = new Date("2026-10-02T12:00:30.000Z");
    expect(avanzarMarca(null, { ahora })).toBe("2026-10-02T12:00:30.000Z");
  });

  it("el reloj de la nube gana sobre el del móvil", () => {
    // `server_now` es lo que dice el servidor. Si el móvil va atrasado, guardar
    // esa hora es lo que mantiene viva la comparación: al revés, la marca
    // avanzaría más despacio que la nube y no pasa nada; si guardara una hora
    // de futuro, las filas de entremedias no se volverían a pedir nunca.
    const resultado = avanzarMarca("2026-10-02T12:00:00.000Z", {
      servidor: "2026-10-02T12:00:05.000Z",
      ahora: new Date("2026-10-02T11:00:00.000Z"),
    });
    expect(resultado).toBe("2026-10-02T12:00:05.000Z");
  });

  it("NUNCA retrocede", () => {
    // Un reloj que va atrás, o un `server_now` raro, no puede hacer que la app
    // vuelva a pedir «desde el principio» para siempre en cada sincronización.
    const resultado = avanzarMarca("2026-10-02T12:00:00.000Z", {
      servidor: "2026-10-02T11:00:00.000Z",
      ahora: new Date("2026-10-02T11:30:00.000Z"),
    });
    expect(resultado).toBe("2026-10-02T12:00:00.000Z");
  });

  it("con el reloj de la nube inusable, cae al reloj del móvil", () => {
    const resultado = avanzarMarca(null, {
      servidor: "basura",
      ahora: new Date("2026-10-02T12:00:30.000Z"),
    });
    expect(resultado).toBe("2026-10-02T12:00:30.000Z");
  });
});
