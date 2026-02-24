import { useState, useEffect, useCallback } from "react";
import { PI_THEMES, applyPiTheme, getPiTheme, type PiTheme } from "./piThemes";

export type { PiTheme };

interface UseThemeReturn {
  /** Current theme name */
  themeName: string;
  /** The full theme object */
  theme: PiTheme;
  /** All available themes */
  themes: PiTheme[];
  /** Whether current theme is dark */
  isDark: boolean;
  /** Select a theme by name */
  setTheme: (name: string) => void;
}

const STORAGE_KEY = "pi-de-theme";
const DEFAULT_THEME = "dark";

export function useTheme(): UseThemeReturn {
  const [themeName, setThemeName] = useState<string>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    // Migrate old "system"/"light"/"dark" values
    if (stored === "system") return DEFAULT_THEME;
    return stored && getPiTheme(stored) ? stored : DEFAULT_THEME;
  });

  const theme = getPiTheme(themeName) ?? PI_THEMES[0];

  // Apply theme to document whenever it changes
  useEffect(() => {
    applyPiTheme(theme);
  }, [theme]);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, themeName);
  }, [themeName]);

  const setTheme = useCallback((name: string) => {
    if (getPiTheme(name)) {
      setThemeName(name);
    }
  }, []);

  return {
    themeName,
    theme,
    themes: PI_THEMES,
    isDark: theme.isDark,
    setTheme,
  };
}
