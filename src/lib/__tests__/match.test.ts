import { describe, it, expect } from "vitest";
import { queryWords, wordsIn, reasonOf, highlight, excerpt, isTimestamp } from "../match";
import type { SearchResult } from "../search";

describe("match.ts", () => {
  describe("queryWords", () => {
    it("extracts meaningful words from a query", () => {
      expect(queryWords("find blue sofa")).toEqual(["blue", "sofa"]); // "find" is a stop word
    });

    it("removes stop words", () => {
      expect(queryWords("the quick brown fox")).toEqual(["quick", "brown", "fox"]);
    });

    it("removes duplicates", () => {
      expect(queryWords("red red red")).toEqual(["red"]);
    });

    it("handles empty query", () => {
      expect(queryWords("")).toEqual([]);
    });

    it("filters single characters", () => {
      expect(queryWords("a b c dog")).toEqual(["dog"]);
    });

    it("handles unicode characters", () => {
      expect(queryWords("café naïve résumé")).toEqual(["café", "naïve", "résumé"]);
    });
  });

  describe("wordsIn", () => {
    it("finds words present in text", () => {
      expect(wordsIn("The blue sofa is comfortable", ["blue", "sofa", "red"])).toEqual(["blue", "sofa"]);
    });

    it("matches word variations (plurals)", () => {
      expect(wordsIn("There are many sofas", ["sofa"])).toEqual(["sofa"]);
    });

    it("is case insensitive", () => {
      expect(wordsIn("BLUE sofa", ["blue"])).toEqual(["blue"]);
    });

    it("handles empty arrays", () => {
      expect(wordsIn("text", [])).toEqual([]);
    });
  });

  describe("reasonOf", () => {
    const makeResult = (snippet: string, name: string, reason: string): SearchResult => ({
      id: 1,
      kind: "document",
      name,
      path: "/test.txt",
      size: 1000,
      modified: 1234567890,
      location: null,
      snippet,
      reason,
      confident: true,
    });

    it("detects visual matches", () => {
      const result = makeResult("", "photo.jpg", "Image matches the query");
      const reason = reasonOf(result, "blue sofa");
      expect(reason.kind).toBe("looks");
    });

    it("detects word matches with meaning", () => {
      const result = makeResult("blue fabric", "sofa.txt", "Text meaning matches");
      const reason = reasonOf(result, "blue sofa purchase");
      expect(reason.kind).toBe("words");
      // "blue" and "sofa" both found (sofa is in filename)
      expect(reason.words).toEqual(["blue", "sofa"]);
      expect(reason.meaning).toBeTruthy(); // "purchase" not found
    });

    it("detects word matches without meaning", () => {
      const result = makeResult("blue sofa", "furniture.txt", "Exact words");
      const reason = reasonOf(result, "blue sofa");
      expect(reason.kind).toBe("words");
      expect(reason.words).toEqual(["blue", "sofa"]);
      expect(reason.meaning).toBeNull();
    });

    it("detects name-only matches", () => {
      const result = makeResult("unrelated content", "document.txt", "Name matches");
      const reason = reasonOf(result, "other query");
      // No query words found in snippet or name, and reason starts with "Name"
      expect(reason.kind).toBe("name");
    });

    it("detects meaning-only matches", () => {
      const result = makeResult("comfortable furniture", "living.txt", "Semantic match");
      const reason = reasonOf(result, "sofa");
      expect(reason.kind).toBe("meaning");
      expect(reason.concept).toBe("sofa");
    });

    it("handles video matches", () => {
      const result = makeResult("", "video.mp4", "Shown at 1:23");
      const reason = reasonOf(result, "blue sofa");
      expect(reason.kind).toBe("looks");
    });
  });

  describe("highlight", () => {
    it("highlights matching words", () => {
      const result = highlight("The blue sofa is nice", ["blue", "sofa"]);
      // Check key properties rather than exact structure
      expect(result.length).toBeGreaterThan(1);
      expect(result.some((r) => r.hit && r.text.toLowerCase().includes("blue"))).toBe(true);
      expect(result.some((r) => r.hit && r.text.toLowerCase().includes("sofa"))).toBe(true);
    });

    it("handles no matches", () => {
      const result = highlight("Some text", ["missing"]);
      expect(result).toEqual([{ text: "Some text", hit: false }]);
    });

    it("handles empty word list", () => {
      const result = highlight("Some text", []);
      expect(result).toEqual([{ text: "Some text", hit: false }]);
    });

    it("is case insensitive", () => {
      const result = highlight("Blue SOFA", ["blue", "sofa"]);
      // Both words should be highlighted (possibly merged into one hit)
      const hits = result.filter((r) => r.hit);
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits.some((h) => h.text.toLowerCase().includes("blue"))).toBe(true);
      expect(hits.some((h) => h.text.toLowerCase().includes("sofa"))).toBe(true);
    });

    it("merges neighboring hits with comma", () => {
      const result = highlight("blue, red sofa", ["blue", "red"]);
      const hits = result.filter((r) => r.hit);
      expect(hits).toHaveLength(1);
      expect(hits[0].text).toBe("blue, red");
    });
  });

  describe("excerpt", () => {
    it("extracts snippet starting from first match", () => {
      const result = excerpt("This is a test. The blue sofa is comfortable.", ["blue"], 30);
      expect(result).toBe("The blue sofa is comfortable");
    });

    it("handles null snippets", () => {
      expect(excerpt(null, ["blue"])).toBeNull();
    });

    it("truncates long text at word boundary", () => {
      const long = "The quick brown fox jumps over the lazy dog";
      const result = excerpt(long, ["quick"], 20);
      expect(result).toBe("The quick brown fox");
      expect(result!.length).toBeLessThanOrEqual(20);
    });

    it("starts from clause with match", () => {
      const result = excerpt("Intro text. Important: blue sofa details.", ["blue"]);
      // Should contain the match
      expect(result).toContain("blue sofa");
    });

    it("handles line breaks as clause separators", () => {
      const result = excerpt("Line one\nLine two: blue sofa\nLine three", ["blue"], 30);
      expect(result).toContain("blue sofa");
    });

    it("returns full text when short enough", () => {
      const result = excerpt("Short blue text", ["blue"], 40);
      expect(result).toBe("Short blue text");
    });

    it("removes trailing punctuation", () => {
      const result = excerpt("The blue sofa.", ["blue"], 40);
      expect(result).toBe("The blue sofa");
    });
  });

  describe("isTimestamp", () => {
    it("recognizes timestamp formats", () => {
      expect(isTimestamp("1:23")).toBe(true);
      expect(isTimestamp("12:34")).toBe(true);
      expect(isTimestamp("1:02:03")).toBe(true);
    });

    it("rejects non-timestamps", () => {
      expect(isTimestamp("Page 3")).toBe(false);
      expect(isTimestamp("123")).toBe(false);
      expect(isTimestamp("1:2")).toBe(false);
      expect(isTimestamp("")).toBe(false);
      expect(isTimestamp(null)).toBe(false);
      expect(isTimestamp(undefined)).toBe(false);
    });
  });
});
