import { describe, it, expect, beforeEach, vi } from "vitest";
import { recentSearches, rememberSearch, clearRecent, remembersSearches, setRemembersSearches } from "../recent";

describe("recent.ts", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("remembersSearches", () => {
    it("returns true by default", () => {
      expect(remembersSearches()).toBe(true);
    });

    it("returns false when disabled", () => {
      setRemembersSearches(false);
      expect(remembersSearches()).toBe(false);
    });
  });

  describe("setRemembersSearches", () => {
    it("enables search memory", () => {
      setRemembersSearches(false);
      setRemembersSearches(true);
      expect(remembersSearches()).toBe(true);
    });

    it("disables search memory and clears history", () => {
      rememberSearch("test query");
      setRemembersSearches(false);
      expect(remembersSearches()).toBe(false);
      expect(recentSearches()).toEqual([]);
    });
  });

  describe("recentSearches", () => {
    it("returns empty array initially", () => {
      expect(recentSearches()).toEqual([]);
    });

    it("returns stored searches", () => {
      rememberSearch("first query");
      rememberSearch("second query");
      const recent = recentSearches();
      expect(recent).toContain("first query");
      expect(recent).toContain("second query");
    });

    it("handles corrupted storage gracefully", () => {
      localStorage.setItem("wf.recent", "not json");
      expect(recentSearches()).toEqual([]);
    });

    it("filters non-string values", () => {
      localStorage.setItem("wf.recent", JSON.stringify(["valid", 123, null, "another"]));
      const recent = recentSearches();
      expect(recent).toEqual(["valid", "another"]);
    });
  });

  describe("rememberSearch", () => {
    it("adds search to history", () => {
      rememberSearch("test query");
      expect(recentSearches()).toEqual(["test query"]);
    });

    it("places new search at the beginning", () => {
      rememberSearch("first");
      rememberSearch("second");
      expect(recentSearches()[0]).toBe("second");
    });

    it("removes duplicate entries", () => {
      rememberSearch("duplicate");
      rememberSearch("other");
      rememberSearch("duplicate");
      const recent = recentSearches();
      expect(recent.filter((q) => q === "duplicate")).toHaveLength(1);
      expect(recent[0]).toBe("duplicate");
    });

    it("trims whitespace", () => {
      rememberSearch("  query  ");
      expect(recentSearches()).toEqual(["query"]);
    });

    it("ignores empty queries", () => {
      rememberSearch("  ");
      expect(recentSearches()).toEqual([]);
    });

    it("limits history to 20 items", () => {
      for (let i = 0; i < 25; i++) {
        rememberSearch(`query ${i}`);
      }
      expect(recentSearches()).toHaveLength(20);
    });

    it("does not remember when disabled", () => {
      setRemembersSearches(false);
      rememberSearch("test query");
      expect(recentSearches()).toEqual([]);
    });
  });

  describe("clearRecent", () => {
    it("removes all search history", () => {
      rememberSearch("query 1");
      rememberSearch("query 2");
      clearRecent();
      expect(recentSearches()).toEqual([]);
    });

    it("handles empty history", () => {
      expect(() => clearRecent()).not.toThrow();
    });
  });

  describe("localStorage unavailable", () => {
    it("handles blocked localStorage gracefully", () => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new Error("QuotaExceededError");
      };

      expect(() => rememberSearch("test")).not.toThrow();
      expect(() => setRemembersSearches(false)).not.toThrow();

      Storage.prototype.setItem = originalSetItem;
    });
  });
});
