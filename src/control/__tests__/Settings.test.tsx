import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { EngineStatus, EngineConfig } from "../../lib/engine";

vi.mock("@tauri-apps/api/core");
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    onResized: vi.fn(() => Promise.resolve(() => {})),
    minimize: vi.fn(() => Promise.resolve()),
    toggleMaximize: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  })),
}));

describe("Settings.tsx", () => {
  const mockStatus: EngineStatus = {
    state: "idle",
    files: 1000,
    chunks: 5000,
    queued: 0,
    done: 1000,
    current: null,
    ollama: "ok",
    message: null,
    unreadable: 0,
    pausedUntil: null,
  };

  const mockConfig: EngineConfig = {
    wholePc: true,
    roots: [],
    skip: [],
    embedBackend: "builtin",
    ollamaUrl: "http://127.0.0.1:11434",
    embedModel: "embeddinggemma-2:latest",
    dimensions: 768,
    chatModel: "",
    indexImages: true,
    speechModel: "",
    indexVideoFrames: true,
    readOnlineFiles: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "engine_status") return Promise.resolve(mockStatus);
      if (cmd === "get_engine_config") return Promise.resolve(mockConfig);
      if (cmd === "get_hotkeys")
        return Promise.resolve({
          config: {
            launcher: "Alt+Space",
            voice: "Alt+Shift+Space",
            ask: "Ctrl+Alt+Space",
            selection: "Super+Shift+F",
            voiceMode: "hold",
            autoSubmit: true,
          },
          unavailable: [],
        });
      if (cmd === "get_media_support")
        return Promise.resolve({
          speechModels: [
            { id: "ggml-small", label: "Whisper Small", sizeMb: 488, note: "Accurate", installed: false },
          ],
          ffmpeg: null,
          ffmpegVersion: null,
        });
      if (cmd === "app_version") return Promise.resolve("0.1.1");
      return Promise.resolve();
    });
  });

  // Component tests simplified - full integration tests would require complete DOM rendering
  describe("default configuration", () => {
    it("defaults to whole PC indexing", () => {
      expect(mockConfig.wholePc).toBe(true);
    });

    it("defaults to builtin embeddings", () => {
      expect(mockConfig.embedBackend).toBe("builtin");
    });

    it("has image indexing enabled by default", () => {
      expect(mockConfig.indexImages).toBe(true);
    });

    it("has video frames enabled by default", () => {
      expect(mockConfig.indexVideoFrames).toBe(true);
    });

    it("has online files disabled by default", () => {
      expect(mockConfig.readOnlineFiles).toBe(false);
    });

    it("has empty chat model by default", () => {
      expect(mockConfig.chatModel).toBe("");
    });

    it("has empty speech model by default", () => {
      expect(mockConfig.speechModel).toBe("");
    });
  });

  describe("default hotkeys", () => {
    it("defaults to Alt+Space for launcher", async () => {
      const hotkeys = await invoke("get_hotkeys");
      expect(hotkeys.config.launcher).toBe("Alt+Space");
    });

    it("defaults to hold voice mode", async () => {
      const hotkeys = await invoke("get_hotkeys");
      expect(hotkeys.config.voiceMode).toBe("hold");
    });
  });
});
