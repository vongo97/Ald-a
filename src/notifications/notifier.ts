/** Módulo central de notificaciones nativas del navegador. */

const PERM_KEY = "notif-perm-asked";

/** Devuelve true si el navegador soporta notificaciones. */
export function notificationsSupported(): boolean {
  return "Notification" in window;
}

/** Devuelve el permiso actual sin pedirlo. */
export function notifPermission(): NotificationPermission | "unsupported" {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Pide permiso al usuario si aún no lo ha concedido ni denegado.
 * Devuelve true si se concedió.
 */
export async function requestNotifPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  localStorage.setItem(PERM_KEY, "asked");
  const result = await Notification.requestPermission();
  return result === "granted";
}

/** ¿Ya preguntamos alguna vez? */
export function alreadyAskedPermission(): boolean {
  return !!localStorage.getItem(PERM_KEY);
}

/** Envía una notificación nativa si el permiso está concedido. */
export function sendNotification(title: string, body: string, tag?: string): void {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  const n = new Notification(title, {
    body,
    tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    silent: false,
  });
  // Cerrar automáticamente después de 8 segundos
  setTimeout(() => n.close(), 8000);
  // Al hacer clic, enfocar la ventana de la app
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

// ─── Badge ───────────────────────────────────────────────────────────────────

/** Actualiza el badge del icono de la app (PWA instalada) y el título de la pestaña. */
export function updateBadge(pendingCount: number): void {
  // Título de la pestaña
  const base = "Mis Tareas";
  document.title = pendingCount > 0 ? `(${pendingCount}) ${base}` : base;

  // Badge nativo de la PWA instalada
  if ("setAppBadge" in navigator) {
    if (pendingCount > 0) {
      void (navigator as Navigator & { setAppBadge: (n: number) => Promise<void> }).setAppBadge(pendingCount);
    } else {
      void (navigator as Navigator & { clearAppBadge: () => Promise<void> }).clearAppBadge();
    }
  }
}
