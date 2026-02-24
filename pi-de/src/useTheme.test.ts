import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "./useTheme";
import { PI_THEMES } from "./piThemes";

// Mock applyPiTheme since it manipulates the document
vi.mock("./piThemes", async () => {
  const actual = await vi.importActual("./piThemes");
  return {
    ...actual,
    applyPiTheme: vi.fn(),
  };
});

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("defaults to 'dark' theme", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.themeName).toBe("dark");
    expect(result.current.theme.name).toBe("dark");
    expect(result.current.isDark).toBe(true);
  });

  it("restores theme from localStorage", () => {
    localStorage.setItem("pi-de-theme", "tokyo-night");
    const { result } = renderHook(() => useTheme());
    expect(result.current.themeName).toBe("tokyo-night");
    expect(result.current.theme.displayName).toBe("Tokyo Night");
    expect(result.current.isDark).toBe(true);
  });

  it("falls back to dark for unknown stored theme", () => {
    localStorage.setItem("pi-de-theme", "nonexistent-theme");
    const { result } = renderHook(() => useTheme());
    expect(result.current.themeName).toBe("dark");
  });

  it("migrates old 'system' value to dark", () => {
    localStorage.setItem("pi-de-theme", "system");
    const { result } = renderHook(() => useTheme());
    expect(result.current.themeName).toBe("dark");
  });

  it("setTheme changes the active theme", () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme("light");
    });

    expect(result.current.themeName).toBe("light");
    expect(result.current.isDark).toBe(false);
  });

  it("setTheme persists to localStorage", () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme("nord");
    });

    expect(localStorage.getItem("pi-de-theme")).toBe("nord");
  });

  it("setTheme ignores unknown theme names", () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme("nonexistent");
    });

    expect(result.current.themeName).toBe("dark");
  });

  it("exposes all available themes", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.themes).toBe(PI_THEMES);
    expect(result.current.themes.length).toBeGreaterThanOrEqual(7);
  });

  it("isDark is true for dark themes, false for light themes", () => {
    const { result } = renderHook(() => useTheme());

    // Test a dark theme
    act(() => {
      result.current.setTheme("gruvbox-dark");
    });
    expect(result.current.isDark).toBe(true);

    // Test a light theme
    act(() => {
      result.current.setTheme("solarized-light");
    });
    expect(result.current.isDark).toBe(false);
  });

  it("theme object has all required fields", () => {
    const { result } = renderHook(() => useTheme());
    const t = result.current.theme;

    expect(t.name).toBe("dark");
    expect(t.displayName).toBe("Dark");
    expect(typeof t.isDark).toBe("boolean");
    expect(t.pageBg).toMatch(/^#/);
    expect(t.pageFg).toMatch(/^#/);
    expect(t.cardBg).toMatch(/^#/);
    expect(t.colors.accent).toMatch(/^#/);
    expect(t.colors.border).toMatch(/^#/);
    expect(t.colors.error).toMatch(/^#/);
    expect(t.colors.success).toMatch(/^#/);
  });

  it("can cycle through all themes", () => {
    const { result } = renderHook(() => useTheme());
    const names = result.current.themes.map((t) => t.name);

    for (const name of names) {
      act(() => {
        result.current.setTheme(name);
      });
      expect(result.current.themeName).toBe(name);
    }
  });
});
