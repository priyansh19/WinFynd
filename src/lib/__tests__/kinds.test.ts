import { describe, it, expect } from "vitest";
import { kindClass, kindLabel, totalOf, about, timeLeft, kindOfPath, countByKind, type KindCounts } from "../kinds";

describe("kinds.ts", () => {
  describe("kindClass", () => {
    it("returns correct CSS class for known kinds", () => {
      expect(kindClass("document")).toBe("k-doc");
      expect(kindClass("image")).toBe("k-img");
      expect(kindClass("code")).toBe("k-code");
    });

    it("returns default class for unknown kind", () => {
      expect(kindClass("unknown")).toBe("k-other");
    });
  });

  describe("kindLabel", () => {
    it("returns correct label for known kinds", () => {
      expect(kindLabel("document")).toBe("Documents");
      expect(kindLabel("image")).toBe("Photos");
      expect(kindLabel("audio")).toBe("Recordings");
    });

    it("returns default label for unknown kind", () => {
      expect(kindLabel("unknown")).toBe("Other");
    });
  });

  describe("totalOf", () => {
    it("sums all kind counts", () => {
      const counts: KindCounts = { document: 5, image: 3, code: 2 };
      expect(totalOf(counts)).toBe(10);
    });

    it("handles empty counts", () => {
      expect(totalOf({})).toBe(0);
    });

    it("handles undefined values", () => {
      const counts: KindCounts = { document: 5, image: undefined };
      expect(totalOf(counts)).toBe(5);
    });
  });

  describe("about", () => {
    it("shows exact count below 1000", () => {
      expect(about(500)).toBe("500");
      expect(about(999)).toBe("999");
    });

    it("rounds to 2 significant figures above 1000", () => {
      expect(about(1234)).toBe("1,230"); // Rounds to nearest 10
      expect(about(5678)).toBe("5,680"); // Rounds to nearest 10
      expect(about(14200)).toBe("14,200"); // Rounds to nearest 100
    });

    it("handles large numbers", () => {
      expect(about(123456)).toBe("123,000"); // Rounds to nearest 1000
    });

    it("includes thousands separators", () => {
      expect(about(1000)).toContain(",");
    });
  });

  describe("timeLeft", () => {
    it("shows less than a minute for short durations", () => {
      expect(timeLeft(30)).toBe("less than a minute left");
      expect(timeLeft(89)).toBe("less than a minute left");
    });

    it("shows minutes for medium durations", () => {
      expect(timeLeft(120)).toBe("about 2 minutes left");
      expect(timeLeft(1800)).toBe("about 30 minutes left");
      expect(timeLeft(3540)).toBe("about 59 minutes left");
    });

    it("shows hours for long durations", () => {
      expect(timeLeft(3600)).toBe("about 1 hour left");
      expect(timeLeft(7200)).toBe("about 2 hours left");
      expect(timeLeft(5400)).toBe("about 1.5 hours left");
    });

    it("handles invalid inputs", () => {
      expect(timeLeft(0)).toBe("");
      expect(timeLeft(-100)).toBe("");
      expect(timeLeft(Infinity)).toBe("");
    });
  });

  describe("kindOfPath", () => {
    it("identifies document extensions", () => {
      expect(kindOfPath("/path/to/file.pdf")).toBe("document");
      expect(kindOfPath("/path/to/file.docx")).toBe("document");
      expect(kindOfPath("/path/to/file.txt")).toBe("document");
    });

    it("identifies image extensions", () => {
      expect(kindOfPath("/path/to/photo.jpg")).toBe("image");
      expect(kindOfPath("/path/to/photo.png")).toBe("image");
      expect(kindOfPath("/path/to/photo.webp")).toBe("image");
    });

    it("identifies video extensions", () => {
      expect(kindOfPath("/path/to/video.mp4")).toBe("video");
      expect(kindOfPath("/path/to/video.mkv")).toBe("video");
    });

    it("identifies audio extensions", () => {
      expect(kindOfPath("/path/to/audio.mp3")).toBe("audio");
      expect(kindOfPath("/path/to/audio.wav")).toBe("audio");
    });

    it("identifies code extensions", () => {
      expect(kindOfPath("/path/to/file.js")).toBe("code");
      expect(kindOfPath("/path/to/file.py")).toBe("code");
      expect(kindOfPath("/path/to/file.rs")).toBe("code");
    });

    it("identifies spreadsheet extensions", () => {
      expect(kindOfPath("/path/to/data.xlsx")).toBe("spreadsheet");
      expect(kindOfPath("/path/to/data.csv")).toBe("spreadsheet");
    });

    it("identifies slides extensions", () => {
      expect(kindOfPath("/path/to/presentation.pptx")).toBe("slides");
    });

    it("returns other for unknown extensions", () => {
      expect(kindOfPath("/path/to/file.xyz")).toBe("other");
      expect(kindOfPath("/path/to/file")).toBe("other");
    });

    it("is case insensitive", () => {
      expect(kindOfPath("/path/to/FILE.PDF")).toBe("document");
      expect(kindOfPath("/path/to/photo.JPG")).toBe("image");
    });
  });

  describe("countByKind", () => {
    it("counts and formats multiple kinds", () => {
      const result = countByKind(["image", "image", "image", "video", "document"]);
      expect(result).toBe("3 photos, 1 video, 1 document");
    });

    it("handles singular forms", () => {
      const result = countByKind(["image", "video"]);
      expect(result).toBe("1 photo, 1 video");
    });

    it("handles empty array", () => {
      const result = countByKind([]);
      expect(result).toBe("");
    });

    it("maintains order of first appearance", () => {
      const result = countByKind(["video", "image", "video", "image"]);
      expect(result).toBe("2 videos, 2 photos");
    });

    it("uses proper pluralization", () => {
      const result = countByKind(["document", "document"]);
      expect(result).toBe("2 documents");
    });
  });
});
