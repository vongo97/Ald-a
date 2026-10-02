import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { crearPoller, arrancarPoller } from "../poller";

/**
 * El fallo que motivó esto no era «lento»: era que la app no miraba la nube
 * nunca mientras estaba abierta. Estos tests fijan que ahora sí, y que no
 * dispara donde no debe — que es donde se va la batería.
 */
describe("poller de sincronización", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("mira la nube cada 30 s si la app está a la vista", async () => {
    // Async a propósito: entre un tick y el siguiente la sincronización
    // anterior ha terminado. Sin dejar correr los microtasks entre advances, el
    // candado sigue cerrado —que es lo correcto— y el test mediría otra cosa.
    const sincronizar = vi.fn().mockResolvedValue(undefined);
    arrancarPoller({ cadaMs: 30_000, sincronizar, visible: () => true });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(sincronizar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sincronizar).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(sincronizar).toHaveBeenCalledTimes(5);
  });

  it("NO mira la nube en segundo plano", () => {
    const sincronizar = vi.fn().mockResolvedValue(undefined);
    arrancarPoller({ cadaMs: 30_000, sincronizar, visible: () => false });

    vi.advanceTimersByTime(300_000);
    // Ni una petición a Supabase con la app en el bolsillo: los navegadores
    // congelan la página y, aunque no, es gastar datos sin que nadie mire.
    expect(sincronizar).not.toHaveBeenCalled();
  });

  it("al volver al primer plano sincroniza en el acto, sin esperar al tick", () => {
    let vista = false;
    const sincronizar = vi.fn().mockResolvedValue(undefined);
    const p = arrancarPoller({ cadaMs: 30_000, sincronizar, visible: () => vista });

    vista = true;
    p.alVolver();
    expect(sincronizar).toHaveBeenCalledTimes(1);
    // Y no espera: si alguien estuvo 10 minutos en otra app, esa espera es
    // justo lo que se nota.
    expect(sincronizar.mock.calls.length).toBe(1);
  });

  it("una sincronización lenta no se encadena", async () => {
    // El caso que un candado mal puesto dispara siempre: si sincronizar tarda
    // más que el intervalo, cada tick abre otra y se acumulan.
    let liberar!: () => void;
    const sincronizar = vi.fn(() => new Promise<void>((r) => (liberar = r)));
    arrancarPoller({ cadaMs: 30_000, sincronizar, visible: () => true });

    vi.advanceTimersByTime(120_000); // 4 ticks en un minuto
    expect(sincronizar).toHaveBeenCalledTimes(1);
    liberar();
  });

  it("el flag se libera aunque la sincronización reviente", async () => {
    // Si no, el temporizador queda muerto para siempre y el síntoma es «la app
    // no sincroniza» —sin error, sin aviso— en lugar de un fallo visible.
    const sincronizar = vi.fn().mockRejectedValue(new Error("se cayó la red"));
    arrancarPoller({ cadaMs: 30_000, sincronizar, visible: () => true });

    vi.advanceTimersByTime(30_000);
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(30_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(sincronizar).toHaveBeenCalledTimes(2);
  });

  it("una sincronización que revienta NO deja un rechazo sin atender", async () => {
    // Regresión: con `.finally()` el temporizador sí liberaba el candado, pero la
    // promesa devuelta volvía a rechazar sin que nadie la recogiera. El
    // síntoma era un «unhandled rejection» en la consola cada 30 segundos
    // mientras la red fallara, y Vitest lo marca como «posible falso positivo
    // en los tests». Pasa por `then` con los dos handlers.
    const rechazo = vi.fn().mockRejectedValue(new Error("se cayó la red"));
    arrancarPoller({ cadaMs: 30_000, sincronizar: rechazo, visible: () => true });

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    // Si algo se escapara, vitest lo contaría como error no atendido.
    expect(rechazo).toHaveBeenCalledTimes(2);
  });

  it("parar() corta el temporizador de verdad", () => {
    const sincronizar = vi.fn().mockResolvedValue(undefined);
    const p = arrancarPoller({ cadaMs: 30_000, sincronizar, visible: () => true });

    vi.advanceTimersByTime(30_000);
    expect(sincronizar).toHaveBeenCalledTimes(1);
    p.parar();
    vi.advanceTimersByTime(300_000);
    expect(sincronizar).toHaveBeenCalledTimes(1);
  });

  it("sin document (node) se considera visible, para poder probarlo", () => {
    // Si por defecto fuera `false` en node, todos los tests de arriba pasarían
    // sin llegar a sincronizar: falso positivo.
    const sincronizar = vi.fn().mockResolvedValue(undefined);
    arrancarPoller({ cadaMs: 1000, sincronizar });
    vi.advanceTimersByTime(1000);
    expect(sincronizar).toHaveBeenCalledTimes(1);
  });

  it("crearPoller sin arrancar no hace nada por sí solo", () => {
    const sincronizar = vi.fn().mockResolvedValue(undefined);
    const p = crearPoller({ cadaMs: 30_000, sincronizar, visible: () => true });
    vi.advanceTimersByTime(300_000);
    expect(sincronizar).not.toHaveBeenCalled();
    p.tick();
    expect(sincronizar).toHaveBeenCalledTimes(1);
  });
});