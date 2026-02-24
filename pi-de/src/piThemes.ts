/**
 * Pi theme definitions and hex→oklch→CSS-variable bridge.
 *
 * Embeds pi's built-in dark/light themes plus popular community themes.
 * Maps pi's 51 TUI color tokens → mini-lit's CSS custom properties so
 * pi-web-ui renders with colors matching the user's chosen pi theme.
 *
 * ## How it works
 *
 * pi's TUI themes define 51 color tokens as hex strings (e.g. "#00d7ff").
 * mini-lit's CSS theming uses ~30 custom properties in oklch color space
 * (e.g. `--background: oklch(0.145 0 0)`).
 *
 * This module:
 * 1. Defines a mapping from pi tokens → CSS custom properties
 * 2. Converts hex colors to oklch at runtime
 * 3. Injects the computed CSS properties into the document root
 */

// ── Pi theme color tokens (subset we care about for web mapping) ────

export interface PiThemeColors {
  // Core UI
  accent: string;
  border: string;
  borderAccent: string;
  borderMuted: string;
  success: string;
  error: string;
  warning: string;
  muted: string;
  dim: string;
  text: string;

  // Backgrounds
  selectedBg: string;
  userMessageBg: string;
  userMessageText: string;
  customMessageBg: string;
  customMessageText: string;
  customMessageLabel: string;
  toolPendingBg: string;
  toolSuccessBg: string;
  toolErrorBg: string;
  toolTitle: string;
  toolOutput: string;

  // Markdown
  mdHeading: string;
  mdCode: string;
  mdCodeBlock: string;
  mdCodeBlockBorder: string;

  // Syntax
  syntaxComment: string;
  syntaxKeyword: string;
  syntaxFunction: string;
  syntaxVariable: string;
  syntaxString: string;
  syntaxNumber: string;
  syntaxType: string;
  syntaxOperator: string;
  syntaxPunctuation: string;
}

export interface PiTheme {
  name: string;
  displayName: string;
  isDark: boolean;
  colors: PiThemeColors;
  /** Page/card background for the sidebar (Pi-DE's own chrome) */
  pageBg: string;
  /** Foreground text for sidebar chrome */
  pageFg: string;
  /** Card/panel background */
  cardBg: string;
}

// ── Built-in themes ─────────────────────────────────────────────────

const piDark: PiTheme = {
  name: "dark",
  displayName: "Dark",
  isDark: true,
  pageBg: "#1a1a2e",
  pageFg: "#e5e5e7",
  cardBg: "#1e1e2e",
  colors: {
    accent: "#8abeb7",
    border: "#5f87ff",
    borderAccent: "#00d7ff",
    borderMuted: "#505050",
    success: "#b5bd68",
    error: "#cc6666",
    warning: "#ffff00",
    muted: "#808080",
    dim: "#666666",
    text: "#e5e5e7",
    selectedBg: "#3a3a4a",
    userMessageBg: "#343541",
    userMessageText: "#e5e5e7",
    customMessageBg: "#2d2838",
    customMessageText: "#e5e5e7",
    customMessageLabel: "#9575cd",
    toolPendingBg: "#282832",
    toolSuccessBg: "#283228",
    toolErrorBg: "#3c2828",
    toolTitle: "#e5e5e7",
    toolOutput: "#808080",
    mdHeading: "#f0c674",
    mdCode: "#8abeb7",
    mdCodeBlock: "#b5bd68",
    mdCodeBlockBorder: "#808080",
    syntaxComment: "#6A9955",
    syntaxKeyword: "#569CD6",
    syntaxFunction: "#DCDCAA",
    syntaxVariable: "#9CDCFE",
    syntaxString: "#CE9178",
    syntaxNumber: "#B5CEA8",
    syntaxType: "#4EC9B0",
    syntaxOperator: "#D4D4D4",
    syntaxPunctuation: "#D4D4D4",
  },
};

const piLight: PiTheme = {
  name: "light",
  displayName: "Light",
  isDark: false,
  pageBg: "#f5f5f5",
  pageFg: "#1a1a1a",
  cardBg: "#ffffff",
  colors: {
    accent: "#5a8080",
    border: "#547da7",
    borderAccent: "#5a8080",
    borderMuted: "#b0b0b0",
    success: "#588458",
    error: "#aa5555",
    warning: "#9a7326",
    muted: "#6c6c6c",
    dim: "#767676",
    text: "#1a1a1a",
    selectedBg: "#d0d0e0",
    userMessageBg: "#e8e8e8",
    userMessageText: "#1a1a1a",
    customMessageBg: "#ede7f6",
    customMessageText: "#1a1a1a",
    customMessageLabel: "#7e57c2",
    toolPendingBg: "#e8e8f0",
    toolSuccessBg: "#e8f0e8",
    toolErrorBg: "#f0e8e8",
    toolTitle: "#1a1a1a",
    toolOutput: "#6c6c6c",
    mdHeading: "#9a7326",
    mdCode: "#5a8080",
    mdCodeBlock: "#588458",
    mdCodeBlockBorder: "#6c6c6c",
    syntaxComment: "#008000",
    syntaxKeyword: "#0000FF",
    syntaxFunction: "#795E26",
    syntaxVariable: "#001080",
    syntaxString: "#A31515",
    syntaxNumber: "#098658",
    syntaxType: "#267F99",
    syntaxOperator: "#000000",
    syntaxPunctuation: "#000000",
  },
};

const gruvboxDark: PiTheme = {
  name: "gruvbox-dark",
  displayName: "Gruvbox Dark",
  isDark: true,
  pageBg: "#282828",
  pageFg: "#ebdbb2",
  cardBg: "#3c3836",
  colors: {
    accent: "#b8bb26",
    border: "#83a598",
    borderAccent: "#8ec07c",
    borderMuted: "#504945",
    success: "#b8bb26",
    error: "#fb4934",
    warning: "#fabd2f",
    muted: "#928374",
    dim: "#665c54",
    text: "#ebdbb2",
    selectedBg: "#504945",
    userMessageBg: "#3c3836",
    userMessageText: "#ebdbb2",
    customMessageBg: "#3c3836",
    customMessageText: "#ebdbb2",
    customMessageLabel: "#d3869b",
    toolPendingBg: "#32302f",
    toolSuccessBg: "#2e3228",
    toolErrorBg: "#3c2828",
    toolTitle: "#ebdbb2",
    toolOutput: "#928374",
    mdHeading: "#fabd2f",
    mdCode: "#8ec07c",
    mdCodeBlock: "#b8bb26",
    mdCodeBlockBorder: "#928374",
    syntaxComment: "#928374",
    syntaxKeyword: "#fb4934",
    syntaxFunction: "#fabd2f",
    syntaxVariable: "#83a598",
    syntaxString: "#b8bb26",
    syntaxNumber: "#d3869b",
    syntaxType: "#8ec07c",
    syntaxOperator: "#fe8019",
    syntaxPunctuation: "#ebdbb2",
  },
};

const tokyoNight: PiTheme = {
  name: "tokyo-night",
  displayName: "Tokyo Night",
  isDark: true,
  pageBg: "#1a1b26",
  pageFg: "#c0caf5",
  cardBg: "#24283b",
  colors: {
    accent: "#7aa2f7",
    border: "#565f89",
    borderAccent: "#7dcfff",
    borderMuted: "#3b4261",
    success: "#9ece6a",
    error: "#f7768e",
    warning: "#e0af68",
    muted: "#565f89",
    dim: "#414868",
    text: "#c0caf5",
    selectedBg: "#283457",
    userMessageBg: "#24283b",
    userMessageText: "#c0caf5",
    customMessageBg: "#292e42",
    customMessageText: "#c0caf5",
    customMessageLabel: "#bb9af7",
    toolPendingBg: "#1f2335",
    toolSuccessBg: "#1f2e20",
    toolErrorBg: "#2e1f25",
    toolTitle: "#c0caf5",
    toolOutput: "#565f89",
    mdHeading: "#e0af68",
    mdCode: "#7dcfff",
    mdCodeBlock: "#9ece6a",
    mdCodeBlockBorder: "#565f89",
    syntaxComment: "#565f89",
    syntaxKeyword: "#9d7cd8",
    syntaxFunction: "#7aa2f7",
    syntaxVariable: "#c0caf5",
    syntaxString: "#9ece6a",
    syntaxNumber: "#ff9e64",
    syntaxType: "#2ac3de",
    syntaxOperator: "#89ddff",
    syntaxPunctuation: "#c0caf5",
  },
};

const nordDark: PiTheme = {
  name: "nord",
  displayName: "Nord",
  isDark: true,
  pageBg: "#2e3440",
  pageFg: "#d8dee9",
  cardBg: "#3b4252",
  colors: {
    accent: "#88c0d0",
    border: "#81a1c1",
    borderAccent: "#88c0d0",
    borderMuted: "#434c5e",
    success: "#a3be8c",
    error: "#bf616a",
    warning: "#ebcb8b",
    muted: "#4c566a",
    dim: "#434c5e",
    text: "#d8dee9",
    selectedBg: "#434c5e",
    userMessageBg: "#3b4252",
    userMessageText: "#d8dee9",
    customMessageBg: "#3b4252",
    customMessageText: "#d8dee9",
    customMessageLabel: "#b48ead",
    toolPendingBg: "#2e3440",
    toolSuccessBg: "#2e3e2e",
    toolErrorBg: "#3e2e2e",
    toolTitle: "#d8dee9",
    toolOutput: "#4c566a",
    mdHeading: "#ebcb8b",
    mdCode: "#88c0d0",
    mdCodeBlock: "#a3be8c",
    mdCodeBlockBorder: "#4c566a",
    syntaxComment: "#616e88",
    syntaxKeyword: "#81a1c1",
    syntaxFunction: "#88c0d0",
    syntaxVariable: "#d8dee9",
    syntaxString: "#a3be8c",
    syntaxNumber: "#b48ead",
    syntaxType: "#8fbcbb",
    syntaxOperator: "#81a1c1",
    syntaxPunctuation: "#d8dee9",
  },
};

const solarizedDark: PiTheme = {
  name: "solarized-dark",
  displayName: "Solarized Dark",
  isDark: true,
  pageBg: "#002b36",
  pageFg: "#839496",
  cardBg: "#073642",
  colors: {
    accent: "#2aa198",
    border: "#268bd2",
    borderAccent: "#2aa198",
    borderMuted: "#073642",
    success: "#859900",
    error: "#dc322f",
    warning: "#b58900",
    muted: "#586e75",
    dim: "#657b83",
    text: "#839496",
    selectedBg: "#073642",
    userMessageBg: "#073642",
    userMessageText: "#839496",
    customMessageBg: "#073642",
    customMessageText: "#839496",
    customMessageLabel: "#6c71c4",
    toolPendingBg: "#002b36",
    toolSuccessBg: "#003028",
    toolErrorBg: "#360028",
    toolTitle: "#93a1a1",
    toolOutput: "#586e75",
    mdHeading: "#b58900",
    mdCode: "#2aa198",
    mdCodeBlock: "#859900",
    mdCodeBlockBorder: "#586e75",
    syntaxComment: "#586e75",
    syntaxKeyword: "#859900",
    syntaxFunction: "#268bd2",
    syntaxVariable: "#b58900",
    syntaxString: "#2aa198",
    syntaxNumber: "#d33682",
    syntaxType: "#cb4b16",
    syntaxOperator: "#839496",
    syntaxPunctuation: "#839496",
  },
};

const solarizedLight: PiTheme = {
  name: "solarized-light",
  displayName: "Solarized Light",
  isDark: false,
  pageBg: "#fdf6e3",
  pageFg: "#657b83",
  cardBg: "#eee8d5",
  colors: {
    accent: "#2aa198",
    border: "#268bd2",
    borderAccent: "#2aa198",
    borderMuted: "#eee8d5",
    success: "#859900",
    error: "#dc322f",
    warning: "#b58900",
    muted: "#93a1a1",
    dim: "#839496",
    text: "#657b83",
    selectedBg: "#eee8d5",
    userMessageBg: "#eee8d5",
    userMessageText: "#657b83",
    customMessageBg: "#eee8d5",
    customMessageText: "#657b83",
    customMessageLabel: "#6c71c4",
    toolPendingBg: "#fdf6e3",
    toolSuccessBg: "#f0f6e3",
    toolErrorBg: "#fde6e3",
    toolTitle: "#586e75",
    toolOutput: "#93a1a1",
    mdHeading: "#b58900",
    mdCode: "#2aa198",
    mdCodeBlock: "#859900",
    mdCodeBlockBorder: "#93a1a1",
    syntaxComment: "#93a1a1",
    syntaxKeyword: "#859900",
    syntaxFunction: "#268bd2",
    syntaxVariable: "#b58900",
    syntaxString: "#2aa198",
    syntaxNumber: "#d33682",
    syntaxType: "#cb4b16",
    syntaxOperator: "#657b83",
    syntaxPunctuation: "#657b83",
  },
};

export const PI_THEMES: PiTheme[] = [
  piDark,
  piLight,
  gruvboxDark,
  tokyoNight,
  nordDark,
  solarizedDark,
  solarizedLight,
];

// ── Hex → oklch conversion ──────────────────────────────────────────

/** Parse "#RRGGBB" to [r, g, b] in 0-1 range */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** sRGB → linear RGB */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear RGB → XYZ (D65) */
function linearRgbToXyz(r: number, g: number, b: number): [number, number, number] {
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
    0.0193339 * r + 0.1191920 * g + 0.9503041 * b,
  ];
}

/** XYZ → OKLab */
function xyzToOklab(x: number, y: number, z: number): [number, number, number] {
  const l_ = Math.cbrt(0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z);
  const m_ = Math.cbrt(0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z);
  const s_ = Math.cbrt(0.0482003018 * x + 0.2643662691 * y + 0.6338517070 * z);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

/** Hex → oklch string for CSS */
export function hexToOklch(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const [x, y, z] = linearRgbToXyz(lr, lg, lb);
  const [L, a, bOk] = xyzToOklab(x, y, z);
  const C = Math.sqrt(a * a + bOk * bOk);
  const h = Math.atan2(bOk, a) * (180 / Math.PI);
  const hNorm = h < 0 ? h + 360 : h;

  // Round for readability
  const Lr = Math.round(L * 10000) / 10000;
  const Cr = Math.round(C * 10000) / 10000;
  const hr = Math.round(hNorm * 100) / 100;

  return `oklch(${Lr} ${Cr} ${hr})`;
}

// ── Theme application ───────────────────────────────────────────────

/**
 * Apply a PiTheme to the document by setting CSS custom properties.
 * This overrides mini-lit's default/dark theme with pi's colors.
 */
export function applyPiTheme(theme: PiTheme): void {
  const root = document.documentElement;
  const c = theme.colors;

  // Toggle .dark class for mini-lit base styles
  root.classList.toggle("dark", theme.isDark);

  // Map pi tokens → mini-lit CSS custom properties
  root.style.setProperty("--background", hexToOklch(theme.pageBg));
  root.style.setProperty("--foreground", hexToOklch(theme.pageFg));
  root.style.setProperty("--card", hexToOklch(theme.cardBg));
  root.style.setProperty("--card-foreground", hexToOklch(c.text));
  root.style.setProperty("--popover", hexToOklch(theme.cardBg));
  root.style.setProperty("--popover-foreground", hexToOklch(c.text));
  root.style.setProperty("--primary", hexToOklch(c.accent));
  root.style.setProperty("--primary-foreground", hexToOklch(theme.isDark ? "#ffffff" : "#000000"));
  root.style.setProperty("--secondary", hexToOklch(c.selectedBg));
  root.style.setProperty("--secondary-foreground", hexToOklch(c.text));
  root.style.setProperty("--muted", hexToOklch(c.borderMuted));
  root.style.setProperty("--muted-foreground", hexToOklch(c.muted));
  root.style.setProperty("--accent", hexToOklch(c.selectedBg));
  root.style.setProperty("--accent-foreground", hexToOklch(c.accent));
  root.style.setProperty("--destructive", hexToOklch(c.error));
  root.style.setProperty("--destructive-foreground", hexToOklch(theme.isDark ? "#ffffff" : "#000000"));
  root.style.setProperty("--border", hexToOklch(c.borderMuted));
  root.style.setProperty("--input", hexToOklch(c.borderMuted));
  root.style.setProperty("--ring", hexToOklch(c.border));

  // Sidebar
  root.style.setProperty("--sidebar", hexToOklch(theme.pageBg));
  root.style.setProperty("--sidebar-foreground", hexToOklch(theme.pageFg));
  root.style.setProperty("--sidebar-primary", hexToOklch(c.accent));
  root.style.setProperty("--sidebar-primary-foreground", hexToOklch(theme.isDark ? "#ffffff" : "#000000"));
  root.style.setProperty("--sidebar-accent", hexToOklch(c.selectedBg));
  root.style.setProperty("--sidebar-accent-foreground", hexToOklch(c.text));
  root.style.setProperty("--sidebar-border", hexToOklch(c.borderMuted));
  root.style.setProperty("--sidebar-ring", hexToOklch(c.border));

  // Pi-DE specific custom properties for the sidebar chrome
  root.style.setProperty("--pi-page-bg", theme.pageBg);
  root.style.setProperty("--pi-page-fg", theme.pageFg);
  root.style.setProperty("--pi-card-bg", theme.cardBg);
  root.style.setProperty("--pi-accent", c.accent);
  root.style.setProperty("--pi-border", c.border);
  root.style.setProperty("--pi-border-muted", c.borderMuted);
  root.style.setProperty("--pi-muted", c.muted);
  root.style.setProperty("--pi-success", c.success);
  root.style.setProperty("--pi-error", c.error);
  root.style.setProperty("--pi-warning", c.warning);
  root.style.setProperty("--pi-selected-bg", c.selectedBg);
  root.style.setProperty("--pi-user-msg-bg", c.userMessageBg);
  root.style.setProperty("--pi-tool-pending-bg", c.toolPendingBg);
  root.style.setProperty("--pi-tool-success-bg", c.toolSuccessBg);
  root.style.setProperty("--pi-tool-error-bg", c.toolErrorBg);
}

/**
 * Get a theme by name. Returns undefined if not found.
 */
export function getPiTheme(name: string): PiTheme | undefined {
  return PI_THEMES.find((t) => t.name === name);
}
