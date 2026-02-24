/**
 * Autocomplete UI for Pi-DE message editor.
 *
 * Monitors the message editor textarea for / and @ triggers,
 * shows a floating popup with filtered suggestions,
 * and inserts the completed text on selection.
 *
 * - `/` at start of line → slash commands (from pi.getCommands())
 * - `@` followed by non-space → file paths (from directory listing)
 *
 * Uses theme-aware CSS variables for styling.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { RemoteAgent } from "./RemoteAgent";
import type { CommandInfo, FileInfo } from "./types";

/** Union discriminated by trigger type */
type AutocompleteItem =
  | { kind: "command"; name: string; description: string }
  | { kind: "file"; path: string; isDirectory: boolean };

function itemLabel(item: AutocompleteItem): string {
  return item.kind === "command" ? item.name : item.path;
}

function itemDescription(item: AutocompleteItem): string {
  if (item.kind === "command") return item.description;
  return item.isDirectory ? "directory" : "file";
}

interface AutocompleteState {
  isVisible: boolean;
  trigger: "/" | "@" | null;
  /** Text after the trigger character, used for filtering */
  prefix: string;
  /** Index in textarea.value where the trigger character sits */
  triggerIndex: number;
  items: AutocompleteItem[];
  selectedIndex: number;
}

const INITIAL_STATE: AutocompleteState = {
  isVisible: false,
  trigger: null,
  prefix: "",
  triggerIndex: 0,
  items: [],
  selectedIndex: 0,
};

const MAX_ITEMS = 15;

/**
 * Autocomplete component rendered alongside <agent-interface>.
 * Finds the textarea via DOM query and attaches input/keydown listeners.
 */
export function Autocomplete({
  agent,
  container,
}: {
  agent: RemoteAgent;
  container: HTMLElement | null;
}) {
  const [state, setState] = useState<AutocompleteState>(INITIAL_STATE);
  const stateRef = useRef(state);
  const popupRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Keep ref in sync
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const hide = useCallback(() => setState(INITIAL_STATE), []);

  // ── RemoteAgent response callbacks ──────────────────────
  useEffect(() => {
    agent.onCommandsList = (commands: CommandInfo[]) => {
      if (stateRef.current.trigger !== "/") return;
      const items = filterCommands(commands, stateRef.current.prefix);
      setState((s) => ({ ...s, items, selectedIndex: 0 }));
    };

    agent.onFilesList = (files: FileInfo[], _cwd: string) => {
      if (stateRef.current.trigger !== "@") return;
      const items = filterFiles(files, stateRef.current.prefix);
      setState((s) => ({ ...s, items, selectedIndex: 0 }));
    };

    return () => {
      agent.onCommandsList = null;
      agent.onFilesList = null;
    };
  }, [agent]);

  // ── Insert selected item into textarea ──────────────────
  const insertCompletion = useCallback(
    (item: AutocompleteItem) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const text = textarea.value;
      const s = stateRef.current;

      // The trigger char is at s.triggerIndex; replace from there to cursor
      const completion = itemLabel(item);
      // For files: append / if directory so user can keep drilling down
      const suffix = item.kind === "file" && item.isDirectory ? "/" : " ";
      const endIndex = textarea.selectionStart;
      const newText =
        text.slice(0, s.triggerIndex) + completion + suffix + text.slice(endIndex);

      textarea.value = newText;
      const cursorPos = s.triggerIndex + completion.length + suffix.length;
      textarea.selectionStart = cursorPos;
      textarea.selectionEnd = cursorPos;

      // Notify Lit that the value changed
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
      hide();
    },
    [hide],
  );

  // ── Textarea event listeners ────────────────────────────
  useEffect(() => {
    if (!container) return;

    const findTextarea = (): HTMLTextAreaElement | null => {
      const ai =
        container.tagName === "AGENT-INTERFACE"
          ? container
          : container.querySelector("agent-interface");
      return ai?.querySelector("textarea") ?? null;
    };

    const handleInput = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const text = textarea.value;
      const cursor = textarea.selectionStart;
      const beforeCursor = text.slice(0, cursor);

      // Find the current line
      const lastNewline = beforeCursor.lastIndexOf("\n");
      const lineStart = lastNewline + 1;
      const lineText = beforeCursor.slice(lineStart);

      // `/` at start of line → slash command autocomplete
      if (/^\/\S*$/.test(lineText)) {
        const prefix = lineText.slice(1);
        setState((s) => ({
          ...s,
          isVisible: true,
          trigger: "/",
          prefix,
          triggerIndex: lineStart,
          selectedIndex: 0,
          items: s.trigger === "/" ? s.items : [], // keep items if already filtering
        }));
        agent.listCommands();
        return;
      }

      // `@` followed by non-space characters → file autocomplete
      const atMatch = lineText.match(/(^|[\s])@([^\s]*)$/);
      if (atMatch) {
        const prefix = atMatch[2];
        // triggerIndex points at the `@` character
        const atOffset = lineStart + lineText.lastIndexOf("@");
        setState((s) => ({
          ...s,
          isVisible: true,
          trigger: "@",
          prefix,
          triggerIndex: atOffset,
          selectedIndex: 0,
          items: s.trigger === "@" ? s.items : [],
        }));
        agent.listFiles(prefix || undefined);
        return;
      }

      // No trigger active
      if (stateRef.current.isVisible) hide();
    };

    const handleKeydown = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (!s.isVisible || s.items.length === 0) return;

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          hide();
          break;
        case "ArrowUp":
          e.preventDefault();
          setState((prev) => ({
            ...prev,
            selectedIndex: Math.max(0, prev.selectedIndex - 1),
          }));
          break;
        case "ArrowDown":
          e.preventDefault();
          setState((prev) => ({
            ...prev,
            selectedIndex: Math.min(prev.items.length - 1, prev.selectedIndex + 1),
          }));
          break;
        case "Tab":
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          insertCompletion(s.items[s.selectedIndex]);
          break;
      }
    };

    // Attach to textarea
    const attach = () => {
      const ta = findTextarea();
      if (!ta) return false;
      textareaRef.current = ta;
      ta.addEventListener("input", handleInput);
      ta.addEventListener("keydown", handleKeydown, { capture: true });
      return true;
    };

    let attached = attach();

    let observer: MutationObserver | null = null;
    if (!attached) {
      observer = new MutationObserver(() => {
        if (!attached) {
          attached = attach();
          if (attached) {
            observer?.disconnect();
            observer = null;
          }
        }
      });
      observer.observe(container, { childList: true, subtree: true });
    }

    return () => {
      const ta = textareaRef.current;
      if (ta) {
        ta.removeEventListener("input", handleInput);
        ta.removeEventListener("keydown", handleKeydown, { capture: true });
      }
      observer?.disconnect();
    };
  }, [container, agent, hide, insertCompletion]);

  // ── Render ──────────────────────────────────────────────
  if (!state.isVisible || state.items.length === 0) return null;

  return (
    <div
      ref={popupRef}
      className="autocomplete-popup"
      style={{
        position: "absolute",
        bottom: "100%",
        left: 0,
        right: 0,
        marginBottom: 4,
        backgroundColor: "var(--bg-panel, #1e1e1e)",
        border: "1px solid var(--border-color, #444)",
        borderRadius: 6,
        boxShadow: "0 -4px 16px rgba(0,0,0,0.3)",
        zIndex: 1000,
        maxHeight: 280,
        overflowY: "auto",
      }}
    >
      {state.items.map((item, idx) => (
        <div
          key={itemLabel(item)}
          className="autocomplete-item"
          style={{
            padding: "6px 12px",
            cursor: "pointer",
            backgroundColor:
              idx === state.selectedIndex
                ? "var(--accent, #0e639c)"
                : "transparent",
            color:
              idx === state.selectedIndex
                ? "#fff"
                : "var(--text-main, #ccc)",
            borderBottom:
              idx < state.items.length - 1
                ? "1px solid var(--border-color, #333)"
                : "none",
            display: "flex",
            alignItems: "baseline",
            gap: 8,
          }}
          onClick={() => insertCompletion(item)}
          onMouseEnter={() =>
            setState((s) => ({ ...s, selectedIndex: idx }))
          }
        >
          <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
            {item.kind === "file" && item.isDirectory ? "📁 " : ""}
            {itemLabel(item)}
          </span>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-muted, #888)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {itemDescription(item)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Filter helpers ────────────────────────────────────────

function filterCommands(
  commands: CommandInfo[],
  prefix: string,
): AutocompleteItem[] {
  const lowerPrefix = prefix.toLowerCase();
  const filtered = commands
    .filter((c) => c.name.toLowerCase().includes(lowerPrefix))
    .slice(0, MAX_ITEMS);
  return filtered.map((c) => ({
    kind: "command",
    name: c.name,
    description: c.description,
  }));
}

function filterFiles(
  files: FileInfo[],
  prefix: string,
): AutocompleteItem[] {
  const lowerPrefix = prefix.toLowerCase();
  const basename = prefix.includes("/")
    ? prefix.slice(prefix.lastIndexOf("/") + 1)
    : prefix;
  const lowerBasename = basename.toLowerCase();

  const filtered = files
    .filter((f) => {
      // Match against the last path component
      const name = f.path.includes("/")
        ? f.path.slice(f.path.lastIndexOf("/") + 1)
        : f.path;
      return name.toLowerCase().startsWith(lowerBasename) ||
        f.path.toLowerCase().startsWith(lowerPrefix);
    })
    .slice(0, MAX_ITEMS);

  return filtered.map((f) => ({
    kind: "file",
    path: f.path,
    isDirectory: f.isDirectory,
  }));
}
