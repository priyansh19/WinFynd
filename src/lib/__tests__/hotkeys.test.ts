import { describe, it, expect, vi } from "vitest";
import { captureCombo, displayKeys, knownConflict } from "../hotkeys";

describe("hotkeys.ts", () => {
  describe("captureCombo", () => {
    const createKeyEvent = (
      code: string,
      modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}
    ): KeyboardEvent => {
      return new KeyboardEvent("keydown", {
        code,
        ctrlKey: modifiers.ctrl || false,
        altKey: modifiers.alt || false,
        shiftKey: modifiers.shift || false,
        metaKey: modifiers.meta || false,
      });
    };

    it("captures simple key with modifiers", () => {
      const event = createKeyEvent("KeyF", { ctrl: true, alt: true });
      const result = captureCombo(event);
      expect(result.parts).toEqual(["Ctrl", "Alt", "F"]);
      expect(result.accelerator).toBe("Ctrl+Alt+F");
    });

    it("captures all modifiers", () => {
      const event = createKeyEvent("KeyA", { ctrl: true, alt: true, shift: true, meta: true });
      const result = captureCombo(event);
      expect(result.parts).toEqual(["Ctrl", "Alt", "Shift", "Super", "A"]);
      expect(result.accelerator).toBe("Ctrl+Alt+Shift+Super+A");
    });

    it("accepts function keys without modifiers", () => {
      const event = createKeyEvent("F5", {});
      const result = captureCombo(event);
      expect(result.parts).toEqual(["F5"]);
      expect(result.accelerator).toBe("F5");
    });

    it("rejects regular keys without modifiers", () => {
      const event = createKeyEvent("KeyA", {});
      const result = captureCombo(event);
      expect(result.parts).toEqual(["A"]);
      expect(result.accelerator).toBeNull();
    });

    it("rejects modifier-only presses", () => {
      const event = createKeyEvent("ControlLeft", { ctrl: true });
      const result = captureCombo(event);
      expect(result.parts).toEqual(["Ctrl"]);
      expect(result.accelerator).toBeNull();
    });

    it("captures space key", () => {
      const event = createKeyEvent("Space", { alt: true });
      const result = captureCombo(event);
      expect(result.parts).toEqual(["Alt", "Space"]);
      expect(result.accelerator).toBe("Alt+Space");
    });

    it("captures digits", () => {
      const event = createKeyEvent("Digit5", { ctrl: true });
      const result = captureCombo(event);
      expect(result.parts).toEqual(["Ctrl", "5"]);
      expect(result.accelerator).toBe("Ctrl+5");
    });

    it("captures arrow keys", () => {
      const event = createKeyEvent("ArrowUp", { ctrl: true });
      const result = captureCombo(event);
      expect(result.parts).toEqual(["Ctrl", "ArrowUp"]);
      expect(result.accelerator).toBe("Ctrl+ArrowUp");
    });

    it("captures special keys", () => {
      const event = createKeyEvent("Enter", { ctrl: true });
      const result = captureCombo(event);
      expect(result.parts).toEqual(["Ctrl", "Enter"]);
      expect(result.accelerator).toBe("Ctrl+Enter");
    });

    it("ignores unsupported keys", () => {
      const event = createKeyEvent("Unknown", { ctrl: true });
      const result = captureCombo(event);
      expect(result.parts).toEqual(["Ctrl"]);
      expect(result.accelerator).toBeNull();
    });
  });

  describe("displayKeys", () => {
    it("converts accelerator to display format", () => {
      expect(displayKeys("Ctrl+Alt+F")).toEqual(["Ctrl", "Alt", "F"]);
    });

    it("converts Super to Win", () => {
      expect(displayKeys("Super+Shift+F")).toEqual(["Win", "Shift", "F"]);
    });

    it("converts Backquote to backtick", () => {
      expect(displayKeys("Ctrl+Backquote")).toEqual(["Ctrl", "`"]);
    });

    it("handles single keys", () => {
      expect(displayKeys("F5")).toEqual(["F5"]);
    });

    it("preserves other key names", () => {
      expect(displayKeys("Ctrl+Space")).toEqual(["Ctrl", "Space"]);
      expect(displayKeys("Alt+ArrowUp")).toEqual(["Alt", "ArrowUp"]);
    });
  });

  describe("knownConflict", () => {
    it("warns about Alt+Space (window menu)", () => {
      const warning = knownConflict("Alt+Space");
      expect(warning).toBeTruthy();
      expect(warning).toContain("window menu");
    });

    it("warns about Super+Space (input language)", () => {
      const warning = knownConflict("Super+Space");
      expect(warning).toBeTruthy();
      expect(warning).toContain("input language");
    });

    it("warns about Ctrl+Alt+Delete", () => {
      const warning = knownConflict("Ctrl+Alt+Delete");
      expect(warning).toBeTruthy();
      expect(warning).toContain("reserves");
    });

    it("warns about Super+L (lock PC)", () => {
      const warning = knownConflict("Super+L");
      expect(warning).toBeTruthy();
      expect(warning).toContain("lock");
    });

    it("returns null for non-conflicting combos", () => {
      expect(knownConflict("Ctrl+Shift+F")).toBeNull();
      expect(knownConflict("Alt+F1")).toBeNull();
      expect(knownConflict("F5")).toBeNull();
    });
  });
});
