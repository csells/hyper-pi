import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "./useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    
    // Mock matchMedia
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-color-scheme: dark)" ? true : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("initializes with dark theme by default", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(result.current.resolvedTheme).toBe("dark");
  });

  it("initializes from localStorage if present", () => {
    localStorage.setItem("pi-de-theme", "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
    expect(result.current.resolvedTheme).toBe("light");
  });

  it("initializes system theme from localStorage", () => {
    localStorage.setItem("pi-de-theme", "system");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
    // Since system prefers dark by default in our mock, resolved should be dark
    expect(result.current.resolvedTheme).toBe("dark");
  });

  it("cycles through themes in correct order: dark -> light -> system -> dark", () => {
    const { result } = renderHook(() => useTheme());
    
    // Start at dark
    expect(result.current.theme).toBe("dark");

    // Cycle to light
    act(() => {
      result.current.cycleTheme();
    });
    expect(result.current.theme).toBe("light");
    expect(result.current.resolvedTheme).toBe("light");

    // Cycle to system
    act(() => {
      result.current.cycleTheme();
    });
    expect(result.current.theme).toBe("system");
    expect(result.current.resolvedTheme).toBe("dark"); // Mock prefers dark

    // Cycle back to dark
    act(() => {
      result.current.cycleTheme();
    });
    expect(result.current.theme).toBe("dark");
    expect(result.current.resolvedTheme).toBe("dark");
  });

  it("persists theme to localStorage on change", () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.cycleTheme();
    });
    
    expect(localStorage.getItem("pi-de-theme")).toBe("light");

    act(() => {
      result.current.cycleTheme();
    });
    
    expect(localStorage.getItem("pi-de-theme")).toBe("system");
  });

  it("responds to system color scheme changes when theme is system", () => {
    let changeCallback: ((e: MediaQueryListEvent) => void) | null = null;
    
    const mockMatchMedia = vi.fn().mockImplementation((query: string) => {
      if (query === "(prefers-color-scheme: dark)") {
        return {
          matches: true,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
            if (event === "change") {
              changeCallback = handler;
            }
          }),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        };
      }
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    });

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: mockMatchMedia,
    });

    localStorage.setItem("pi-de-theme", "system");
    const { result } = renderHook(() => useTheme());

    // Initially mocked to prefer dark
    expect(result.current.resolvedTheme).toBe("dark");

    // Simulate system preference change to light
    if (changeCallback) {
      act(() => {
        changeCallback!({ matches: false } as MediaQueryListEvent);
      });
    }

    expect(result.current.resolvedTheme).toBe("light");

    // Simulate system preference change back to dark
    if (changeCallback) {
      act(() => {
        changeCallback!({ matches: true } as MediaQueryListEvent);
      });
    }

    expect(result.current.resolvedTheme).toBe("dark");
  });

  it("resolvedTheme is dark when theme is system and system prefers dark", () => {
    localStorage.setItem("pi-de-theme", "system");
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolvedTheme).toBe("dark");
  });

  it("resolvedTheme is light when theme is dark (explicit)", () => {
    const { result } = renderHook(() => useTheme());
    
    act(() => {
      result.current.cycleTheme(); // light
    });
    
    expect(result.current.resolvedTheme).toBe("light");
  });

  it("does not respond to system changes when theme is not system", () => {
    let changeCallback: ((e: MediaQueryListEvent) => void) | null = null;
    
    const mockMatchMedia = vi.fn().mockImplementation((query: string) => {
      if (query === "(prefers-color-scheme: dark)") {
        return {
          matches: true,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
            if (event === "change") {
              changeCallback = handler;
            }
          }),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        };
      }
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    });

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: mockMatchMedia,
    });

    const { result } = renderHook(() => useTheme());
    
    // Set to light (explicit)
    act(() => {
      result.current.cycleTheme();
    });
    
    expect(result.current.resolvedTheme).toBe("light");

    // Try to simulate system preference change
    if (changeCallback) {
      act(() => {
        changeCallback!({ matches: false } as MediaQueryListEvent);
      });
    }

    // Should still be light (not affected by system change)
    expect(result.current.resolvedTheme).toBe("light");
  });
});
