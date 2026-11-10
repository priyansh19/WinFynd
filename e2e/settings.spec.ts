import { expect, test } from "@playwright/test";
import { calls } from "./calls";
import { installTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installTauriMock);
});

test("every settings page opens, Find a setting filters, and a switch saves", async ({ page }) => {
  await page.goto("/index.html");
  const nav = page.getByRole("navigation", { name: "Settings sections" });

  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expect(page.getByText("Everything is ready to search")).toBeVisible();

  await nav.getByRole("button", { name: "Folders" }).click();
  await expect(page.getByRole("heading", { name: "Folders", level: 1 })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Allow full OS context" })).toBeChecked();

  await nav.getByRole("button", { name: "Models" }).click();
  await expect(page.getByRole("heading", { name: "Models", level: 1 })).toBeVisible();
  await expect(page.getByText("The search model runs inside WinFynd")).toBeVisible();

  await nav.getByRole("button", { name: "Shortcuts & voice" }).click();
  await expect(page.getByRole("heading", { name: "Shortcuts & voice", level: 1 })).toBeVisible();
  await expect(page.getByText("Talk to search")).toBeVisible();

  await nav.getByRole("button", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
  await expect(page.getByText("Your files never leave this PC")).toBeVisible();

  await nav.getByRole("button", { name: "About" }).click();
  await expect(page.getByRole("heading", { name: "About", level: 1 })).toBeVisible();
  await expect(page.getByText("Version 0.1.1")).toBeVisible();

  const find = page.getByRole("combobox", { name: "Find a setting" });
  await find.fill("whisper");
  const matches = page.locator("#setting-matches");
  // "whisper" hits the Whisper model and speech-in-recordings, and nothing else.
  await expect(matches.getByRole("option")).toHaveCount(2);
  await expect(matches.getByRole("option", { name: /^Whisper/ })).toBeVisible();
  await expect(matches.getByRole("option", { name: /Speech in recordings and videos/ })).toBeVisible();
  await expect(matches.getByRole("option", { name: /Pause reading files/ })).toHaveCount(0);
  await matches.getByRole("option", { name: /^Whisper/ }).click();

  await expect(page.getByRole("heading", { name: "Models", level: 1 })).toBeVisible();
  await expect(page.locator("[data-setting='Whisper']")).toBeVisible();

  await nav.getByRole("button", { name: "Folders" }).click();
  const online = page.getByRole("switch", { name: "OneDrive files that are only online" });
  await expect(online).not.toBeChecked();
  await online.click();
  await expect(online).toBeChecked();

  await expect
    .poll(async () => {
      const saved = await calls(page, "set_engine_config");
      const config = saved.at(-1)?.args.config as { readOnlineFiles?: boolean; wholePc?: boolean } | undefined;
      return config ? { readOnlineFiles: config.readOnlineFiles, wholePc: config.wholePc } : null;
    })
    .toEqual({ readOnlineFiles: true, wholePc: true });
});
