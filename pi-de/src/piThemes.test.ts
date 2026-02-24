import { describe, it, expect, beforeEach } from "vitest";
import { PI_THEMES, getPiTheme, hexToOklch, applyPiTheme } from "./piThemes";

describe("piThemes", () => {
  describe("PI_THEMES", () => {
    it("has at least 7 themes", () => {
      expect(PI_THEMES.length).toBeGreaterThanOrEqual(7);
    });

    it("includes dark and light built-in themes", () => {
      expect(PI_THEMES.find((t) => t.name === "dark")).toBeDefined();
      expect(PI_THEMES.find((t) => t.name === "light")).toBeDefined();
    });

    it("includes community themes", () => {
      const names = PI_THEMES.map((t) => t.name);
      expect(names).toContain("gruvbox-dark");
      expect(names).toContain("tokyo-night");
      expect(names).toContain("nord");
      expect(names).toContain("solarized-dark");
      expect(names).toContain("solarized-light");
    });

    it("every theme has required fields", () => {
      for (const theme of PI_THEMES) {
        expect(theme.name).toBeTruthy();
        expect(theme.displayName).toBeTruthy();
        expect(typeof theme.isDark).toBe("boolean");
        expect(theme.pageBg).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(theme.pageFg).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(theme.cardBg).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    });

    it("every theme has all color tokens", () => {
      const requiredColors = [
        "accent", "border", "borderAccent", "borderMuted",
        "success", "error", "warning", "muted", "dim", "text",
        "selectedBg", "userMessageBg", "userMessageText",
        "toolPendingBg", "toolSuccessBg", "toolErrorBg",
        "mdHeading", "mdCode",
        "syntaxComment", "syntaxKeyword", "syntaxFunction",
        "syntaxVariable", "syntaxString", "syntaxNumber",
      ];

      for (const theme of PI_THEMES) {
        for (const key of requiredColors) {
          expect(
            (theme.colors as unknown as Record<string, string>)[key],
            `${theme.name} missing color: ${key}`,
          ).toBeTruthy();
        }
      }
    });

    it("has unique theme names", () => {
      const names = PI_THEMES.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe("getPiTheme", () => {
    it("returns theme by name", () => {
      const dark = getPiTheme("dark");
      expect(dark).toBeDefined();
      expect(dark!.name).toBe("dark");
    });

    it("returns undefined for unknown name", () => {
      expect(getPiTheme("nonexistent")).toBeUndefined();
    });
  });

  describe("hexToOklch", () => {
    it("converts black", () => {
      const result = hexToOklch("#000000");
      expect(result).toMatch(/^oklch\(/);
      expect(result).toContain("0 0");
    });

    it("converts white", () => {
      const result = hexToOklch("#ffffff");
      expect(result).toMatch(/^oklch\(/);
      // White should have L close to 1
      const L = parseFloat(result.match(/oklch\(([0-9.]+)/)?.[1] ?? "0");
      expect(L).toBeGreaterThan(0.9);
    });

    it("converts a known color (pure red)", () => {
      const result = hexToOklch("#ff0000");
      expect(result).toMatch(/^oklch\(/);
      // Red should have noticeable chroma
      const parts = result.match(/oklch\(([0-9.]+) ([0-9.]+) ([0-9.]+)\)/);
      expect(parts).not.toBeNull();
      const C = parseFloat(parts![2]);
      expect(C).toBeGreaterThan(0.1);
    });

    it("returns valid oklch format", () => {
      const colors = ["#00d7ff", "#5f87ff", "#b5bd68", "#cc6666", "#808080"];
      for (const hex of colors) {
        const result = hexToOklch(hex);
        expect(result).toMatch(/^oklch\([0-9.]+ [0-9.]+ [0-9.]+\)$/);
      }
    });
  });

  describe("applyPiTheme", () => {
    beforeEach(() => {
      // Clean up inline styles
      document.documentElement.style.cssText = "";
      document.documentElement.classList.remove("dark");
    });

    it("sets .dark class for dark themes", () => {
      const dark = getPiTheme("dark")!;
      applyPiTheme(dark);
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it("removes .dark class for light themes", () => {
      document.documentElement.classList.add("dark");
      const light = getPiTheme("light")!;
      applyPiTheme(light);
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it("sets CSS custom properties on document root", () => {
      const dark = getPiTheme("dark")!;
      applyPiTheme(dark);

      const style = document.documentElement.style;
      expect(style.getPropertyValue("--background")).toMatch(/oklch/);
      expect(style.getPropertyValue("--foreground")).toMatch(/oklch/);
      expect(style.getPropertyValue("--primary")).toMatch(/oklch/);
      expect(style.getPropertyValue("--border")).toMatch(/oklch/);
      expect(style.getPropertyValue("--destructive")).toMatch(/oklch/);
    });

    it("sets pi-specific custom properties", () => {
      const dark = getPiTheme("dark")!;
      applyPiTheme(dark);

      const style = document.documentElement.style;
      expect(style.getPropertyValue("--pi-page-bg")).toMatch(/^#/);
      expect(style.getPropertyValue("--pi-accent")).toMatch(/^#/);
      expect(style.getPropertyValue("--pi-success")).toMatch(/^#/);
      expect(style.getPropertyValue("--pi-error")).toMatch(/^#/);
    });

    it("sets sidebar chrome variables (--bg-dark, --accent, etc.)", () => {
      const dark = getPiTheme("dark")!;
      applyPiTheme(dark);

      const style = document.documentElement.style;
      expect(style.getPropertyValue("--bg-dark")).toBe(dark.pageBg);
      expect(style.getPropertyValue("--bg-panel")).toBe(dark.cardBg);
      expect(style.getPropertyValue("--text-main")).toBe(dark.pageFg);
      expect(style.getPropertyValue("--accent")).toBe(dark.colors.accent);
      expect(style.getPropertyValue("--border-color")).toBe(dark.colors.borderMuted);
      expect(style.getPropertyValue("--danger")).toBe(dark.colors.error);
    });

    it("updates sidebar chrome variables when switching themes", () => {
      applyPiTheme(getPiTheme("dark")!);
      const darkAccent = document.documentElement.style.getPropertyValue("--accent");

      applyPiTheme(getPiTheme("solarized-light")!);
      const lightAccent = document.documentElement.style.getPropertyValue("--accent");

      expect(darkAccent).not.toBe(lightAccent);
    });

    it("can apply different themes sequentially", () => {
      applyPiTheme(getPiTheme("dark")!);
      const darkBg = document.documentElement.style.getPropertyValue("--background");

      applyPiTheme(getPiTheme("light")!);
      const lightBg = document.documentElement.style.getPropertyValue("--background");

      expect(darkBg).not.toBe(lightBg);
    });
  });
});
