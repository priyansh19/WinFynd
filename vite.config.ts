import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Two pages, one per Tauri window: the floating launcher and the Control Center.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: "es2021",
    rollupOptions: {
      input: {
        control: fileURLToPath(new URL("index.html", import.meta.url)),
        launcher: fileURLToPath(new URL("launcher.html", import.meta.url)),
      },
    },
  },
});
