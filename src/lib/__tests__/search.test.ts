import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  search,
  ask,
  transcribeVoice,
  openResult,
  revealResult,
  thumbnailUrl,
  secondsOf,
  mediaUrl,
  modelLabel,
  folderOf,
  formatSize,
  groupResults,
  withoutPhrase,
  PHOTO_GRID_MIN,
  type SearchResult,
  type SearchResponse,
  type Answer,
} from "../search";

vi.mock("@tauri-apps/api/core");

describe("search.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockResult: SearchResult = {
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
  };

  describe("search", () => {
    it("calls invoke with correct parameters", async () => {
      const mockResponse: SearchResponse = {
        hits: [mockResult],
        semantic: true,
        filters: [],
      };
      vi.mocked(invoke).mockResolvedValue(mockResponse);

      const result = await search("test query");

      expect(invoke).toHaveBeenCalledWith("search", { query: "test query", limit: 30 });
      expect(result.hits).toHaveLength(1);
      expect(result.semantic).toBe(true);
    });

    it("returns empty results on no matches", async () => {
      vi.mocked(invoke).mockResolvedValue({ hits: [], semantic: true, filters: [] });

      const result = await search("nonexistent");

      expect(result.hits).toHaveLength(0);
    });

    it("handles errors gracefully", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("Search failed"));

      await expect(search("test")).rejects.toThrow("Search failed");
    });
  });

  describe("ask", () => {
    it("calls invoke with question", async () => {
      const mockAnswer: Answer = {
        text: "Test answer",
        sources: [{ n: 1, name: "doc.pdf", path: "C:\\doc.pdf", location: "Page 1" }],
        model: "llama3.2:3b",
      };
      vi.mocked(invoke).mockResolvedValue(mockAnswer);

      const result = await ask("What is the answer?");

      expect(invoke).toHaveBeenCalledWith("ask", { question: "What is the answer?" });
      expect(result.text).toBe("Test answer");
      expect(result.sources).toHaveLength(1);
    });
  });

  describe("transcribeVoice", () => {
    it("converts Float32Array to array and calls invoke", async () => {
      vi.mocked(invoke).mockResolvedValue("transcribed text");
      const samples = new Float32Array([0.1, 0.2, 0.3]);

      const result = await transcribeVoice(samples);

      expect(invoke).toHaveBeenCalledWith("transcribe_voice", {
        samples: [0.1, 0.2, 0.3],
      });
      expect(result).toBe("transcribed text");
    });

    it("handles empty audio", async () => {
      vi.mocked(invoke).mockResolvedValue("");
      const samples = new Float32Array([]);

      const result = await transcribeVoice(samples);

      expect(result).toBe("");
    });

    it("handles transcription errors", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("The speech model isn't downloaded yet."));
      const samples = new Float32Array([0.1, 0.2]);

      await expect(transcribeVoice(samples)).rejects.toThrow("speech model");
    });
  });

  describe("openResult and revealResult", () => {
    it("openResult calls invoke with path", async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await openResult("C:\\test.pdf");

      expect(invoke).toHaveBeenCalledWith("open_path", { path: "C:\\test.pdf" });
    });

    it("revealResult calls invoke with path", async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await revealResult("C:\\test.pdf");

      expect(invoke).toHaveBeenCalledWith("reveal_path", { path: "C:\\test.pdf" });
    });
  });

  describe("thumbnailUrl", () => {
    it("returns null for non-image kinds", () => {
      expect(thumbnailUrl({ kind: "document", path: "C:\\doc.pdf" })).toBeNull();
      expect(thumbnailUrl({ kind: "video", path: "C:\\video.mp4" })).toBeNull();
    });

    it("returns asset URL for images in Tauri", () => {
      const result = thumbnailUrl({ kind: "image", path: "C:\\photo.jpg" });
      expect(result).toContain("asset://");
    });
  });

  describe("secondsOf", () => {
    it("converts MM:SS format", () => {
      expect(secondsOf("1:23")).toBe(83);
      expect(secondsOf("12:34")).toBe(754);
    });

    it("converts HH:MM:SS format", () => {
      expect(secondsOf("1:02:03")).toBe(3723);
      expect(secondsOf("2:30:45")).toBe(9045);
    });

    it("returns null for non-timestamps", () => {
      expect(secondsOf("Page 3")).toBeNull();
      expect(secondsOf("Slide 5")).toBeNull();
      expect(secondsOf("")).toBeNull();
      expect(secondsOf(null)).toBeNull();
      expect(secondsOf(undefined)).toBeNull();
    });

    it("returns null for invalid formats", () => {
      expect(secondsOf("1:2")).toBeNull();
      expect(secondsOf("123")).toBeNull();
    });
  });

  describe("mediaUrl", () => {
    it("returns null for non-media kinds", () => {
      const result: SearchResult = { ...mockResult, kind: "document" };
      expect(mediaUrl(result)).toBeNull();
    });

    it("returns URL with timestamp for videos", () => {
      const result: SearchResult = { ...mockResult, kind: "video", location: "1:23" };
      const url = mediaUrl(result);
      expect(url).toContain("#t=83");
    });

    it("returns URL without timestamp when location is not a timestamp", () => {
      const result: SearchResult = { ...mockResult, kind: "audio", location: null };
      const url = mediaUrl(result);
      expect(url).not.toContain("#t=");
    });
  });

  describe("modelLabel", () => {
    it("formats model names", () => {
      expect(modelLabel("llama3.2:3b")).toBe("llama3.2 3B");
      expect(modelLabel("llama3.2:7b")).toBe("llama3.2 7B");
      expect(modelLabel("qwen:0.5b")).toBe("qwen 0.5B");
    });

    it("removes :latest suffix", () => {
      expect(modelLabel("llama3.2:latest")).toBe("llama3.2");
    });

    it("handles models without size suffix", () => {
      expect(modelLabel("custom-model")).toBe("custom-model");
    });
  });

  describe("folderOf", () => {
    it("extracts folder from Windows path", () => {
      expect(folderOf("C:\\Users\\test\\file.txt")).toBe("C:\\Users\\test");
    });

    it("extracts folder from Unix path", () => {
      expect(folderOf("/home/user/file.txt")).toBe("/home/user");
    });

    it("handles root paths", () => {
      expect(folderOf("C:\\file.txt")).toBe("C:");
      expect(folderOf("/file.txt")).toBe("");
    });

    it("handles paths without separators", () => {
      expect(folderOf("file.txt")).toBe("file.txt");
    });
  });

  describe("formatSize", () => {
    it("formats bytes as KB", () => {
      expect(formatSize(512)).toBe("1 KB");
      expect(formatSize(1024)).toBe("1 KB");
      expect(formatSize(2048)).toBe("2 KB");
    });

    it("formats bytes as MB", () => {
      expect(formatSize(1048576)).toBe("1.0 MB");
      expect(formatSize(5242880)).toBe("5.0 MB");
    });

    it("formats bytes as GB", () => {
      expect(formatSize(1073741824)).toBe("1.0 GB");
      expect(formatSize(2147483648)).toBe("2.0 GB");
    });

    it("shows minimum 1 KB", () => {
      expect(formatSize(100)).toBe("1 KB");
    });
  });

  describe("groupResults", () => {
    it("groups confident results by kind", () => {
      const results: SearchResult[] = [
        { ...mockResult, id: 1, kind: "document" },
        { ...mockResult, id: 2, kind: "image" },
        { ...mockResult, id: 3, kind: "document" },
      ];

      const groups = groupResults(results);
      // First result becomes "best match", so documents group has 1 item (id: 3)
      const docGroup = groups.find((g) => g.key === "document");
      expect(docGroup?.items).toHaveLength(1);
    });

    it("shows best match for multiple results", () => {
      const results: SearchResult[] = [
        { ...mockResult, id: 1 },
        { ...mockResult, id: 2 },
      ];

      const groups = groupResults(results);
      expect(groups[0].key).toBe("best");
      expect(groups[0].items).toHaveLength(1);
    });

    it("does not show best match for photos leading", () => {
      const results: SearchResult[] = [
        { ...mockResult, id: 1, kind: "image" },
        { ...mockResult, id: 2, kind: "image" },
        { ...mockResult, id: 3, kind: "image" },
      ];

      const groups = groupResults(results);
      expect(groups[0].key).not.toBe("best");
      expect(groups[0].key).toBe("image");
    });

    it("separates weaker matches", () => {
      const results: SearchResult[] = [
        { ...mockResult, id: 1, confident: true },
        { ...mockResult, id: 2, confident: false },
      ];

      const groups = groupResults(results);
      const weakGroup = groups.find((g) => g.key === "weak");
      expect(weakGroup?.items).toHaveLength(1);
      expect(weakGroup?.label).toBe("Weaker matches");
    });

    it("groups video moments separately", () => {
      const results: SearchResult[] = [
        { ...mockResult, id: 1, kind: "video", reason: "Shown at 1:23" },
        { ...mockResult, id: 2, kind: "video", reason: "Shown at 2:45" },
        { ...mockResult, id: 3, kind: "video", reason: "Text matches" },
      ];

      const groups = groupResults(results);
      const inVideoGroup = groups.find((g) => g.key === "invideo");
      expect(inVideoGroup).toBeTruthy();
      expect(inVideoGroup?.items).toHaveLength(2); // Two "Shown at" videos after best match
    });

    it("combines documents and spreadsheets", () => {
      const results: SearchResult[] = [
        { ...mockResult, id: 1, kind: "document" },
        { ...mockResult, id: 2, kind: "spreadsheet" },
      ];

      const groups = groupResults(results);
      // First becomes "best match", second goes to documents group
      const bestGroup = groups.find((g) => g.key === "best");
      const docGroup = groups.find((g) => g.key === "document");
      expect(bestGroup?.items).toHaveLength(1);
      expect(docGroup?.items).toHaveLength(1);
      expect(docGroup?.items[0].kind).toBe("spreadsheet"); // Spreadsheet in documents group
    });

    it("requires minimum photos for grid", () => {
      expect(PHOTO_GRID_MIN).toBeGreaterThan(1);
    });
  });

  describe("withoutPhrase", () => {
    it("removes phrase from query", () => {
      expect(withoutPhrase("photo of blue sofa", "photo")).toBe("of blue sofa");
    });

    it("is case insensitive", () => {
      expect(withoutPhrase("Photo of blue sofa", "photo")).toBe("of blue sofa");
    });

    it("normalizes whitespace", () => {
      expect(withoutPhrase("photo  of   blue", "photo")).toBe("of blue");
    });

    it("returns original if phrase not found", () => {
      expect(withoutPhrase("blue sofa", "photo")).toBe("blue sofa");
    });

    it("trims result", () => {
      expect(withoutPhrase("  photo  ", "photo")).toBe("");
    });
  });
});
