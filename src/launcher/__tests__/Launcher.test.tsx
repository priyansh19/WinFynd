import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Launcher } from "../Launcher";
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

  describe("initialization", () => {
    it("renders search box", async () => {
      render(<Launcher />);
      const searchBox = await screen.findByPlaceholderText(/Search files, photos and recordings/i);
      expect(searchBox).toBeInTheDocument();
    });

    it("starts in search mode", async () => {
      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");
      expect(searchBox).toHaveAttribute("aria-label", expect.stringContaining("Search your files"));
    });

    it("has Ask button", async () => {
      render(<Launcher />);
      const askButton = await screen.findByRole("button", { name: /Ask/i });
      expect(askButton).toBeInTheDocument();
    });

    it("has voice button", async () => {
      render(<Launcher />);
      const voiceButton = await screen.findByLabelText(/Search by voice/i);
      expect(voiceButton).toBeInTheDocument();
    });
  });

  describe("search functionality", () => {
    it("performs search when typing", async () => {
      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.change(searchBox, { target: { value: "test query" } });

      await waitFor(
        () => {
          expect(invoke).toHaveBeenCalledWith("search", { query: "test query", limit: 30 });
        },
        { timeout: 500 }
      );
    });

    it("displays search results", async () => {
      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.change(searchBox, { target: { value: "test" } });

      await waitFor(() => {
        expect(screen.getByText("test.pdf")).toBeInTheDocument();
      });
    });

    it("shows empty state for no results", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "search") return Promise.resolve({ hits: [], semantic: true, filters: [] });
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
        return Promise.resolve();
      });

      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.change(searchBox, { target: { value: "nonexistent" } });

      await waitFor(() => {
        expect(screen.getByText(/Nothing found/i)).toBeInTheDocument();
      });
    });

    it("clears results when query is cleared", async () => {
      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.change(searchBox, { target: { value: "test" } });
      await waitFor(() => {
        expect(screen.getByText("test.pdf")).toBeInTheDocument();
      });

      fireEvent.change(searchBox, { target: { value: "" } });

      await waitFor(() => {
        expect(screen.queryByText("test.pdf")).not.toBeInTheDocument();
      });
    });

    it("handles search errors", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "search") return Promise.reject(new Error("Search failed"));
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
        return Promise.resolve();
      });

      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.change(searchBox, { target: { value: "test" } });

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(/Search failed/i);
      });
    });
  });

  describe("mode switching", () => {
    it("switches to Ask mode when Tab is pressed", async () => {
      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.keyDown(searchBox, { key: "Tab" });

      await waitFor(() => {
        expect(searchBox).toHaveAttribute("aria-label", expect.stringContaining("Ask a question"));
      });
    });

    it("switches to Ask mode when Ask button is clicked", async () => {
      render(<Launcher />);
      const askButton = await screen.findByRole("button", { name: /Ask/i, pressed: false });

      fireEvent.click(askButton);

      await waitFor(() => {
        const searchBox = screen.getByRole("combobox");
        expect(searchBox).toHaveAttribute("placeholder", expect.stringContaining("Ask a question"));
      });
    });

    it("switches back to search mode from Ask mode", async () => {
      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.keyDown(searchBox, { key: "Tab" });
      await waitFor(() => {
        expect(searchBox).toHaveAttribute("placeholder", expect.stringContaining("Ask a question"));
      });

      fireEvent.keyDown(searchBox, { key: "Tab" });
      await waitFor(() => {
        expect(searchBox).toHaveAttribute("placeholder", expect.stringContaining("Search files"));
      });
    });

    it("switches back to search with Escape in Ask mode", async () => {
      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.keyDown(searchBox, { key: "Tab" });
      await waitFor(() => {
        expect(searchBox).toHaveAttribute("placeholder", expect.stringContaining("Ask a question"));
      });

      fireEvent.keyDown(searchBox, { key: "Escape" });
      await waitFor(() => {
        expect(searchBox).toHaveAttribute("placeholder", expect.stringContaining("Search files"));
      });
    });

    it("updates Ask button state when in Ask mode", async () => {
      render(<Launcher />);
      const askButton = await screen.findByRole("button", { name: /Ask/i });

      fireEvent.click(askButton);

      await waitFor(() => {
        expect(askButton).toHaveAttribute("aria-pressed", "true");
      });
    });
  });

  describe("Ask mode", () => {
    it("does not auto-search in Ask mode", async () => {
      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.keyDown(searchBox, { key: "Tab" });
      await waitFor(() => {
        expect(searchBox).toHaveAttribute("placeholder", expect.stringContaining("Ask a question"));
      });

      fireEvent.change(searchBox, { target: { value: "What is this?" } });

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(invoke).not.toHaveBeenCalledWith("ask", expect.anything());
    });

    it("asks question when Enter is pressed in Ask mode", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "ask")
          return Promise.resolve({
            text: "This is the answer",
            sources: [{ n: 1, name: "doc.pdf", path: "C:\\doc.pdf", location: "Page 1" }],
            model: "llama3.2:3b",
          });
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
        return Promise.resolve();
      });

      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.keyDown(searchBox, { key: "Tab" });
      await waitFor(() => {
        expect(searchBox).toHaveAttribute("placeholder", expect.stringContaining("Ask a question"));
      });

      fireEvent.change(searchBox, { target: { value: "What is this?" } });
      fireEvent.keyDown(searchBox, { key: "Enter" });

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("ask", { question: "What is this?" });
      });
    });

    it("shows answer when Ask completes", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "ask")
          return Promise.resolve({
            text: "This is the answer",
            sources: [{ n: 1, name: "doc.pdf", path: "C:\\doc.pdf", location: "Page 1" }],
            model: "llama3.2:3b",
          });
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
        return Promise.resolve();
      });

      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.keyDown(searchBox, { key: "Tab" });
      fireEvent.change(searchBox, { target: { value: "What is this?" } });
      fireEvent.keyDown(searchBox, { key: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("This is the answer")).toBeInTheDocument();
      });
    });

    it("handles Ask errors", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "ask") return Promise.reject(new Error("Ollama is offline"));
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
        return Promise.resolve();
      });

      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.keyDown(searchBox, { key: "Tab" });
      fireEvent.change(searchBox, { target: { value: "What is this?" } });
      fireEvent.keyDown(searchBox, { key: "Enter" });

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(/Ollama is offline/i);
      });
    });
  });

  describe("keyboard navigation", () => {
    it("closes launcher with Escape when query is empty", async () => {
      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.keyDown(searchBox, { key: "Escape" });

      expect(invoke).toHaveBeenCalledWith("hide_launcher_cmd");
    });

    it("clears query with Escape when query is not empty", async () => {
      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.change(searchBox, { target: { value: "test" } });
      fireEvent.keyDown(searchBox, { key: "Escape" });

      expect(searchBox).toHaveValue("");
      expect(invoke).not.toHaveBeenCalledWith("hide_launcher_cmd");
    });
  });

  describe("filter chips", () => {
    it("displays filter chips", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "search")
          return Promise.resolve({
            hits: mockSearchResponse.hits,
            semantic: true,
            filters: [{ label: "Photos", phrase: "photo" }],
          });
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
        return Promise.resolve();
      });

      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.change(searchBox, { target: { value: "photo of blue sofa" } });

      await waitFor(() => {
        expect(screen.getByText("Photos")).toBeInTheDocument();
      });
    });

    it("removes filter when chip is clicked", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "search")
          return Promise.resolve({
            hits: mockSearchResponse.hits,
            semantic: true,
            filters: [{ label: "Photos", phrase: "photo" }],
          });
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
        return Promise.resolve();
      });

      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.change(searchBox, { target: { value: "photo of blue sofa" } });

      await waitFor(() => {
        expect(screen.getByText("Photos")).toBeInTheDocument();
      });

      const chip = screen.getByText("Photos").closest("button");
      if (chip) fireEvent.click(chip);

      await waitFor(() => {
        expect(searchBox).toHaveValue("of blue sofa");
      });
    });
  });

  describe("empty state when Ollama is missing", () => {
    it("shows Ask suggestion when semantic search fails", async () => {
      const statusWithoutOllama = { ...mockStatus, ollama: "modelMissing" as const };

      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "search") return Promise.resolve({ hits: [], semantic: false, filters: [] });
        if (cmd === "engine_status") return Promise.resolve(statusWithoutOllama);
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
        return Promise.resolve();
      });

      render(<Launcher />);
      const searchBox = await screen.findByRole("combobox");

      fireEvent.change(searchBox, { target: { value: "test query" } });

      await waitFor(() => {
        expect(screen.getByText(/exact words only/i)).toBeInTheDocument();
      });
    });
  });
});
