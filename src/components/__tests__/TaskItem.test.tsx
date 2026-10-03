// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Task } from "@/domain/types";
import { db } from "@/store/db";
import TaskItem from "@/components/TaskItem";
import { SettingsProvider } from "@/store/SettingsContext";

/**
 * El editor en línea, en un DOM de verdad.
 *
 * Hasta ahora el teclado de `TaskItem` se comprobaba a mano en un navegador, y
 * funcionaba: Enter guarda, Escape cierra, y Enter en las notas es un salto de
 * línea y no un guardado. Comprobado en cuatro casos, contra el build, por una
 * persona. Que es justo lo que no sirve: dura hasta el próximo refactor.
 *
 * Este fichero es la razón por la que se ha metido jsdom. El repositorio no
 * tenía ningún entorno de DOM, y por eso lo del teclado era el punto más débil
 * de toda la tanda: cuatro comportamientos verificados a mano, sin red debajo.
 *
 * Montar `TaskItem` de verdad es lo que hace que esto valga. Se podría haber
 * extraído la decisión de teclado a una función pura y probarla sin DOM, pero eso
 * no comprobaría que el manejador esté en el campo correcto, ni que el `textarea`
 * se salse. Un test de la decisión pura se pone verde mientras el bug sigue en
 * el componente; uno que monta el componente no.
 *
 * Para encontrar los campos por su nombre hizo falta arreglar las etiquetas:
 * eran `<label>` sin `htmlFor`, sin relación con su campo. Un lector de pantalla
 * anunciaba «campo de texto» a secas, y una consulta por nombre no las
 * encontraba. También era la forma correcta de escribirlas desde el principio.
 */

const ID = "f529507d-4727-4edd-acc8-487ead300a87";

const tarea = (over: Partial<Task> = {}): Task => ({
  id: ID,
  title: "Tarea de prueba",
  labels: [],
  priority: 3,
  importance: 3,
  status: "todo",
  order: 0,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

/**
 * Monta el componente y devuelve el usuario de `user-event`, ya configurado.
 *
 * Con su `SettingsProvider` porque `TaskItem` trae dentro a `BreakdownButton`, que
 * lee los ajustes por contexto. Montarlo sin el contexto revienta con «useSettings
 * debe usarse dentro de SettingsProvider», que no dice nada del componente que se
 * quiere probar.
 */
async function montar(t: Task = tarea()) {
  const user = userEvent.setup();
  render(
    <SettingsProvider>
      <TaskItem task={t} />
    </SettingsProvider>,
  );
  return user;
}

/**
 * Abre el editor: despliega la fila si hace falta y pulsa el lápiz.
 *
 * El botón de desplegar se busca siempre por el título ORIGINAL, y no por el
 * que se acaba de escribir. `TaskItem` recibe la tarea como prop y no la relee de
 * la base de datos: en la app real la lista la vuelve a pasar cuando cambia, y
 * aquí el prop se queda quieto. Es una limitación del test, no de la app.
 */
async function abrirEditor(user: ReturnType<typeof userEvent.setup>) {
  if (screen.queryByRole("button", { name: /Editar/ }) === null) {
    await user.click(screen.getByRole("button", { name: tarea().title }));
  }
  await user.click(await screen.findByRole("button", { name: /Editar/ }));
}

const titulo = () => screen.getByRole("textbox", { name: "Título" });
const notas = () => screen.getByRole("textbox", { name: "Notas" });
const hayPanel = () => screen.queryByRole("button", { name: "Guardar" }) !== null;
const guardar = () => db.tasks.get(ID);

beforeEach(async () => {
  await db.tasks.clear();
  await db.projects.clear();
  await db.tombstones.clear();
  // La tarea va de verdad a la base de datos, no solo como prop. `updateTask`
  // hace `db.tasks.update(id, …)`, y sobre una fila que no existe eso no cambia
  // nada: el panel se cerraría y el test pasaría sin que se hubiera escrito.
  await db.tasks.bulkPut([tarea()]);
});

afterEach(() => cleanup());

describe("las etiquetas del editor se pueden encontrar por su nombre", () => {
  it("cada campo se anuncia con su etiqueta, no como «campo de texto»", async () => {
    const user = await montar();
    await abrirEditor(user);

    // Esto es lo que se rompe si un `label` pierde su `htmlFor`: la consulta
    // encuentra el campo por su nombre, que es exactamente lo que necesita un
    // lector de pantalla para decir «Título, edita texto».
    expect(titulo().tagName).toBe("INPUT");
    expect(notas().tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Fecha")).toBeTruthy();
    expect(screen.getByLabelText("Hora")).toBeTruthy();
    expect(screen.getByLabelText("Duración (m)")).toBeTruthy();
  });
});

describe("el editor en línea responde al teclado", () => {
  it("Enter en el título GUARDA: el panel se cierra y la tarea cambia", async () => {
    const user = await montar();
    await abrirEditor(user);

    await user.clear(titulo());
    await user.type(titulo(), "Título nuevo{Enter}");

    await waitFor(() => expect(hayPanel()).toBe(false));
    // Y lo escrito ha llegado de verdad a la base de datos. Comprobar solo que el
    // panel se cierra dejaría pasar una escritura vacía, que es el fallo más
    // probable al refactorizar.
    await waitFor(async () => expect((await guardar())?.title).toBe("Título nuevo"));
  });

  it("Enter en el título guarda TODO el panel, no solo el título", async () => {
    // Si el teclado guardara solo el título, las notas, la hora y la duración se
    // perderían sin avisar al pulsar Enter. Es el fallo de tener dos copias de la
    // misma escritura, una en el botón y otra en la tecla.
    const user = await montar();
    await abrirEditor(user);

    await user.clear(titulo());
    await user.type(titulo(), "Con fecha y nota");
    await user.type(notas(), "una nota");
    await user.type(screen.getByLabelText("Hora"), "10:30");
    await user.type(screen.getByLabelText("Duración (m)"), "45");
    await user.type(titulo(), "{Enter}");

    await waitFor(async () => {
      const g = await guardar();
      expect(g?.title).toBe("Con fecha y nota");
      expect(g?.notes).toBe("una nota");
      expect(g?.dueTime).toBe("10:30");
      expect(g?.durationMin).toBe(45);
    });
  });

  it("Escape CIERRA el panel, desde el título y desde las notas", async () => {
    const user = await montar();
    await abrirEditor(user);

    await user.type(titulo(), "se va a tirar{Escape}");
    await waitFor(() => expect(hayPanel()).toBe(false));

    // Y desde las notas, que es otro elemento con otro manejador.
    await abrirEditor(user);
    await user.type(notas(), "otra{Escape}");
    await waitFor(() => expect(hayPanel()).toBe(false));

    // Escape descarta, como en los otros cinco componentes de la app.
    await waitFor(async () => {
      const g = await guardar();
      expect(g?.title).toBe(tarea().title);
      expect(g?.notes).toBeUndefined();
    });
  });

  it("Enter en las notas es un SALTO DE LÍNEA y no un guardado", async () => {
    // El caso que se rompe sin enterarse: si el manejador de Enter estuviera en
    // el contenedor del panel, no se podría escribir una nota de dos líneas.
    const user = await montar();
    await abrirEditor(user);

    await user.type(notas(), "primera{Enter}segunda");

    expect(hayPanel()).toBe(true);
    expect((notas() as HTMLTextAreaElement).value).toBe("primera\nsegunda");
    await waitFor(async () => expect((await guardar())?.notes).toBeUndefined());
  });

  it("con el panel abierto no hay ninguna puerta que descarte en silencio", async () => {
    const user = await montar();
    await abrirEditor(user);

    // El lápiz desaparece en vez de decir «Cerrar edición»: era la única forma de
    // tirar lo escrito con un tap, sin haber mirado Cancelar ni Guardar.
    expect(screen.queryByRole("button", { name: /Editar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cerrar edición/ })).toBeNull();

    // Quedan las dos salidas, y las dos se eligen a propósito.
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeTruthy();
  });

  it("la ficha lleva `task-card-alta` solo mientras está desplegada", async () => {
    // El «cajón» del que hablaba quien usa la app. En Cronodisco la ficha hereda
    // `--radius: 999px`, y eso no significa «redondo»: el navegador lo recorta a
    // la MITAD del alto. Con la fila cerrada son 37px de curva y se lee como una
    // teja de reloj; abierta, con el editor dentro, son 185px y se convierte en un
    // balón. La clase es el sitio donde colgar «esta ya no es una fila»; en los
    // otros seis temas no hace nada.
    //
    // Se comprueba la clase, no el píxel: el radio sale de una hoja de estilos y
    // jsdom no la aplica. El píxel se midió en el navegador —74px cerrada, 370px
    // abierta— y está en el mensaje del commit.
    const user = await montar();
    const ficha = () => screen.getByText(tarea().title).closest(".task-card")!;

    expect(ficha().className).not.toMatch(/task-card-alta/);

    // Desplegar = pulsar el título.
    await user.click(screen.getByRole("button", { name: tarea().title }));
    expect(ficha().className).toMatch(/task-card-alta/);

    // Y al plegarse, vuelve a ser una fila.
    await user.click(screen.getByRole("button", { name: tarea().title }));
    expect(ficha().className).not.toMatch(/task-card-alta/);
  });
});