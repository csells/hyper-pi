import { useState, useEffect } from "react";

export type Theme = "dark" | "light" | "system";

interface UseThemeReturn {
  theme: Theme;
  resolvedTheme: "dark" | "light";
  cycleTheme: () => void;
}

const STORAGE_KEY = "pi-de-theme";

export function useTheme(): UseThemeReturn {
  const [theme, setTheme] = useState<Theme>(() => {
    // Initialize from localStorage, default to "dark"
    const stored = localStorage.getItem(STORAGE_KEY);
    return (stored as Theme) || "dark";
  });

  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => {
    // Get initial system preference
    if (typeof window === "undefined" || !window.matchMedia) return true;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  // Listen for system color scheme changes
  useEffect(() => {
    if (!window.matchMedia) return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemPrefersDark(e.matches);
    };

    // Modern browsers use addEventListener
    mediaQuery.addEventListener("change", handleChange);
    
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  // Persist theme to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // Compute resolved theme based on current theme and system preference
  const resolvedTheme: "dark" | "light" = 
    theme === "system" 
      ? (systemPrefersDark ? "dark" : "light")
      : theme;

  const cycleTheme = () => {
    setTheme((current) => {
      if (current === "dark") return "light";
      if (current === "light") return "system";
      return "dark";
    });
  };

  return { theme, resolvedTheme, cycleTheme };
}
