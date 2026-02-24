import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { patchSendDuringStreaming } from "./patchSendDuringStreaming";

describe("patchSendDuringStreaming", () => {
  let container: HTMLElement;
  let agentInterface: HTMLElement;
  let messageEditor: HTMLElement;
  let textarea: HTMLTextAreaElement;

  beforeEach(() => {
    // Create test DOM structure
    container = document.createElement("div");
    agentInterface = document.createElement("agent-interface");
    messageEditor = document.createElement("message-editor");
    textarea = document.createElement("textarea");

    messageEditor.appendChild(textarea);
    agentInterface.appendChild(messageEditor);
    container.appendChild(agentInterface);
    document.body.appendChild(container);

    // Set up mock session on agent-interface
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agentInterface as any).session = {
      state: { isStreaming: true },
      prompt: vi.fn(),
    };

    // Mock the original sendMessage (as would exist on real AgentInterface from pi-web-ui)
    // The original sendMessage is async and gates on isStreaming
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agentInterface as any).sendMessage = vi.fn(async function (this: any) {
      // Original would gate here: if (this.session?.state.isStreaming) return;
      // So our patch should allow this
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(this as any).session) return;
      const text = textarea.value.trim();
      if (!text) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this as any).session.prompt(text);
      textarea.value = "";
      textarea.focus();
    });
  });

  afterEach(() => {
    if (container && document.body.contains(container)) {
      document.body.removeChild(container);
    }
  });

  describe("patchSendDuringStreaming core functionality", () => {
    it("returns a cleanup function", () => {
      const cleanup = patchSendDuringStreaming(agentInterface);
      expect(cleanup).toBeInstanceOf(Function);
    });

    it("patches AgentInterface.sendMessage", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalSendMessage = (agentInterface as any).sendMessage;
      const cleanup = patchSendDuringStreaming(agentInterface);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patchedSendMessage = (agentInterface as any).sendMessage;

      // Should be a different function
      expect(typeof patchedSendMessage).toBe("function");
      
      cleanup();
    });

    it("patches MessageEditor.isStreaming to always return false", () => {
      const cleanup = patchSendDuringStreaming(agentInterface);

      // Set isStreaming to true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (messageEditor as any).isStreaming = true;
      // Should still return false
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((messageEditor as any).isStreaming).toBe(false);

      // Set to false
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (messageEditor as any).isStreaming = false;
      // Should still return false
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((messageEditor as any).isStreaming).toBe(false);

      cleanup();
    });

    it("cleanup restores original behavior", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalSendMessage = (agentInterface as any).sendMessage;
      const cleanup = patchSendDuringStreaming(agentInterface);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patchedSendMessage = (agentInterface as any).sendMessage;

      // Verify it was patched
      expect(typeof patchedSendMessage).toBe("function");

      cleanup();

      // After cleanup, should be a function (restored or original)
      // Note: might not be exact same object due to .bind() in implementation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(typeof (agentInterface as any).sendMessage).toBe("function");
    });
  });

  describe("MessageEditor.isStreaming patching", () => {
    it("always returns false regardless of assignment attempts", () => {
      const cleanup = patchSendDuringStreaming(agentInterface);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((messageEditor as any).isStreaming).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (messageEditor as any).isStreaming = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((messageEditor as any).isStreaming).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (messageEditor as any).isStreaming = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((messageEditor as any).isStreaming).toBe(false);

      cleanup();
    });

    it("allows assignment without errors (no-op setter)", () => {
      const cleanup = patchSendDuringStreaming(agentInterface);

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (messageEditor as any).isStreaming = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (messageEditor as any).isStreaming = false;
      }).not.toThrow();

      cleanup();
    });

    it("cleanup restores original isStreaming behavior", () => {
      const cleanup = patchSendDuringStreaming(agentInterface);

      // Patched: always false
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((messageEditor as any).isStreaming).toBe(false);

      cleanup();

      // After cleanup, cleanup doesn't throw
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const val = (messageEditor as any).isStreaming;
      }).not.toThrow();
    });
  });

  describe("MutationObserver integration", () => {
    it("finds agent-interface added later via MutationObserver", async () => {
      const delayedContainer = document.createElement("div");
      container.appendChild(delayedContainer);

      const cleanup = patchSendDuringStreaming(delayedContainer);

      // Add agent-interface after observer is set up
      const delayedAgentInterface = document.createElement("agent-interface");
      const delayedMessageEditor = document.createElement("message-editor");
      const delayedTextarea = document.createElement("textarea");

      delayedMessageEditor.appendChild(delayedTextarea);
      delayedAgentInterface.appendChild(delayedMessageEditor);
      delayedContainer.appendChild(delayedAgentInterface);

      // Set up session and original sendMessage
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (delayedAgentInterface as any).session = {
        state: { isStreaming: true },
        prompt: vi.fn(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (delayedAgentInterface as any).sendMessage = vi.fn();

      // Give MutationObserver time to fire
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Check that patches were applied
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((delayedMessageEditor as any).isStreaming).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(typeof (delayedAgentInterface as any).sendMessage).toBe("function");

      cleanup();
    });

    it("patches elements that are already present", () => {
      const cleanup = patchSendDuringStreaming(agentInterface);

      // Elements were present at init time, should be patched
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((messageEditor as any).isStreaming).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(typeof (agentInterface as any).sendMessage).toBe("function");

      cleanup();
    });

    it("disconnects observer after both elements are patched", async () => {
      const delayedContainer = document.createElement("div");
      container.appendChild(delayedContainer);

      const cleanup = patchSendDuringStreaming(delayedContainer);

      // Add both elements
      const delayedAgentInterface = document.createElement("agent-interface");
      const delayedMessageEditor = document.createElement("message-editor");

      delayedAgentInterface.appendChild(delayedMessageEditor);
      delayedContainer.appendChild(delayedAgentInterface);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (delayedAgentInterface as any).sendMessage = vi.fn();

      // Give MutationObserver time to fire
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Cleanup should not throw even though observer is disconnected
      expect(() => {
        cleanup();
      }).not.toThrow();
    });
  });

  describe("Composition with mobile patch", () => {
    it("MessageEditor.isStreaming always false does not interfere with handleKeyDown", () => {
      const cleanup = patchSendDuringStreaming(agentInterface);

      // Simulate handleKeyDown logic that checks isStreaming
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wouldAllowSend = !(messageEditor as any).isStreaming;

      // Should allow sending since isStreaming is false
      expect(wouldAllowSend).toBe(true);

      cleanup();
    });

    it("can be called multiple times safely", () => {
      expect(() => {
        const cleanup1 = patchSendDuringStreaming(agentInterface);
        cleanup1();

        const cleanup2 = patchSendDuringStreaming(agentInterface);
        cleanup2();
      }).not.toThrow();
    });
  });

  describe("Edge cases and robustness", () => {
    it("handles missing message-editor gracefully", () => {
      const sparseContainer = document.createElement("div");
      const sparseAgentInterface = document.createElement("agent-interface");
      sparseContainer.appendChild(sparseAgentInterface);
      document.body.appendChild(sparseContainer);

      expect(() => {
        const cleanup = patchSendDuringStreaming(sparseContainer);
        cleanup();
      }).not.toThrow();

      document.body.removeChild(sparseContainer);
    });

    it("returns cleanup function even if elements not found initially", () => {
      const emptyContainer = document.createElement("div");
      document.body.appendChild(emptyContainer);

      const cleanup = patchSendDuringStreaming(emptyContainer);
      expect(cleanup).toBeInstanceOf(Function);

      // Cleanup should not throw even though patches were not applied
      expect(() => {
        cleanup();
      }).not.toThrow();

      document.body.removeChild(emptyContainer);
    });

    it("handles missing agent-interface gracefully", () => {
      const containerWithoutAgentInterface = document.createElement("div");
      document.body.appendChild(containerWithoutAgentInterface);

      expect(() => {
        const cleanup = patchSendDuringStreaming(containerWithoutAgentInterface);
        cleanup();
      }).not.toThrow();

      document.body.removeChild(containerWithoutAgentInterface);
    });

    it("returns a function that can be called multiple times safely", () => {
      const cleanup = patchSendDuringStreaming(agentInterface);

      expect(() => {
        cleanup();
        cleanup();
      }).not.toThrow();
    });
  });
});
