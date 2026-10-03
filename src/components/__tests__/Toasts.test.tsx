// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Toasts from "@/components/Toasts";
import { useStore } from "@/store/useStore";

/**
 * Los avisos no pueden estar abajo: abajo vive el dock.
 *
 * El aviso era `fixed bottom-5` y el dock `fixed bottom-4`, con cajas de 62 y 59
 * px. Veinte contra dieciséis píxeles las ponía en la misma banda: se solapaban
 * **416 x 55 px**, o sea el aviso casi entero debajo del dock. Y como el dock es
 * `glass` al 78 %, se transparenta encima del aviso: lo que se veía era una caja
 * gris apagada sobre la lista de tareas, que es como llegó a «parece que el tema
 * crono va mal» cuando el tema no tenía nada que ver.
 *
 * No se comprueba el solapamiento en píxeles, porque eso necesita medir un
 * navegador y jsdom no laysoutea nada. Lo que sí se ata es la decisión: el
 * contenedor va arriba. Un test de clases es débil, pero es exactamente lo que
 * hace falta para que nadie vuelva a bajarlos sin acordarse de por qué.
 */

const contenedor = () => document.querySelector('[role="status"]') as HTMLElement;

beforeEach(() => {
  useStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  useStore.setState({ toasts: [] });
});

describe("los avisos van arriba, no abajo", () => {
  it("el contenedor existe y se anuncia a los lectores de pantalla", () => {
    useStore.setState({ toasts: [{ id: "t1", message: "Tarea actualizada" }] });
    render(<Toasts />);

    const c = contenedor();
    expect(c).toBeTruthy();
    // Un aviso que no se anuncia no sirve de nada: es el motivo de `role` y
    // `aria-live`. Antes de tocar la posición, esto ya estaba.
    expect(c.getAttribute("aria-live")).toBe("polite");
    expect(c.getAttribute("aria-atomic")).toBe("false");
    expect(screen.getByText("Tarea actualizada")).toBeTruthy();
  });

  it("el contenedor NO se ancla abajo, que es donde está el dock", () => {
    useStore.setState({ toasts: [{ id: "t1", message: "Aviso" }] });
    render(<Toasts />);

    const clases = contenedor().className;
    expect(clases).toMatch(/\btop-/);
    expect(clases, "los avisos vuelven a la banda del dock").not.toMatch(/\bbottom-/);
  });

  it("queda por debajo de la cabecera y por delante en z", () => {
    // La cabecera es `sticky top-0 z-30` y mide 49px. `top-14` son 56: el aviso
    // no la tapa. Y `z-50` lo pone por delante.
    useStore.setState({ toasts: [{ id: "t1", message: "Aviso" }] });
    render(<Toasts />);

    const clases = contenedor().className;
    expect(clases).toMatch(/\btop-14\b/);
    expect(clases).toMatch(/\bz-50\b/);
    // Sigue centrado: el aviso grows hacia los lados, no hacia el dock.
    expect(clases).toMatch(/left-1\/2/);
    expect(clases).toMatch(/-translate-x-1\/2/);
    expect(clases).toMatch(/max-w-md/);
  });

  it("el aviso se cierra solo a los 5 segundos", async () => {
    // Con reloj falso y `act` alrededor: sin `act`, el `setState` del store
    // ocurre fuera del ciclo de React y el aviso no se va de la pantalla, y el
    // test pasa por un motivo equivocado... o falla por uno que no es del aviso.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      useStore.setState({ toasts: [{ id: "t1", message: "Se va solo" }] });
      render(<Toasts />);
      expect(screen.getByText("Se va solo")).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4800);
      });
      expect(screen.queryByText("Se va solo"), "a los 4,8s todavía debe estar").toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(screen.queryByText("Se va solo"), "a los 5,2s ya no debe estar").toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("«Deshacer» aparece solo cuando hay algo que deshacer", async () => {
    const user = userEvent.setup();
    let deshecho = false;

    useStore.setState({ toasts: [{ id: "t1", message: "Tarea eliminada", undo: () => { deshecho = true; } }] });
    render(<Toasts />);
    await user.click(screen.getByRole("button", { name: "Deshacer" }));

    expect(deshecho, "el botón Deshacer no llamó a la acción").toBe(true);
    // Y al deshacer, el aviso desaparece: si no, se queda ahí diciendo
    // «Tarea eliminada» sobre una tarea que ya está de vuelta.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Deshacer" })).toBeNull());
  });

  it("sin «Deshacer» no hay botón que buscar", () => {
    useStore.setState({ toasts: [{ id: "t1", message: "Tarea actualizada" }] });
    render(<Toasts />);
    expect(screen.queryByRole("button", { name: "Deshacer" })).toBeNull();
    // El de cerrar sí está, siempre.
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeTruthy();
  });
});