import { expect, test } from "@playwright/test";
import { calls } from "./calls";
import { installTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installTauriMock);
});

test("the voice button is shown and a mocked transcript fills the search box", async ({ page }) => {
  await page.goto("/launcher.html?transcribe=quarterly%20budget%20slides");

  const mic = page.getByRole("button", { name: "Search by voice" });
  await expect(mic).toBeVisible();
  await mic.click();

  const bar = page.getByRole("status").filter({ hasText: "Listening" });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("Speech stays on this PC");
  await expect(page.getByRole("button", { name: "Stop and search" })).toBeVisible();

  // Let the real recorder gather enough samples for the final transcription.
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Stop and search" }).click();

  await expect(page.getByRole("combobox", { name: "Search your files" })).toHaveValue("quarterly budget slides");
  await expect
    .poll(async () => (await calls(page, "transcribe_voice")).map((c) => (c.args.samples as number) > 0))
    .toEqual([true]);
});
