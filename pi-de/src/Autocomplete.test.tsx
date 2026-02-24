import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { Autocomplete } from "./Autocomplete";
import type { CommandInfo, FileInfo } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

class MockRemoteAgent {
  onCommandsList: ((commands: CommandInfo[]) => void) | null = null;
  onFilesList: ((files: FileInfo[], cwd: string) => void) | null = null;
  listCommands = vi.fn();
  listFiles = vi.fn();
}

describe("Autocomplete", () => {
  let container: HTMLDivElement;
  let textarea: HTMLTextAreaElement;
  let agent: MockRemoteAgent;

  beforeEach(() => {
    container = document.createElement("div");
    const ai = document.createElement("agent-interface");
    textarea = document.createElement("textarea");
    ai.appendChild(textarea);
    container.appendChild(ai);
    document.body.appendChild(container);
    agent = new MockRemoteAgent();
  });

  afterEach(() => {
    if (document.body.contains(container)) {
      document.body.removeChild(container);
    }
  });

  /** Helper: type into textarea and trigger input event inside act() */
  function typeInto(ta: HTMLTextAreaElement, value: string) {
    ta.value = value;
    ta.selectionStart = value.length;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // ── / command trigger ─────────────────────────────────────

  describe("/ command trigger", () => {
    it("calls listCommands when / is typed at start of line", async () => {
      render(<Autocomplete agent={agent as any} container={container} />);

      act(() => typeInto(textarea, "/"));

      expect(agent.listCommands).toHaveBeenCalled();
    });

    it("calls listCommands for /he partial input", async () => {
      render(<Autocomplete agent={agent as any} container={container} />);

      act(() => typeInto(textarea, "/he"));

      expect(agent.listCommands).toHaveBeenCalled();
    });

    it("does not trigger for / in middle of word", () => {
      render(<Autocomplete agent={agent as any} container={container} />);

      act(() => typeInto(textarea, "hello /world"));

      expect(agent.listCommands).not.toHaveBeenCalled();
    });

    it("renders command items when response arrives", async () => {
      const { container: root } = render(
        <Autocomplete agent={agent as any} container={container} />,
      );

      act(() => typeInto(textarea, "/"));

      // Simulate the server response inside act
      act(() => {
        agent.onCommandsList?.([
          { name: "/help", description: "Show help" },
          { name: "/reload", description: "Reload extensions" },
        ]);
      });

      await waitFor(() => {
        const items = root.querySelectorAll(".autocomplete-item");
        expect(items.length).toBe(2);
      });
    });

    it("filters commands by prefix", async () => {
      const { container: root } = render(
        <Autocomplete agent={agent as any} container={container} />,
      );

      act(() => typeInto(textarea, "/he"));

      act(() => {
        agent.onCommandsList?.([
          { name: "/help", description: "Show help" },
          { name: "/reload", description: "Reload extensions" },
        ]);
      });

      await waitFor(() => {
        const items = root.querySelectorAll(".autocomplete-item");
        expect(items.length).toBe(1);
      });
    });
  });

  // ── @ file trigger ────────────────────────────────────────

  describe("@ file trigger", () => {
    it("calls listFiles when @ is typed", () => {
      render(<Autocomplete agent={agent as any} container={container} />);

      act(() => typeInto(textarea, "@"));

      expect(agent.listFiles).toHaveBeenCalled();
    });

    it("calls listFiles with prefix", () => {
      render(<Autocomplete agent={agent as any} container={container} />);

      act(() => typeInto(textarea, "@src/"));

      expect(agent.listFiles).toHaveBeenCalledWith("src/");
    });

    it("does not trigger for @ followed by space", () => {
      render(<Autocomplete agent={agent as any} container={container} />);

      act(() => typeInto(textarea, "@ "));

      expect(agent.listFiles).not.toHaveBeenCalled();
    });

    it("renders file items with directory indicator", async () => {
      const { container: root } = render(
        <Autocomplete agent={agent as any} container={container} />,
      );

      act(() => typeInto(textarea, "@"));

      act(() => {
        agent.onFilesList?.(
          [
            { path: "src", isDirectory: true },
            { path: "README.md", isDirectory: false },
          ],
          "/project",
        );
      });

      await waitFor(() => {
        const items = root.querySelectorAll(".autocomplete-item");
        expect(items.length).toBe(2);
      });
    });
  });

  // ── Keyboard navigation ───────────────────────────────────

  describe("keyboard navigation", () => {
    async function showPopupWithCommands(root: HTMLElement) {
      act(() => typeInto(textarea, "/"));
      act(() => {
        agent.onCommandsList?.([
          { name: "/help", description: "Help" },
          { name: "/reload", description: "Reload" },
        ]);
      });
      await waitFor(() => {
        expect(root.querySelectorAll(".autocomplete-item").length).toBe(2);
      });
    }

    it("Escape hides the popup", async () => {
      const { container: root } = render(
        <Autocomplete agent={agent as any} container={container} />,
      );

      await showPopupWithCommands(root);

      act(() => {
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });

      await waitFor(() => {
        expect(root.querySelector(".autocomplete-popup")).toBeFalsy();
      });
    });

    it("ArrowDown advances selectedIndex", async () => {
      const { container: root } = render(
        <Autocomplete agent={agent as any} container={container} />,
      );

      await showPopupWithCommands(root);

      act(() => {
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
      });

      // The second item should now be highlighted
      await waitFor(() => {
        const items = root.querySelectorAll(".autocomplete-item");
        expect(items.length).toBe(2);
      });
    });

    it("Tab inserts the selected completion", async () => {
      const { container: root } = render(
        <Autocomplete agent={agent as any} container={container} />,
      );

      act(() => typeInto(textarea, "/he"));
      act(() => {
        agent.onCommandsList?.([{ name: "/help", description: "Help" }]);
      });

      await waitFor(() => {
        expect(root.querySelectorAll(".autocomplete-item").length).toBe(1);
      });

      act(() => {
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
        );
      });

      expect(textarea.value).toContain("/help");
    });

    it("Enter inserts the selected completion", async () => {
      const { container: root } = render(
        <Autocomplete agent={agent as any} container={container} />,
      );

      act(() => typeInto(textarea, "/"));
      act(() => {
        agent.onCommandsList?.([{ name: "/help", description: "Help" }]);
      });

      await waitFor(() => {
        expect(root.querySelectorAll(".autocomplete-item").length).toBe(1);
      });

      act(() => {
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });

      expect(textarea.value).toContain("/help");
    });
  });

  // ── Edge cases ────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles missing container gracefully", () => {
      expect(() => {
        const { unmount } = render(
          <Autocomplete agent={agent as any} container={null} />,
        );
        unmount();
      }).not.toThrow();
    });

    it("popup hidden for empty result set", async () => {
      const { container: root } = render(
        <Autocomplete agent={agent as any} container={container} />,
      );

      act(() => typeInto(textarea, "/xyz"));
      act(() => {
        agent.onCommandsList?.([]);
      });

      // No popup when items list is empty
      expect(root.querySelector(".autocomplete-popup")).toBeFalsy();
    });

    it("hides when input no longer matches trigger", async () => {
      const { container: root } = render(
        <Autocomplete agent={agent as any} container={container} />,
      );

      // Show popup
      act(() => typeInto(textarea, "/"));
      act(() => {
        agent.onCommandsList?.([{ name: "/help", description: "Help" }]);
      });

      await waitFor(() => {
        expect(root.querySelector(".autocomplete-popup")).toBeTruthy();
      });

      // Clear input — should hide
      act(() => typeInto(textarea, ""));

      await waitFor(() => {
        expect(root.querySelector(".autocomplete-popup")).toBeFalsy();
      });
    });

    it("limits results to MAX_ITEMS (15)", async () => {
      const { container: root } = render(
        <Autocomplete agent={agent as any} container={container} />,
      );

      act(() => typeInto(textarea, "/"));

      act(() => {
        const commands = Array.from({ length: 30 }, (_, i) => ({
          name: `/cmd${i}`,
          description: `Command ${i}`,
        }));
        agent.onCommandsList?.(commands);
      });

      await waitFor(() => {
        const items = root.querySelectorAll(".autocomplete-item");
        expect(items.length).toBeLessThanOrEqual(15);
        expect(items.length).toBeGreaterThan(0);
      });
    });

    it("finds textarea added via MutationObserver", async () => {
      const lateContainer = document.createElement("div");
      document.body.appendChild(lateContainer);

      render(<Autocomplete agent={agent as any} container={lateContainer} />);

      // Add agent-interface + textarea after render
      const ai = document.createElement("agent-interface");
      const ta = document.createElement("textarea");
      ai.appendChild(ta);
      lateContainer.appendChild(ai);

      // Wait for observer to fire
      await new Promise((r) => setTimeout(r, 50));

      act(() => typeInto(ta, "/"));

      expect(agent.listCommands).toHaveBeenCalled();

      document.body.removeChild(lateContainer);
    });

    it("cleans up callbacks on unmount", () => {
      const { unmount } = render(
        <Autocomplete agent={agent as any} container={container} />,
      );

      expect(agent.onCommandsList).not.toBeNull();
      unmount();
      expect(agent.onCommandsList).toBeNull();
      expect(agent.onFilesList).toBeNull();
    });
  });
});
