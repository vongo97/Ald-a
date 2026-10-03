import { describe, it, expect } from "vitest";
import { parseCapture } from "../capture";

/**
 * Regresión del título que se comía palabras.
 *
 * El fallo llevaba desde el commit inicial y era invisible: la fecha siempre
 * salía correcta, así que probando «¿entiende los viernes?» todo parecía bien.
 * Lo que se rompía era el texto, y solo se veía mirando el título completo:
 * "Entregar el informe antes del viernes" se guardaba como
 * "Entregar el informe antes del".
 */
describe("el título no se come palabras de la fecha", () => {
  const HOY = new Date("2026-10-02T09:00:00"); // viernes

  it("se lleva la preposición con el día, no la deja colgando", () => {
    expect(parseCapture("Entregar el informe antes del viernes", { now: HOY }).title).toBe(
      "Entregar el informe",
    );
    expect(parseCapture("Comprar sellos antes del cierre de la oficina del viernes", { now: HOY }).title).toBe(
      "Comprar sellos antes del cierre de la oficina",
    );
    expect(parseCapture("Mandar el documento por el lunes", { now: HOY }).title).toBe(
      "Mandar el documento",
    );
    expect(parseCapture("Hacer la compra del domingo", { now: HOY }).title).toBe("Hacer la compra");
    expect(parseCapture("Preparar la clase del jueves a las 10", { now: HOY }).title).toBe(
      "Preparar la clase",
    );
  });

  it("mantiene la fecha cuando es la que abre la frase", () => {
    // Decisión de quien usa la app: si la fecha es el sujeto, quitarla deja el
    // título a medias y ya no se lee como tarea.
    expect(parseCapture("El viernes hay reunión de equipo", { now: HOY }).title).toBe(
      "El viernes hay reunión de equipo",
    );
    expect(parseCapture("Mañana llamar al proveedor", { now: HOY }).title).toBe(
      "Mañana llamar al proveedor",
    );
  });

  it("la sigue quitando cuando sobra al final", () => {
    expect(parseCapture("Llamar al proveedor mañana", { now: HOY }).title).toBe("Llamar al proveedor");
    expect(parseCapture("Quedar con Ana el viernes", { now: HOY }).title).toBe("Quedar con Ana");
  });

  it("no toca los títulos que ya estaban bien", () => {
    expect(parseCapture("Revisar los apuntes los viernes", { now: HOY }).title).toBe("Revisar los apuntes");
    expect(parseCapture("Pagar el alquiler todos los meses", { now: HOY }).title).toBe("Pagar el alquiler");
    expect(parseCapture("Comprar pan", { now: HOY }).title).toBe("Comprar pan");
  });

  it("la fecha sigue siendo la correcta aunque el título cambie", () => {
    // Lo que se arregla es el texto, no la fecha: si esto se rompe, el arreglo
    // ha pagado con la interpretación.
    expect(parseCapture("Entregar el informe antes del viernes", { now: HOY }).dueDate).toBe("2026-10-09");
    expect(parseCapture("Mandar el documento por el lunes", { now: HOY }).dueDate).toBe("2026-10-05");
    expect(parseCapture("El viernes hay reunión de equipo", { now: HOY }).dueDate).toBe("2026-10-09");
  });

  it("no se inventa una recurrencia donde solo había una fecha", () => {
    // «del viernes» es un viernes concreto, no todos los viernes.
    expect(parseCapture("Entregar el informe antes del viernes", { now: HOY }).recurrence).toBeUndefined();
    expect(parseCapture("Revisar los apuntes los viernes", { now: HOY }).recurrence).toEqual({
      kind: "weekly",
      every: 1,
      weekdays: [5],
    });
  });

  it("no se come palabras que NO son días", () => {
    // El fallo era del «del», no de los días: aquí no hay ningún día que quitar.
    expect(parseCapture("Hablar con el cliente del seguro", { now: HOY }).title).toBe(
      "Hablar con el cliente del seguro",
    );
    expect(parseCapture("Revisar el presupuesto de la oficina", { now: HOY }).title).toBe(
      "Revisar el presupuesto de la oficina",
    );
  });
});
