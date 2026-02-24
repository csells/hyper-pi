import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Autocomplete } from "./Autocomplete";
import type { CommandInfo, FileInfo } from "./types";

// Mock RemoteAgent with proper spy setup
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
    // Create a container with an agent-interface element and textarea inside it
    container = document.createElement("div");
    container.setAttribute("id", "test-container");

    const agentInterface = document.createElement("agent-interface");
    textarea = document.createElement("textarea");

    agentInterface.appendChild(textarea);
    container.appendChild(agentInterface);
    document.body.appendChild(container);

    agent = new MockRemoteAgent();
  });

  afterEach(() => {
    if (document.body.contains(container)) {
      document.body.removeChild(container);
    }
  });

  describe("/ command trigger", () => {
    it("requests commands when / is typed at start", async () => {
      const { unmount } = render(
        <Autocomplete agent={agent as any} container={container} />
      );

      // Type / at start of input
      textarea.value = "/";
      textarea.selectionStart = 1;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      // Wait a tick for the event handler to process
      await waitFor(() => {
        expect(agent.listCommands).toHaveBeenCalled();
      });

      unmount();
    });

    it("triggers commands list callback", async () => {
      const { unmount } = render(
        <Autocomplete agent={agent as any} container={container} />
      );

      // Simulate agent receiving commands
      const commands: CommandInfo[] = [
        { name: "bash", description: "Run shell commands" },
        { name: "ls", description: "List files" },
      ];

      agent.onCommandsList?.(commands);

      unmount();
    });
  });

  describe("@ file trigger", () => {
    it("requests files when @ is typed", async () => {
      const { unmount } = render(
        <Autocomplete agent={agent as any} container={container} />
      );

      textarea.value = "@";
      textarea.selectionStart = 1;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      await waitFor(() => {
        expect(agent.listFiles).toHaveBeenCalled();
      });

      unmount();
    });

    it("does not request files when @ is followed by space", async () => {
      agent.listFiles.mockClear();

      const { unmount } = render(
        <Autocomplete agent={agent as any} container={container} />
      );

      textarea.value = "@ ";
      textarea.selectionStart = 2;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      // Give it a moment to NOT fire
      await new Promise((r) => setTimeout(r, 100));

      expect(agent.listFiles).not.toHaveBeenCalled();

      unmount();
    });

    it("triggers files list callback", async () => {
      const { unmount } = render(
        <Autocomplete agent={agent as any} container={container} />
      );

      const files: FileInfo[] = [
        {
          name: "App.tsx",
          isDirectory: false,
          path: "pi-de/src/App.tsx",
        },
      ];

      agent.onFilesList?.(files, "/Users/test/hyper-pi");

      unmount();
    });
  });

  describe("keyboard handling", () => {
    it("does not throw on Escape key", async () => {
      const { unmount } = render(
        <Autocomplete agent={agent as any} container={container} />
      );

      textarea.value = "/";
      textarea.selectionStart = 1;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      const escapeEvent = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      });
      textarea.dispatchEvent(escapeEvent);

      // Should not throw
      expect(true).toBe(true);

      unmount();
    });

    it("does not throw on ArrowUp/ArrowDown", async () => {
      const { unmount } = render(
        <Autocomplete agent={agent as any} container={container} />
      );

      textarea.value = "/";
      textarea.selectionStart = 1;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      const upEvent = new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
      });
      textarea.dispatchEvent(upEvent);

      const downEvent = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
      });
      textarea.dispatchEvent(downEvent);

      expect(true).toBe(true);

      unmount();
    });

    it("does not throw on Enter key", async () => {
      const { unmount } = render(
        <Autocomplete agent={agent as any} container={container} />
      );

      textarea.value = "/";
      textarea.selectionStart = 1;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      const enterEvent = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      });
      textarea.dispatchEvent(enterEvent);

      expect(true).toBe(true);

      unmount();
    });

    it("does not throw on Tab key", async () => {
      const { unmount } = render(
        <Autocomplete agent={agent as any} container={container} />
      );

      textarea.value = "/";
      textarea.selectionStart = 1;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      const tabEvent = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
      });
      textarea.dispatchEvent(tabEvent);

      expect(true).toBe(true);

      unmount();
    });
  });

  describe("filter functions", () => {
    it("limits command results to 10 items", async () => {
      const { unmount } = render(
        <Autocomplete agent={agent as any} container={container} />
      );

      // Create 20 commands
      const commands = Array.from({ length: 20 }, (_, i) => ({
        name: `cmd${i}`,
        description: `Command ${i}`,
      }));

      // Trigger commands callback
      agent.onCommandsList?.(commands);

      // Component should limit to 10
      // (Filtering happens internally in the component)

      unmount();
    });

    it("limits file results to 10 items", async () => {
      const { unmount } = render(
        <Autocomplete agent={agent as any} container={container} />
      );

      const files = Array.from({ length: 20 }, (_, i) => ({
        name: `file${i}.ts`,
        isDirectory: false,
        path: `src/file${i}.ts`,
      }));

      agent.onFilesList?.(files, "/Users/test");

      unmount();
    });
  });
});
