/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { manifest } from "./src/pwa/manifest";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src/pwa",
      filename: "sw.ts",
      registerType: "autoUpdate",
      manifest,
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/@supabase")) return "vendor-supabase";
          if (id.includes("node_modules/dexie")) return "vendor-dexie";
          if (id.includes("node_modules/@dnd-kit")) return "vendor-dnd";
          if (
            id.includes("node_modules/react") ||
            id.includes("node_modules/scheduler") ||
            id.includes("node_modules/framer-motion") ||
            id.includes("node_modules/motion")
          )
            return "vendor-react";
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: "node",
    // `scripts/` entra porque hay un test que compara la cadena de `npm run ci`
    // con los pasos del workflow, y no es del código de la app sino de que los
    // dos ejecuten lo mismo. Si no estuviera aquí, ese test no existiría en la
    // práctica: vitest ni lo miraría, y parecería que lo cubre algo que no lo
    // cubre. Ver scripts/ciMismoQueElWorkflow.test.ts.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
    // IndexedDB real en memoria: permite testear `actions.ts` contra el Dexie
    // de verdad en vez de contra un doble que se parece cada vez menos.
    // Ver src/test-setup.ts.
    setupFiles: ["./src/test-setup.ts"],
  },
});
