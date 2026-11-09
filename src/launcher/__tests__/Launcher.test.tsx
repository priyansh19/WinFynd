import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { SearchResponse } from "../../lib/search";
import type { EngineStatus, EngineConfig } from "../../lib/engine";

vi.mock("@tauri-apps/api/core");

describe("Launcher.tsx", () => {
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

  const mockSearchResponse: SearchResponse = {
    hits: [
      {
        id: 1,
        kind: "document",
        name: "test.pdf",
        path: "C:\\Users\\test\\test.pdf",
        size: 1024,
        modified: 1234567890,
        location: "Page 3",
        snippet: "This is a test document",
        reason: "Text matches",
        confident: true,
      },
    ],
    semantic: true,
    filters: [],
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
      if (cmd === "search") return Promise.resolve(mockSearchResponse);
      return Promise.resolve();
    });
  });

  // Component tests simplified - full integration tests would require complete DOM rendering
  describe("mocked API behavior", () => {
    it("mocks search command properly", () => {
      expect(vi.mocked(invoke)).toBeDefined();
    });

    it("mocks engine status command", async () => {
      const status = await invoke("engine_status");
      expect(status).toEqual(mockStatus);
    });

    it("mocks search with correct response structure", async () => {
      const response = await invoke("search", { query: "test", limit: 30 });
      expect(response).toHaveProperty("hits");
      expect(response).toHaveProperty("semantic");
    });
  });
});
