import qrcode from "qrcode-generator";

/**
 * Matriz de módulos de un código QR generada LOCALMENTE en el dispositivo
 * (sin servicios externos: la nada sale hasta que el usuario comparte).
 * `true` = módulo oscuro. Se usa en la tarjeta de compartir para que quien
 * la reciba pueda escanearla y llegar a la app.
 *
 * Nivel de corrección «M» (15 %): el punto dulce entre tamaño y fiabilidad.
 * El modo byte cubre cualquier URL ASCII.
 */
export function qrMatrix(text: string): boolean[][] {
  // 0 = tipo automático; si la librería no supiera estimarlo, probamos
  // capacidad creciente hasta que quepa el texto («too long»).
  const CAPACIDADES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
  let qr: ReturnType<typeof qrcode> | null = null;
  let ultimoError: unknown = null;

  for (const type of CAPACIDADES) {
    if (qr) break;
    try {
      const q = qrcode(type, "M");
      q.addData(text);
      q.make();
      qr = q;
    } catch (err) {
      ultimoError = err; // «data is too long» — seguimos con más capacidad
    }
  }

  if (!qr) {
    throw new Error(
      `El enlace es demasiado largo para el código QR (${
        ultimoError instanceof Error ? ultimoError.message : "error desconocido"
      })`,
    );
  }

  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, row) =>
    Array.from({ length: n }, (_, col) => qr.isDark(row, col)),
  );
}
