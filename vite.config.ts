import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// One page per Tauri window: the floating launcher, the Control Center and first-run setup.
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
        onboarding: fileURLToPath(new URL("onboarding.html", import.meta.url)),
      },
    },
  },
});
