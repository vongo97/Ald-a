import type { ManifestOptions } from "vite-plugin-pwa";

export const manifest: Partial<ManifestOptions> = {
  id: "/",
  name: "Mis Tareas",
  short_name: "Tareas",
  description: "Gestor de tareas con captura en lenguaje natural, planes de día e IA opcional.",
  lang: "es",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#0f172a",
  theme_color: "#0f172a",
  icons: [
    {
      src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgcng9IjIwIiBmaWxsPSIjMGYxNzJhIi8+PHBhdGggZD0iTTI1IDUwIEw0MCA2NSBMNzUgMzAiIHN0cm9rZT0iIzM4YmRmOCIgc3Ryb2tlLXdpZHRoPSI4IiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48L3N2Zz4=",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any",
    },
  ],
};
