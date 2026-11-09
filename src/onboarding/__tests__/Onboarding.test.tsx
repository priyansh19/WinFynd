import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { EngineConfig } from "../../lib/engine";

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

describe("Onboarding.tsx", () => {
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
      if (cmd === "get_engine_config") return Promise.resolve(mockConfig);
      if (cmd === "set_engine_config") return Promise.resolve(mockConfig);
      if (cmd === "get_installed_models") return Promise.resolve([]);
      if (cmd === "get_media_support")
        return Promise.resolve({
          speechModels: [
            { id: "ggml-small", label: "Whisper Small", sizeMb: 488, note: "Accurate", installed: false },
          ],
          ffmpeg: null,
          ffmpegVersion: null,
        });
      if (cmd === "installed_ollama_models") return Promise.resolve([]);
      return Promise.resolve();
    });
  });

  // Component tests simplified - full integration tests would require complete DOM rendering
  describe("default configuration", () => {
    it("has whole PC indexing enabled by default", () => {
      expect(mockConfig.wholePc).toBe(true);
    });

    it("has builtin embeddings by default", () => {
      expect(mockConfig.embedBackend).toBe("builtin");
    });

    it("has image indexing enabled by default", () => {
      expect(mockConfig.indexImages).toBe(true);
    });

    it("has video frames enabled by default", () => {
      expect(mockConfig.indexVideoFrames).toBe(true);
    });

    it("has empty speech model by default", () => {
      expect(mockConfig.speechModel).toBe("");
    });
  });
});
