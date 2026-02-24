# Theming system — dark, light, and system modes with persistence

Implement theme support for Pi-DE with dark mode (current default), light mode, and system preference mode, with localStorage persistence and a toggle button.

**Files to create:**
- `pi-de/src/useTheme.ts` (~60 lines) — React hook: `useTheme(): { theme: Theme; resolvedTheme: "dark" | "light"; cycleTheme: () => void }`. Reads initial value from `localStorage("pi-de-theme")`, defaults to `"dark"`. For `"system"`, listens to `matchMedia("(prefers-color-scheme: dark)")`. `cycleTheme` cycles dark → light → system → dark. Returns `resolvedTheme` (actual dark/light after resolving system pref).
- `pi-de/src/useTheme.test.ts` (~120 lines) — Tests for hook: init from localStorage, cycle order, system mode listener, resolvedTheme accuracy.

**Files to modify:**
- `pi-de/src/App.css` — Add `.pi-de-light` class with light-mode CSS variable overrides: `--bg-dark: #f8fafc; --bg-panel: #ffffff; --bg-panel-hover: #f1f5f9; --text-main: #1e293b; --text-muted: #64748b; --accent: #059669; --accent-glow: rgba(5,150,105,0.3); --border-color: #e2e8f0; --danger: #dc2626;`. Add `.theme-toggle` button styles.
- `pi-de/src/App.tsx` — Import `useTheme`. Add `const { theme, resolvedTheme, cycleTheme } = useTheme();`. Add toggle button after sidebar `<h2>`: `<button className="theme-toggle" onClick={cycleTheme}>{theme === "dark" ? "🌙" : theme === "light" ? "☀️" : "🖥️"}</button>`. Change layout div to include `pi-de-light` class when resolvedTheme is light. Change `agent-interface-container dark` to `agent-interface-container ${resolvedTheme}` (dynamic class).

**Exported symbols:**
- `useTheme.ts`: `useTheme()` hook, `Theme` type ("dark" | "light" | "system")

**Acceptance criteria:**
- Toggle cycles dark → light → system → dark
- Dark mode: existing appearance unchanged
- Light mode: light backgrounds, dark text, green accent
- System mode: follows OS via prefers-color-scheme
- Choice persisted in localStorage key `pi-de-theme`
- `<agent-interface>` web component correctly switches (`.dark` class toggles)
- Tests pass: `cd pi-de && npm test`
- Build succeeds: `cd pi-de && npm run build`
