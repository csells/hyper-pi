/**
 * Autocomplete UI for Pi-DE message editor.
 *
 * Monitors the message editor textarea for / and @ triggers,
 * shows a floating popup with filtered suggestions,
 * and inserts the completed text on selection.
 *
 * Patches the editor via MutationObserver (similar to patchSendDuringStreaming.ts).
 */

import { useEffect, useRef, useState } from "react";
import type { RemoteAgent } from "./RemoteAgent";
import type { CommandInfo, FileInfo } from "./types";

interface AutocompleteState {
  isVisible: boolean;
  trigger: "/" | "@" | null;
  prefix: string;
  startIndex: number;
  items: (CommandInfo | FileInfo)[];
  selectedIndex: number;
  popupEl: HTMLElement | null;
  textareaEl: HTMLTextAreaElement | null;
}

/**
 * Autocomplete component that patches the message editor textarea
 * and displays suggestions for / commands and @ files.
 */
export function Autocomplete({
  agent,
  container,
}: {
  agent: RemoteAgent;
  container: HTMLElement | null;
}) {
  const [state, setState] = useState<AutocompleteState>({
    isVisible: false,
    trigger: null,
    prefix: "",
    startIndex: 0,
    items: [],
    selectedIndex: 0,
    popupEl: null,
    textareaEl: null,
  });

  const stateRef = useRef(state);
  const popupRef = useRef<HTMLDivElement>(null);
  const keydownHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  const inputHandlerRef = useRef<((e: Event) => void) | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Set up RemoteAgent callbacks for command/file responses
  useEffect(() => {
    const onCommandsList = (commands: CommandInfo[]) => {
      if (stateRef.current.trigger === "/") {
        const filtered = filterCommands(commands, stateRef.current.prefix);
        setState((s) => ({ ...s, items: filtered, selectedIndex: 0 }));
      }
    };

    const onFilesList = (files: FileInfo[], _cwd: string) => {
      if (stateRef.current.trigger === "@") {
        const filtered = filterFiles(files, stateRef.current.prefix);
        setState((s) => ({ ...s, items: filtered, selectedIndex: 0 }));
      }
    };

    agent.onCommandsList = onCommandsList;
    agent.onFilesList = onFilesList;

    return () => {
      agent.onCommandsList = null;
      agent.onFilesList = null;
    };
  }, [agent]);

  // Main effect: set up textarea monitoring and event handlers
  useEffect(() => {
    if (!container) return;

    const findTextarea = () => {
      const ai = container.tagName === "AGENT-INTERFACE"
        ? container
        : container.querySelector("agent-interface");
      if (!ai) return null;
      return ai.querySelector("textarea") as HTMLTextAreaElement | null;
    };

    const hideAutocomplete = () => {
      setState((s) => ({
        ...s,
        isVisible: false,
        trigger: null,
        items: [],
        selectedIndex: 0,
      }));
    };

    const handleInput = (e: Event) => {
      const textarea = e.target as HTMLTextAreaElement;
      const text = textarea.value;
      const cursorPos = textarea.selectionStart;

      // Look for / trigger at start of line
      const beforeCursor = text.slice(0, cursorPos);
      const lastNewline = beforeCursor.lastIndexOf("\n");
      const lineStart = lastNewline + 1;
      const lineText = beforeCursor.slice(lineStart);

      // Check for / at start of line
      if (lineText.match(/^\/\S*$/)) {
        const prefix = lineText.slice(1); // Remove /
        setState((s) => ({
          ...s,
          isVisible: true,
          trigger: "/",
          prefix,
          startIndex: lineStart,
          textareaEl: textarea,
          popupEl: popupRef.current,
        }));
        agent.listCommands();
        return;
      }

      // Check for @ anywhere in the line
      const atMatch = lineText.match(/.*@([^\s]*)$/);
      if (atMatch) {
        const atIndex = lineStart + atMatch[0].indexOf("@") + 1;
        const prefix = atMatch[1];
        setState((s) => ({
          ...s,
          isVisible: true,
          trigger: "@",
          prefix,
          startIndex: atIndex,
          textareaEl: textarea,
          popupEl: popupRef.current,
        }));
        agent.listFiles(prefix || undefined);
        return;
      }

      // Neither / nor @ found
      hideAutocomplete();
    };

    const handleKeydown = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (!s.isVisible) return;

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          hideAutocomplete();
          break;

        case "ArrowUp":
          e.preventDefault();
          setState((prevState) => ({
            ...prevState,
            selectedIndex: Math.max(0, prevState.selectedIndex - 1),
          }));
          break;

        case "ArrowDown":
          e.preventDefault();
          setState((prevState) => ({
            ...prevState,
            selectedIndex: Math.min(
              prevState.items.length - 1,
              prevState.selectedIndex + 1
            ),
          }));
          break;

        case "Enter":
          e.preventDefault();
          if (s.items.length > 0) {
            selectItem(s.items[s.selectedIndex]);
          }
          hideAutocomplete();
          break;

        case "Tab":
          e.preventDefault();
          if (s.items.length > 0) {
            selectItem(s.items[s.selectedIndex]);
          }
          hideAutocomplete();
          break;

        default:
          break;
      }
    };

    inputHandlerRef.current = handleInput;
    keydownHandlerRef.current = handleKeydown;

    const selectItem = (item: CommandInfo | FileInfo) => {
      const textarea = stateRef.current.textareaEl;
      if (!textarea) return;

      const text = textarea.value;
      const trigger = stateRef.current.trigger;
      const startIndex = stateRef.current.startIndex;
      const endIndex = textarea.selectionStart;

      // Construct completion: "trigger" + item name
      const completion = trigger === "/" ? item.name : (item as FileInfo).path;

      // Replace trigger + prefix with completion
      const newText =
        text.slice(0, startIndex - 1) + completion + text.slice(endIndex);

      textarea.value = newText;
      textarea.selectionStart = startIndex - 1 + completion.length;
      textarea.selectionEnd = textarea.selectionStart;

      // Trigger input event so parent component knows text changed
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      hideAutocomplete();
    };

    // Attach listeners once we have a textarea
    const attachListeners = () => {
      let textarea = findTextarea();
      if (!textarea) return false;

      textarea.addEventListener("input", handleInput);
      textarea.addEventListener("keydown", handleKeydown);
      return true;
    };

    // Try immediately
    let attached = attachListeners();

    // If not found, use MutationObserver to wait for textarea
    if (!attached) {
      observerRef.current = new MutationObserver(() => {
        if (!attached) {
          attached = attachListeners();
          if (attached && observerRef.current) {
            observerRef.current.disconnect();
            observerRef.current = null;
          }
        }
      });

      observerRef.current.observe(container, { childList: true, subtree: true });
    }

    // Cleanup
    return () => {
      let textarea = findTextarea();
      if (textarea && keydownHandlerRef.current && inputHandlerRef.current) {
        textarea.removeEventListener("input", inputHandlerRef.current);
        textarea.removeEventListener("keydown", keydownHandlerRef.current);
      }
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [container, agent]);

  // Handle mouse selection in popup
  const handleItemClick = (item: CommandInfo | FileInfo) => {
    const textarea = state.textareaEl;
    if (!textarea) return;

    const text = textarea.value;
    const trigger = state.trigger;
    const startIndex = state.startIndex;
    const endIndex = textarea.selectionStart;

    const completion = trigger === "/" ? item.name : (item as FileInfo).path;
    const newText =
      text.slice(0, startIndex - 1) + completion + text.slice(endIndex);

    textarea.value = newText;
    textarea.selectionStart = startIndex - 1 + completion.length;
    textarea.selectionEnd = textarea.selectionStart;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    setState((s) => ({
      ...s,
      isVisible: false,
      trigger: null,
      items: [],
      selectedIndex: 0,
    }));

    textarea.focus();
  };

  if (!state.isVisible || !state.popupEl) {
    // Return a ref div that won't render but serves as the popup container anchor
    return <div ref={popupRef} style={{ display: "none" }} />;
  }

  // Render popup
  return (
    <div
      ref={popupRef}
      style={{
        position: "fixed",
        bottom: "10px",
        left: "50%",
        transform: "translateX(-50%)",
        backgroundColor: "#1e1e1e",
        border: "1px solid #444",
        borderRadius: "4px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
        zIndex: 1000,
        maxWidth: "300px",
        maxHeight: "300px",
        overflow: "auto",
      }}
    >
      {state.items.length === 0 && (
        <div style={{ padding: "8px 12px", color: "#999" }}>
          No {state.trigger === "/" ? "commands" : "files"} found
        </div>
      )}
      {state.items.map((item, idx) => {
        const isCommand = "description" in item;
        const description = isCommand
          ? (item as CommandInfo).description
          : (item as FileInfo).path;
        return (
          <div
            key={idx}
            style={{
              padding: "8px 12px",
              backgroundColor:
                idx === state.selectedIndex ? "#0e639c" : "transparent",
              color: "#fff",
              cursor: "pointer",
              borderBottom: "1px solid #333",
            }}
            onClick={() => handleItemClick(item)}
            onMouseEnter={() => setState((s) => ({ ...s, selectedIndex: idx }))}
          >
            <div style={{ fontWeight: "bold" }}>{item.name}</div>
            <div style={{ fontSize: "12px", color: "#aaa" }}>
              {description}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Filter commands by prefix.
 */
function filterCommands(
  commands: CommandInfo[],
  prefix: string
): CommandInfo[] {
  if (!prefix) return commands.slice(0, 10);
  const filtered = commands.filter((c) =>
    c.name.toLowerCase().startsWith(prefix.toLowerCase())
  );
  return filtered.slice(0, 10);
}

/**
 * Filter files by prefix.
 */
function filterFiles(files: FileInfo[], prefix: string): FileInfo[] {
  if (!prefix) return files.slice(0, 10);
  const filtered = files.filter((f) =>
    f.name.toLowerCase().startsWith(prefix.toLowerCase())
  );
  return filtered.slice(0, 10);
}
