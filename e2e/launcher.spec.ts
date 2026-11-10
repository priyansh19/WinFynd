import { expect, test } from "@playwright/test";
import { calls } from "./calls";
import { installTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installTauriMock);
});

test("search shows grouped results with snippets", async ({ page }) => {
  await page.goto("/launcher.html");
  const box = page.getByRole("combobox", { name: "Search your files" });
  await box.fill("receipt for the blue sofa");

  const list = page.getByRole("listbox", { name: "Results" });
  await expect(list).toBeVisible();
  await expect(list.getByText("Best match")).toBeVisible();
  await expect(list.getByText("Photos")).toBeVisible();
  await expect(list.getByText("Documents")).toBeVisible();
  await expect(list.getByRole("option", { name: /Northwind_Order_88412\.pdf/ })).toBeVisible();
  await expect(list.getByRole("option", { name: /IMG_2041\.jpg/ })).toBeVisible();
  await expect(list.getByRole("option", { name: /Living room budget\.xlsx/ })).toBeVisible();
  // The row's second line is the matched place plus a snippet of the file, not the raw hit.
  await expect(list.getByText("Page 2")).toBeVisible();
  await expect(list.getByText(/navy velvet/)).toBeVisible();
  await expect(list.getByText("Sheet Furniture")).toBeVisible();
});

test("an unknown query shows the empty state", async ({ page }) => {
  await page.goto("/launcher.html");
  await page.getByRole("combobox", { name: "Search your files" }).fill("zzzz-no-such-file");
  await expect(page.getByRole("heading", { name: "No files match yet" })).toBeVisible();
  await expect(page.getByText("Nothing on this PC looks like this.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask instead" })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Results" })).toHaveCount(0);
});

test("a rejected search shows the error state", async ({ page }) => {
  await page.goto("/launcher.html?search=error");
  await page.getByRole("combobox", { name: "Search your files" }).fill("receipt");
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("The index isn't ready");
  await expect(page.getByRole("listbox", { name: "Results" })).toHaveCount(0);
});

test("arrow keys move the selection and Enter opens that file", async ({ page }) => {
  await page.goto("/launcher.html");
  const box = page.getByRole("combobox", { name: "Search your files" });
  await box.fill("sofa receipt");
  const list = page.getByRole("listbox", { name: "Results" });
  const photo = list.getByRole("option", { name: /IMG_2041\.jpg/ });
  await expect(photo).toBeVisible();
  await expect(photo).not.toHaveAttribute("aria-selected", "true");

  await box.press("ArrowDown");
  await expect(photo).toHaveAttribute("aria-selected", "true");
  await box.press("Enter");

  await expect
    .poll(async () => {
      const opened = await calls(page, "open_path");
      return opened.map((c) => c.args.path);
    })
    .toEqual(["C:\\Users\\gupta\\Pictures\\Receipts\\IMG_2041.jpg"]);
});

test("Tab opens Ask mode, and an offline model is called out on the idle launcher", async ({ page }) => {
  await page.goto("/launcher.html?ollama=offline");
  // Notes renders this only while search is idle and the engine reports Ollama offline.
  await expect(page.getByText("Search by meaning is off because the search model isn't running.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Set up models" })).toBeVisible();

  await page.getByRole("combobox", { name: "Search your files" }).press("Tab");

  await expect(page.getByRole("button", { name: "Ask Tab" })).toHaveAttribute("aria-pressed", "true");
  const ask = page.getByRole("combobox", { name: "Ask a question about your files" });
  await expect(ask).toBeVisible();
  await expect(page.getByText("Ask about anything in your files.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to results" })).toBeVisible();
  // Ask mode replaces the idle note; the offline copy is not a second panel inside Ask.
  await expect(page.getByText("Search by meaning is off because the search model isn't running.")).toHaveCount(0);
});
