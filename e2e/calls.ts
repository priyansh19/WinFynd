import type { Page } from "@playwright/test";

export interface IpcCall {
  cmd: string;
  args: Record<string, unknown>;
}

export async function calls(page: Page, cmd?: string): Promise<IpcCall[]> {
  return page.evaluate((name) => {
    const all = (window as unknown as { __WINFYND_CALLS__?: IpcCall[] }).__WINFYND_CALLS__ ?? [];
    return name ? all.filter((c) => c.cmd === name) : all;
  }, cmd ?? null);
}
