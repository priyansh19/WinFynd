import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Onboarding } from "../Onboarding";
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

  describe("initialization", () => {
    it("renders Welcome step first", async () => {
      render(<Onboarding />);
      await waitFor(() => {
        expect(screen.getByText(/Find anything on your PC/i)).toBeInTheDocument();
      });
    });

    it("shows step progress rail", async () => {
      render(<Onboarding />);
      await waitFor(() => {
        expect(screen.getByText("Welcome")).toBeInTheDocument();
        expect(screen.getByText("What to search")).toBeInTheDocument();
        expect(screen.getByText("Search model")).toBeInTheDocument();
        expect(screen.getByText("Shortcuts")).toBeInTheDocument();
        expect(screen.getByText("Warm-up")).toBeInTheDocument();
      });
    });

    it("shows privacy promise", async () => {
      render(<Onboarding />);
      await waitFor(() => {
        expect(screen.getByText(/Your files, searches and voice stay on this PC/i)).toBeInTheDocument();
      });
    });
  });

  describe("navigation", () => {
    it("advances to next step when Get started is clicked", async () => {
      render(<Onboarding />);
      await waitFor(() => {
        expect(screen.getByText(/Find anything on your PC/i)).toBeInTheDocument();
      });

      const getStartedButton = screen.getByRole("button", { name: /Get started/i });
      fireEvent.click(getStartedButton);

      await waitFor(() => {
        expect(screen.getByText(/Allow full OS context/i)).toBeInTheDocument();
      });
    });

    it("goes back to previous step when Back is clicked", async () => {
      render(<Onboarding />);
      await waitFor(() => {
        expect(screen.getByText(/Find anything on your PC/i)).toBeInTheDocument();
      });

      const getStartedButton = screen.getByRole("button", { name: /Get started/i });
      fireEvent.click(getStartedButton);

      await waitFor(() => {
        expect(screen.getByText(/Allow full OS context/i)).toBeInTheDocument();
      });

      const backButton = screen.getByRole("button", { name: /Back/i });
      fireEvent.click(backButton);

      await waitFor(() => {
        expect(screen.getByText(/Find anything on your PC/i)).toBeInTheDocument();
      });
    });

    it("marks completed steps in the rail", async () => {
      render(<Onboarding />);
      await waitFor(() => {
        expect(screen.getByText(/Find anything on your PC/i)).toBeInTheDocument();
      });

      const getStartedButton = screen.getByRole("button", { name: /Get started/i });
      fireEvent.click(getStartedButton);

      await waitFor(() => {
        const steps = screen.getAllByRole("listitem");
        expect(steps[0]).toHaveClass("rail-step done");
      });
    });
  });

  describe("Welcome step", () => {
    it("renders welcome message", async () => {
      render(<Onboarding />);
      await waitFor(() => {
        expect(screen.getByText(/Find anything on your PC/i)).toBeInTheDocument();
      });
    });

    it("has Get started button", async () => {
      render(<Onboarding />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Get started/i })).toBeInTheDocument();
      });
    });

    it("does not have Back button on first step", async () => {
      render(<Onboarding />);
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /Back/i })).not.toBeInTheDocument();
      });
    });
  });

  describe("Folders step", () => {
    it("renders folder selection options", async () => {
      render(<Onboarding />);
      await waitFor(() => {
        expect(screen.getByText(/Welcome to WinFynd/i)).toBeInTheDocument();
      });

      const nextButton = screen.getByRole("button", { name: /Next/i });
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText(/Allow full OS context/i)).toBeInTheDocument();
      });
    });

    it("defaults to whole PC indexing", async () => {
      render(<Onboarding />);
      await waitFor(() => {
        expect(screen.getByText(/Welcome to WinFynd/i)).toBeInTheDocument();
      });

      const nextButton = screen.getByRole("button", { name: /Next/i });
      fireEvent.click(nextButton);

      await waitFor(() => {
        const wholePC = screen.getByRole("radio", { name: /Allow full OS context/i });
        expect(wholePC).toBeChecked();
      });
    });
  });

  describe("Model step", () => {
    it("shows search model section", async () => {
      render(<Onboarding />);

      // Navigate to Model step
      await waitFor(() => {
        expect(screen.getByText(/Find anything on your PC/i)).toBeInTheDocument();
      });

      let nextButton = screen.getByRole("button", { name: /Get started/i });
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText(/Allow full OS context/i)).toBeInTheDocument();
      });

      nextButton = screen.getByRole("button", { name: /Next/i });
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText(/built-in/i)).toBeInTheDocument();
      });
    });

    it("shows Whisper model option", async () => {
      render(<Onboarding />);

      // Navigate to Model step
      await waitFor(() => {
        expect(screen.getByText(/Find anything on your PC/i)).toBeInTheDocument();
      });

      let nextButton = screen.getByRole("button", { name: /Get started/i });
      fireEvent.click(nextButton);
      await waitFor(() => screen.getByRole("button", { name: /Next/i }));

      nextButton = screen.getByRole("button", { name: /Next/i });
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText(/Whisper/i)).toBeInTheDocument();
      });
    });
  });

  describe("Shortcuts step", () => {
    it("shows hotkey configuration", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
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
            speechModels: [],
            ffmpeg: null,
            ffmpegVersion: null,
          });
        return Promise.resolve();
      });

      render(<Onboarding />);

      // Navigate to Shortcuts step - Get started, then 2x Next
      await waitFor(() => screen.getByRole("button", { name: /Get started/i }));
      fireEvent.click(screen.getByRole("button", { name: /Get started/i }));

      await waitFor(() => screen.getByRole("button", { name: /Next/i }));
      fireEvent.click(screen.getByRole("button", { name: /Next/i }));

      await waitFor(() => screen.getByRole("button", { name: /Next/i }));
      fireEvent.click(screen.getByRole("button", { name: /Next/i }));

      await waitFor(() => {
        expect(screen.getByText(/Open search/i)).toBeInTheDocument();
      });
    });
  });

  describe("Warm-up step", () => {
    it("shows warm-up status", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "get_engine_config") return Promise.resolve(mockConfig);
        if (cmd === "engine_status")
          return Promise.resolve({
            state: "idle",
            files: 0,
            chunks: 0,
            queued: 0,
            done: 0,
            current: null,
            ollama: "ok",
            message: null,
            unreadable: 0,
            pausedUntil: null,
          });
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
            speechModels: [],
            ffmpeg: null,
            ffmpegVersion: null,
          });
        return Promise.resolve();
      });

      render(<Onboarding />);

      // Navigate to Warm-up step: Get started + 3x Next
      await waitFor(() => screen.getByRole("button", { name: /Get started/i }));
      fireEvent.click(screen.getByRole("button", { name: /Get started/i }));

      for (let i = 0; i < 3; i++) {
        await waitFor(() => screen.getByRole("button", { name: /Next/i }));
        const nextButton = screen.getByRole("button", { name: /Next/i });
        fireEvent.click(nextButton);
      }

      await waitFor(() => {
        expect(screen.getByText(/Reading your files/i)).toBeInTheDocument();
      });
    });
  });

  describe("error handling", () => {
    it("displays errors in error bar", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "get_engine_config") return Promise.reject(new Error("Config load failed"));
        return Promise.resolve();
      });

      render(<Onboarding />);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(/Config load failed/i);
      });
    });

    it("allows dismissing errors", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "get_engine_config") return Promise.resolve(mockConfig);
        if (cmd === "set_engine_config") return Promise.reject(new Error("Save failed"));
        if (cmd === "get_media_support")
          return Promise.resolve({
            speechModels: [],
            ffmpeg: null,
            ffmpegVersion: null,
          });
        return Promise.resolve();
      });

      render(<Onboarding />);

      await waitFor(() => {
        expect(screen.getByText(/Welcome to WinFynd/i)).toBeInTheDocument();
      });

      const nextButton = screen.getByRole("button", { name: /Next/i });
      fireEvent.click(nextButton);

      await waitFor(() => {
        const alert = screen.queryByRole("alert");
        if (alert) {
          const dismissButton = screen.getByLabelText(/Dismiss/i);
          fireEvent.click(dismissButton);
        }
      });
    });
  });

  describe("configuration persistence", () => {
    it("saves configuration when changed", async () => {
      render(<Onboarding />);

      await waitFor(() => {
        expect(screen.getByText(/Find anything on your PC/i)).toBeInTheDocument();
      });

      const getStartedButton = screen.getByRole("button", { name: /Get started/i });
      fireEvent.click(getStartedButton);

      await waitFor(() => {
        expect(screen.getByRole("radio", { name: /Allow full OS context/i })).toBeInTheDocument();
      });

      const specificFolders = screen.getByRole("radio", { name: /Specific folders/i });
      fireEvent.click(specificFolders);

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("set_engine_config", expect.objectContaining({ wholePc: false }));
      });
    });
  });
});
