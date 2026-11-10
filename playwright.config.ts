import { defineConfig, devices } from "@playwright/test";

// UI tests drive the Vite dev server in a browser. Tauri's IPC is installed
// by e2e/tauri-mock.ts before the app loads, so the real React trees run
// without the Rust host. Chromium stands in for WebView2's browser engine;
// it does not boot the packaged app.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:1420",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    permissions: ["microphone"],
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 1420",
    url: "http://127.0.0.1:1420/launcher.html",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
