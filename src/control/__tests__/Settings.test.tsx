import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Settings } from "../Settings";
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

  describe("initialization", () => {
    it("renders Settings window", async () => {
      render(<Settings />);
      await waitFor(() => {
        expect(screen.getByText("Settings")).toBeInTheDocument();
      });
    });

    it("shows navigation menu", async () => {
      render(<Settings />);
      await waitFor(() => {
        expect(screen.getByText("Home")).toBeInTheDocument();
        expect(screen.getByText("Folders")).toBeInTheDocument();
        expect(screen.getByText("Models")).toBeInTheDocument();
        expect(screen.getByText("Shortcuts & voice")).toBeInTheDocument();
        expect(screen.getByText("Privacy")).toBeInTheDocument();
        expect(screen.getByText("About")).toBeInTheDocument();
      });
    });

    it("starts on Home page by default", async () => {
      render(<Settings />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Home/i })).toHaveAttribute("aria-current", "page");
      });
    });
  });

  describe("navigation", () => {
    it("navigates to Folders page", async () => {
      render(<Settings />);
      await waitFor(() => {
        expect(screen.getByText("Home")).toBeInTheDocument();
      });

      const foldersButton = screen.getByRole("button", { name: /Folders/i });
      fireEvent.click(foldersButton);

      await waitFor(() => {
        expect(screen.getByText(/Allow full OS context/i)).toBeInTheDocument();
      });
    });

    it("navigates to Models page", async () => {
      render(<Settings />);
      await waitFor(() => {
        expect(screen.getByText("Home")).toBeInTheDocument();
      });

      const modelsButton = screen.getByRole("button", { name: /Models/i });
      fireEvent.click(modelsButton);

      await waitFor(() => {
        expect(screen.getByText(/Search model/i)).toBeInTheDocument();
      });
    });

    it("navigates to Shortcuts page", async () => {
      render(<Settings />);
      await waitFor(() => {
        expect(screen.getByText("Home")).toBeInTheDocument();
      });

      const shortcutsButton = screen.getByRole("button", { name: /Shortcuts/i });
      fireEvent.click(shortcutsButton);

      await waitFor(() => {
        expect(screen.getByText(/Open search/i)).toBeInTheDocument();
      });
    });

    it("navigates to Privacy page", async () => {
      render(<Settings />);
      await waitFor(() => {
        expect(screen.getByText("Home")).toBeInTheDocument();
      });

      const privacyButton = screen.getByRole("button", { name: /Privacy/i });
      fireEvent.click(privacyButton);

      await waitFor(() => {
        expect(screen.getByText(/Remember recent searches/i)).toBeInTheDocument();
      });
    });

    it("navigates to About page", async () => {
      render(<Settings />);
      await waitFor(() => {
        expect(screen.getByText("Home")).toBeInTheDocument();
      });

      const aboutButton = screen.getByRole("button", { name: /About/i });
      fireEvent.click(aboutButton);

      await waitFor(() => {
        expect(screen.getByText(/WinFynd/i)).toBeInTheDocument();
      });
    });

    it("highlights current page in navigation", async () => {
      render(<Settings />);
      await waitFor(() => {
        expect(screen.getByText("Home")).toBeInTheDocument();
      });

      const modelsButton = screen.getByRole("button", { name: /Models/i });
      fireEvent.click(modelsButton);

      await waitFor(() => {
        expect(modelsButton).toHaveAttribute("aria-current", "page");
      });
    });
  });

  describe("Find a setting", () => {
    it("renders search box", async () => {
      render(<Settings />);
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Find a setting/i)).toBeInTheDocument();
      });
    });

    it("shows suggestions when typing", async () => {
      render(<Settings />);
      const searchBox = await screen.findByPlaceholderText(/Find a setting/i);

      fireEvent.focus(searchBox);
      fireEvent.change(searchBox, { target: { value: "pause" } });

      await waitFor(() => {
        expect(screen.getByText(/Pause reading files/i)).toBeInTheDocument();
      });
    });

    it("navigates to page when suggestion is clicked", async () => {
      render(<Settings />);
      const searchBox = await screen.findByPlaceholderText(/Find a setting/i);

      fireEvent.focus(searchBox);
      fireEvent.change(searchBox, { target: { value: "folder" } });

      await waitFor(() => {
        expect(screen.getByText(/Add a folder/i)).toBeInTheDocument();
      });

      const suggestion = screen.getByText(/Add a folder/i);
      fireEvent.mouseDown(suggestion);

      await waitFor(() => {
        expect(screen.getByText(/Allow full OS context/i)).toBeInTheDocument();
      });
    });

    it("supports keyboard navigation", async () => {
      render(<Settings />);
      const searchBox = await screen.findByPlaceholderText(/Find a setting/i);

      fireEvent.focus(searchBox);
      fireEvent.change(searchBox, { target: { value: "model" } });

      await waitFor(() => {
        expect(screen.getByText(/Search model/i)).toBeInTheDocument();
      });

      fireEvent.keyDown(searchBox, { key: "ArrowDown" });
      fireEvent.keyDown(searchBox, { key: "Enter" });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Models/i })).toHaveAttribute("aria-current", "page");
      });
    });

    it("clears search with Escape", async () => {
      render(<Settings />);
      const searchBox = await screen.findByPlaceholderText(/Find a setting/i);

      fireEvent.change(searchBox, { target: { value: "test" } });
      expect(searchBox).toHaveValue("test");

      fireEvent.keyDown(searchBox, { key: "Escape" });
      expect(searchBox).toHaveValue("");
    });

    it("limits suggestions to 7 results", async () => {
      render(<Settings />);
      const searchBox = await screen.findByPlaceholderText(/Find a setting/i);

      fireEvent.focus(searchBox);
      fireEvent.change(searchBox, { target: { value: "o" } });

      await waitFor(() => {
        const suggestions = screen.getAllByRole("option");
        expect(suggestions.length).toBeLessThanOrEqual(7);
      });
    });
  });

  describe("Home page", () => {
    it("shows indexing status", async () => {
      render(<Settings />);
      await waitFor(() => {
        expect(screen.getByText(/1,000 files/i)).toBeInTheDocument();
      });
    });

    it("shows pause button when idle", async () => {
      render(<Settings />);
      await waitFor(() => {
        const pauseButton = screen.queryByRole("button", { name: /Pause/i });
        expect(pauseButton).toBeInTheDocument();
      });
    });
  });

  describe("Folders page defaults", () => {
    it("shows whole PC option checked by default", async () => {
      render(<Settings />);

      const foldersButton = screen.getByRole("button", { name: /Folders/i });
      fireEvent.click(foldersButton);

      await waitFor(() => {
        const wholePCRadio = screen.getByRole("radio", { name: /Allow full OS context/i });
        expect(wholePCRadio).toBeChecked();
      });
    });

    it("shows image indexing enabled by default", async () => {
      render(<Settings />);

      const foldersButton = screen.getByRole("button", { name: /Folders/i });
      fireEvent.click(foldersButton);

      await waitFor(() => {
        const imageToggle = screen.getByRole("checkbox", { name: /What's in photos/i });
        expect(imageToggle).toBeChecked();
      });
    });

    it("shows video frames enabled by default", async () => {
      render(<Settings />);

      const foldersButton = screen.getByRole("button", { name: /Folders/i });
      fireEvent.click(foldersButton);

      await waitFor(() => {
        const videoToggle = screen.getByRole("checkbox", { name: /Frames in videos/i });
        expect(videoToggle).toBeChecked();
      });
    });

    it("shows online files disabled by default", async () => {
      render(<Settings />);

      const foldersButton = screen.getByRole("button", { name: /Folders/i });
      fireEvent.click(foldersButton);

      await waitFor(() => {
        const onlineToggle = screen.getByRole("checkbox", { name: /OneDrive files/i });
        expect(onlineToggle).not.toBeChecked();
      });
    });
  });

  describe("Models page defaults", () => {
    it("shows builtin embeddings by default", async () => {
      render(<Settings />);

      const modelsButton = screen.getByRole("button", { name: /Models/i });
      fireEvent.click(modelsButton);

      await waitFor(() => {
        const builtinRadio = screen.getByRole("radio", { name: /Built-in/i });
        expect(builtinRadio).toBeChecked();
      });
    });

    it("shows empty chat model by default", async () => {
      render(<Settings />);

      const modelsButton = screen.getByRole("button", { name: /Models/i });
      fireEvent.click(modelsButton);

      await waitFor(() => {
        expect(screen.getByText(/No chat model/i)).toBeInTheDocument();
      });
    });

    it("shows Whisper not installed by default", async () => {
      render(<Settings />);

      const modelsButton = screen.getByRole("button", { name: /Models/i });
      fireEvent.click(modelsButton);

      await waitFor(() => {
        expect(screen.getByText(/not downloaded/i)).toBeInTheDocument();
      });
    });
  });

  describe("Shortcuts page defaults", () => {
    it("shows default hotkeys", async () => {
      render(<Settings />);

      const shortcutsButton = screen.getByRole("button", { name: /Shortcuts/i });
      fireEvent.click(shortcutsButton);

      await waitFor(() => {
        expect(screen.getByText(/Alt\+Space/i)).toBeInTheDocument();
      });
    });

    it("shows hold mode by default", async () => {
      render(<Settings />);

      const shortcutsButton = screen.getByRole("button", { name: /Shortcuts/i });
      fireEvent.click(shortcutsButton);

      await waitFor(() => {
        const holdRadio = screen.getByRole("radio", { name: /Hold to talk/i });
        expect(holdRadio).toBeChecked();
      });
    });
  });

  describe("Privacy page defaults", () => {
    it("shows searches are remembered by default", async () => {
      render(<Settings />);

      const privacyButton = screen.getByRole("button", { name: /Privacy/i });
      fireEvent.click(privacyButton);

      await waitFor(() => {
        const rememberToggle = screen.getByRole("checkbox", { name: /Remember recent searches/i });
        expect(rememberToggle).toBeChecked();
      });
    });
  });

  describe("error states", () => {
    it("handles status loading errors", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "engine_status") return Promise.reject(new Error("Failed to get status"));
        if (cmd === "get_engine_config") return Promise.resolve(mockConfig);
        return Promise.resolve();
      });

      render(<Settings />);

      // Should still render without crashing
      await waitFor(() => {
        expect(screen.getByText("Settings")).toBeInTheDocument();
      });
    });

    it("handles config loading errors", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "get_engine_config") return Promise.reject(new Error("Failed to get config"));
        if (cmd === "engine_status") return Promise.resolve(mockStatus);
        return Promise.resolve();
      });

      render(<Settings />);

      // Should still render without crashing
      await waitFor(() => {
        expect(screen.getByText("Settings")).toBeInTheDocument();
      });
    });
  });
});
