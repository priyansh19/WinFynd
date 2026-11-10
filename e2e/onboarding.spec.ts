import { expect, test } from "@playwright/test";
import { calls } from "./calls";
import { installTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installTauriMock);
});

test("setup walks Welcome through Warm-up and saves the default engine config", async ({ page }) => {
  await page.goto("/onboarding.html?state=indexing");

  const steps = page.getByRole("list", { name: "Setup steps" });
  await expect(steps.locator("[aria-current='step']")).toContainText("Welcome");
  await expect(page.getByRole("heading", { name: "Find anything on your PC by describing it." })).toBeVisible();
  await page.getByRole("button", { name: "Get started" }).click();

  await expect(steps.locator("[aria-current='step']")).toContainText("What to search");
  await expect(page.getByRole("heading", { name: "Choose what to search" })).toBeVisible();
  const wholePc = page.getByRole("switch", { name: "Allow full OS context" });
  await expect(wholePc).toBeChecked();
  await expect(page.getByText("Search all of C: and every other drive. Recommended.")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(steps.locator("[aria-current='step']")).toContainText("Search model");
  await expect(page.getByRole("heading", { name: "Download the search model" })).toBeVisible();
  await expect(page.getByText("Runs inside WinFynd")).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Search model" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Also search speech in recordings and videos/ })).toBeChecked();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(steps.locator("[aria-current='step']")).toContainText("Shortcuts");
  await expect(page.getByRole("heading", { name: "One shortcut, from any app" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try it now" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(steps.locator("[aria-current='step']")).toContainText("Warm-up");
  await expect(page.getByRole("heading", { name: "Warming up" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Reading now" })).toBeVisible();
  await page.getByRole("button", { name: "Start searching" }).click();

  await expect
    .poll(async () => (await calls(page, "finish_onboarding")).map((c) => c.args.then))
    .toEqual(["launcher"]);

  await expect
    .poll(async () => {
      const saved = await calls(page, "set_engine_config");
      const config = saved.at(-1)?.args.config as Record<string, unknown> | undefined;
      if (!config) return null;
      return {
        wholePc: config.wholePc,
        embedBackend: config.embedBackend,
        embedModel: config.embedModel,
        indexImages: config.indexImages,
        speechModel: config.speechModel,
        indexVideoFrames: config.indexVideoFrames,
        readOnlineFiles: config.readOnlineFiles,
      };
    })
    .toEqual({
      wholePc: true,
      embedBackend: "builtin",
      embedModel: "embeddinggemma-2",
      indexImages: true,
      // Speech starts off in the engine default. The model step's checked
      // "search speech" box writes Whisper Small, which is already installed.
      speechModel: "small",
      indexVideoFrames: true,
      readOnlineFiles: false,
    });
});
