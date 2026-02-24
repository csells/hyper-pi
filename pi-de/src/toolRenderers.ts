/**
 * Compact tool renderers for pi-coding-agent's built-in tools.
 *
 * Registered at startup via pi-web-ui's `registerToolRenderer()`.
 * Replaces the generic "Tool Call / Input JSON / Output text" cards
 * with TUI-style compact rendering:
 *
 *   read ~/path/to/file.ts:225-304
 *     (syntax-highlighted code, truncated)
 *     ... (72 more lines)
 *
 *   $ echo hello
 *     hello
 *
 *   edit ~/path/to/file.ts
 *     (old/new text)
 *
 *   write ~/path/to/file.ts
 *     (file content preview)
 */

import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { html, type TemplateResult } from "lit";
import {
  FileText,
  FilePenLine,
  FolderOpen,
  Search,
  FileSearch,
  SquareTerminal,
} from "lucide";
import {
  registerToolRenderer,
  renderCollapsibleHeader,
  type ToolRenderer,
  type ToolRenderResult,
} from "@mariozechner/pi-web-ui";
import { createRef } from "lit/directives/ref.js";

// ── Helpers ─────────────────────────────────────────────────────────

function shortenPath(path: string): string {
  if (!path) return "...";
  // Try to shorten home directory paths
  const homeMatch = path.match(/^\/Users\/([^/]+)\/(.*)/);
  if (homeMatch) return `~/${homeMatch[2]}`;
  // Shorten /private/var/folders temp paths
  if (path.startsWith("/private/var/") || path.startsWith("/var/"))
    return path.replace(/.*\/T\//, "/tmp/");
  return path;
}

function getTextOutput(result: ToolResultMessage | undefined): string {
  if (!result) return "";
  return (
    result.content
      ?.filter((c) => c.type === "text")
      .map((c: { type: string; text?: string }) => c.text || "")
      .join("\n") || ""
  );
}

function getLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    rb: "ruby",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    css: "css",
    html: "html",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    toml: "toml",
    sql: "sql",
    xml: "xml",
    swift: "swift",
    kt: "kotlin",
    dart: "dart",
    vue: "html",
    svelte: "html",
  };
  return langMap[ext || ""] || "text";
}

/** Truncate output to N lines, return lines + remaining count */
function truncateLines(
  text: string,
  maxLines: number,
): { lines: string[]; remaining: number } {
  const all = text.split("\n");
  if (all.length <= maxLines) return { lines: all, remaining: 0 };
  return { lines: all.slice(0, maxLines), remaining: all.length - maxLines };
}

/** State from result/streaming */
function toolState(
  result: ToolResultMessage | undefined,
  isStreaming?: boolean,
): "inprogress" | "complete" | "error" {
  if (result) return result.isError ? "error" : "complete";
  return isStreaming ? "inprogress" : "complete";
}

const PREVIEW_LINES = 10;

// ── Read Renderer ───────────────────────────────────────────────────

class ReadRenderer implements ToolRenderer {
  render(
    params: { path?: string; file_path?: string; offset?: number; limit?: number } | undefined,
    result: ToolResultMessage | undefined,
    isStreaming?: boolean,
  ): ToolRenderResult {
    const state = toolState(result, isStreaming);
    const rawPath = params?.file_path ?? params?.path ?? "";
    const path = shortenPath(rawPath);
    const offset = params?.offset;
    const limit = params?.limit;
    const lang = getLanguageFromPath(rawPath);

    // Build header: "read ~/path:start-end"
    let rangeStr = "";
    if (offset !== undefined || limit !== undefined) {
      const start = offset ?? 1;
      const end = limit !== undefined ? start + limit - 1 : "";
      rangeStr = `:${start}${end ? `-${end}` : ""}`;
    }

    const headerText = html`<code class="text-sm font-mono"><strong>read</strong> ${path}${rangeStr}</code>`;

    const contentRef = createRef<HTMLElement>();
    const chevronRef = createRef<HTMLElement>();

    if (!result) {
      return {
        content: renderCollapsibleHeader(state, FileText, headerText, contentRef, chevronRef),
        isCustom: false,
      };
    }

    const output = getTextOutput(result).trimEnd();
    if (result.isError) {
      return {
        content: html`
          <div>
            ${renderCollapsibleHeader(state, FileText, headerText, contentRef, chevronRef)}
            <div class="overflow-hidden transition-all duration-200 max-h-0" ${/* ref */""}>
              <div class="text-sm text-destructive mt-2">${output}</div>
            </div>
          </div>
        `,
        isCustom: false,
      };
    }

    const { lines, remaining } = truncateLines(output, PREVIEW_LINES);
    const preview = lines.join("\n");

    return {
      content: html`
        <div>
          ${renderCollapsibleHeader(state, FileText, headerText, contentRef, chevronRef, true)}
          <div class="overflow-hidden transition-all duration-200 max-h-[2000px] mt-3" ${/* ref */""}>
            <code-block .code=${preview} language="${lang}"></code-block>
            ${remaining > 0
              ? html`<div class="text-xs text-muted-foreground mt-1">… (${remaining} more lines)</div>`
              : ""}
          </div>
        </div>
      `,
      isCustom: false,
    };
  }
}

// ── Write Renderer ──────────────────────────────────────────────────

class WriteRenderer implements ToolRenderer {
  render(
    params: { path?: string; file_path?: string; content?: string } | undefined,
    result: ToolResultMessage | undefined,
    isStreaming?: boolean,
  ): ToolRenderResult {
    const state = toolState(result, isStreaming);
    const rawPath = params?.file_path ?? params?.path ?? "";
    const path = shortenPath(rawPath);
    const lang = getLanguageFromPath(rawPath);
    const fileContent = params?.content ?? "";

    const headerText = html`<code class="text-sm font-mono"><strong>write</strong> ${path}</code>`;

    const contentRef = createRef<HTMLElement>();
    const chevronRef = createRef<HTMLElement>();

    if (result?.isError) {
      const output = getTextOutput(result);
      return {
        content: html`
          <div>
            ${renderCollapsibleHeader(state, FilePenLine, headerText, contentRef, chevronRef, true)}
            <div class="overflow-hidden transition-all duration-200 max-h-[2000px] mt-3" ${/* ref */""}>
              <div class="text-sm text-destructive">${output}</div>
            </div>
          </div>
        `,
        isCustom: false,
      };
    }

    if (!fileContent && !result) {
      return {
        content: renderCollapsibleHeader(state, FilePenLine, headerText, contentRef, chevronRef),
        isCustom: false,
      };
    }

    const { lines, remaining } = truncateLines(fileContent, PREVIEW_LINES);
    const preview = lines.join("\n");

    return {
      content: html`
        <div>
          ${renderCollapsibleHeader(state, FilePenLine, headerText, contentRef, chevronRef)}
          <div class="overflow-hidden transition-all duration-200 max-h-0" ${/* ref */""}>
            ${preview ? html`<code-block .code=${preview} language="${lang}"></code-block>` : ""}
            ${remaining > 0
              ? html`<div class="text-xs text-muted-foreground mt-1">… (${remaining} more lines, ${remaining + lines.length} total)</div>`
              : ""}
          </div>
        </div>
      `,
      isCustom: false,
    };
  }
}

// ── Edit Renderer ───────────────────────────────────────────────────

class EditRenderer implements ToolRenderer {
  render(
    params: { path?: string; file_path?: string; oldText?: string; newText?: string } | undefined,
    result: ToolResultMessage | undefined,
    isStreaming?: boolean,
  ): ToolRenderResult {
    const state = toolState(result, isStreaming);
    const rawPath = params?.file_path ?? params?.path ?? "";
    const path = shortenPath(rawPath);

    const headerText = html`<code class="text-sm font-mono"><strong>edit</strong> ${path}</code>`;

    const contentRef = createRef<HTMLElement>();
    const chevronRef = createRef<HTMLElement>();

    if (result?.isError) {
      const output = getTextOutput(result);
      return {
        content: html`
          <div>
            ${renderCollapsibleHeader(state, FilePenLine, headerText, contentRef, chevronRef, true)}
            <div class="overflow-hidden transition-all duration-200 max-h-[2000px] mt-3" ${/* ref */""}>
              <div class="text-sm text-destructive">${output}</div>
            </div>
          </div>
        `,
        isCustom: false,
      };
    }

    if (!params?.oldText && !params?.newText) {
      return {
        content: renderCollapsibleHeader(state, FilePenLine, headerText, contentRef, chevronRef),
        isCustom: false,
      };
    }

    // Show old → new as a simple diff-like preview
    const oldLines = (params?.oldText ?? "").split("\n");
    const newLines = (params?.newText ?? "").split("\n");
    const maxPreview = 8;
    const oldPreview = oldLines.slice(0, maxPreview);
    const newPreview = newLines.slice(0, maxPreview);

    return {
      content: html`
        <div>
          ${renderCollapsibleHeader(state, FilePenLine, headerText, contentRef, chevronRef)}
          <div class="overflow-hidden transition-all duration-200 max-h-0" ${/* ref */""}>
            <div class="text-xs font-mono mt-2 space-y-0.5">
              ${oldPreview.map(
                (line) =>
                  html`<div class="text-red-400 dark:text-red-400 opacity-70">- ${line}</div>`,
              )}
              ${oldLines.length > maxPreview
                ? html`<div class="text-muted-foreground">… (${oldLines.length - maxPreview} more removed)</div>`
                : ""}
              ${newPreview.map(
                (line) =>
                  html`<div class="text-green-400 dark:text-green-400">+ ${line}</div>`,
              )}
              ${newLines.length > maxPreview
                ? html`<div class="text-muted-foreground">… (${newLines.length - maxPreview} more added)</div>`
                : ""}
            </div>
          </div>
        </div>
      `,
      isCustom: false,
    };
  }
}

// ── Bash Renderer (compact) ─────────────────────────────────────────

class CompactBashRenderer implements ToolRenderer {
  render(
    params: { command?: string; timeout?: number } | undefined,
    result: ToolResultMessage | undefined,
    isStreaming?: boolean,
  ): ToolRenderResult {
    const state = toolState(result, isStreaming);
    const command = params?.command ?? "";
    const timeout = params?.timeout;

    const timeoutStr = timeout ? html` <span class="text-muted-foreground">(timeout ${timeout}s)</span>` : "";
    const headerText = html`<code class="text-sm font-mono"><strong>$</strong> ${command}${timeoutStr}</code>`;

    const contentRef = createRef<HTMLElement>();
    const chevronRef = createRef<HTMLElement>();

    if (!result) {
      return {
        content: renderCollapsibleHeader(state, SquareTerminal, headerText, contentRef, chevronRef),
        isCustom: false,
      };
    }

    const output = getTextOutput(result).trim();
    const isError = result.isError;

    if (!output) {
      return {
        content: renderCollapsibleHeader(state, SquareTerminal, headerText, contentRef, chevronRef),
        isCustom: false,
      };
    }

    const { lines, remaining } = truncateLines(output, PREVIEW_LINES);
    const preview = lines.join("\n");

    return {
      content: html`
        <div>
          ${renderCollapsibleHeader(state, SquareTerminal, headerText, contentRef, chevronRef, true)}
          <div class="overflow-hidden transition-all duration-200 max-h-[2000px] mt-3" ${/* ref */""}>
            <console-block .content=${preview} .variant=${isError ? "error" : "default"}></console-block>
            ${remaining > 0
              ? html`<div class="text-xs text-muted-foreground mt-1">… (${remaining} more lines)</div>`
              : ""}
          </div>
        </div>
      `,
      isCustom: false,
    };
  }
}

// ── Ls Renderer ─────────────────────────────────────────────────────

class LsRenderer implements ToolRenderer {
  render(
    params: { path?: string; limit?: number } | undefined,
    result: ToolResultMessage | undefined,
    isStreaming?: boolean,
  ): ToolRenderResult {
    const state = toolState(result, isStreaming);
    const path = shortenPath(params?.path || ".");
    const limit = params?.limit;

    const limitStr = limit !== undefined ? html` <span class="text-muted-foreground">(limit ${limit})</span>` : "";
    const headerText = html`<code class="text-sm font-mono"><strong>ls</strong> ${path}${limitStr}</code>`;

    const contentRef = createRef<HTMLElement>();
    const chevronRef = createRef<HTMLElement>();

    if (!result) {
      return {
        content: renderCollapsibleHeader(state, FolderOpen, headerText, contentRef, chevronRef),
        isCustom: false,
      };
    }

    const output = getTextOutput(result).trim();
    if (!output) {
      return {
        content: renderCollapsibleHeader(state, FolderOpen, headerText, contentRef, chevronRef),
        isCustom: false,
      };
    }

    const { lines, remaining } = truncateLines(output, 20);
    const preview = lines.join("\n");

    return {
      content: html`
        <div>
          ${renderCollapsibleHeader(state, FolderOpen, headerText, contentRef, chevronRef)}
          <div class="overflow-hidden transition-all duration-200 max-h-0" ${/* ref */""}>
            <pre class="text-xs text-muted-foreground font-mono whitespace-pre-wrap mt-2">${preview}</pre>
            ${remaining > 0
              ? html`<div class="text-xs text-muted-foreground mt-1">… (${remaining} more lines)</div>`
              : ""}
          </div>
        </div>
      `,
      isCustom: false,
    };
  }
}

// ── Find Renderer ───────────────────────────────────────────────────

class FindRenderer implements ToolRenderer {
  render(
    params: { pattern?: string; path?: string; limit?: number } | undefined,
    result: ToolResultMessage | undefined,
    isStreaming?: boolean,
  ): ToolRenderResult {
    const state = toolState(result, isStreaming);
    const pattern = params?.pattern ?? "";
    const path = shortenPath(params?.path || ".");
    const limit = params?.limit;

    const limitStr = limit !== undefined ? html` <span class="text-muted-foreground">(limit ${limit})</span>` : "";
    const headerText = html`<code class="text-sm font-mono"><strong>find</strong> ${pattern} <span class="text-muted-foreground">in</span> ${path}${limitStr}</code>`;

    const contentRef = createRef<HTMLElement>();
    const chevronRef = createRef<HTMLElement>();

    if (!result) {
      return {
        content: renderCollapsibleHeader(state, FileSearch, headerText, contentRef, chevronRef),
        isCustom: false,
      };
    }

    const output = getTextOutput(result).trim();
    if (!output) {
      return {
        content: renderCollapsibleHeader(state, FileSearch, headerText, contentRef, chevronRef),
        isCustom: false,
      };
    }

    const { lines, remaining } = truncateLines(output, 20);
    const preview = lines.join("\n");

    return {
      content: html`
        <div>
          ${renderCollapsibleHeader(state, FileSearch, headerText, contentRef, chevronRef)}
          <div class="overflow-hidden transition-all duration-200 max-h-0" ${/* ref */""}>
            <pre class="text-xs text-muted-foreground font-mono whitespace-pre-wrap mt-2">${preview}</pre>
            ${remaining > 0
              ? html`<div class="text-xs text-muted-foreground mt-1">… (${remaining} more lines)</div>`
              : ""}
          </div>
        </div>
      `,
      isCustom: false,
    };
  }
}

// ── Grep Renderer ───────────────────────────────────────────────────

class GrepRenderer implements ToolRenderer {
  render(
    params: { pattern?: string; path?: string; glob?: string; limit?: number } | undefined,
    result: ToolResultMessage | undefined,
    isStreaming?: boolean,
  ): ToolRenderResult {
    const state = toolState(result, isStreaming);
    const pattern = params?.pattern ?? "";
    const path = shortenPath(params?.path || ".");
    const glob = params?.glob;
    const limit = params?.limit;

    let suffixParts: TemplateResult[] = [];
    if (glob) suffixParts.push(html` <span class="text-muted-foreground">(${glob})</span>`);
    if (limit !== undefined) suffixParts.push(html` <span class="text-muted-foreground">limit ${limit}</span>`);

    const headerText = html`<code class="text-sm font-mono"><strong>grep</strong> /${pattern}/ <span class="text-muted-foreground">in</span> ${path}${suffixParts}</code>`;

    const contentRef = createRef<HTMLElement>();
    const chevronRef = createRef<HTMLElement>();

    if (!result) {
      return {
        content: renderCollapsibleHeader(state, Search, headerText, contentRef, chevronRef),
        isCustom: false,
      };
    }

    const output = getTextOutput(result).trim();
    if (!output) {
      return {
        content: renderCollapsibleHeader(state, Search, headerText, contentRef, chevronRef),
        isCustom: false,
      };
    }

    const { lines, remaining } = truncateLines(output, 15);
    const preview = lines.join("\n");

    return {
      content: html`
        <div>
          ${renderCollapsibleHeader(state, Search, headerText, contentRef, chevronRef)}
          <div class="overflow-hidden transition-all duration-200 max-h-0" ${/* ref */""}>
            <pre class="text-xs text-muted-foreground font-mono whitespace-pre-wrap mt-2">${preview}</pre>
            ${remaining > 0
              ? html`<div class="text-xs text-muted-foreground mt-1">… (${remaining} more lines)</div>`
              : ""}
          </div>
        </div>
      `,
      isCustom: false,
    };
  }
}

// ── Registration ────────────────────────────────────────────────────

/**
 * Register all compact tool renderers.
 * Call once at app startup, before any agent-interface renders.
 *
 * Tool names are lowercase (pi-coding-agent canonical names).
 */
export function registerCompactToolRenderers(): void {
  registerToolRenderer("read", new ReadRenderer());
  registerToolRenderer("write", new WriteRenderer());
  registerToolRenderer("edit", new EditRenderer());
  registerToolRenderer("bash", new CompactBashRenderer());
  registerToolRenderer("ls", new LsRenderer());
  registerToolRenderer("find", new FindRenderer());
  registerToolRenderer("grep", new GrepRenderer());
}
