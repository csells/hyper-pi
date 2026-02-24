import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { patchSendDuringStreaming } from "./patchSendDuringStreaming";

describe("patchSendDuringStreaming", () => {
  let container: HTMLElement;
  let agentInterfaceEl: HTMLElement;
  let messageEditorEl: HTMLElement;

  beforeEach(() => {
    // Create test DOM structure
    container = document.createElement("div");
    agentInterfaceEl = document.createElement("agent-interface");
    messageEditorEl = document.createElement("message-editor");

    // Mock getAppStorage for sendMessage patch
    (window as any).getAppStorage = () => ({
      providerKeys: {
        get: vi.fn().mockResolvedValue("dummy-key"),
      },
    });

    // Mock session and state on agent-interface
    (agentInterfaceEl as any).session = {
      state: {
        isStreaming: true,
        model: { provider: "anthropic" },
        messages: [],
        tools: new Map(),
        pendingToolCalls: new Set(),
      },
      prompt: vi.fn(),
    };

    // Mock message-editor element
    (messageEditorEl as any).value = "";
    (messageEditorEl as any).attachments = [];
    (messageEditorEl as any).isStreaming = true;

    // Initially, don't add elements to container
    // We'll add them in specific tests to verify MutationObserver discovery
  });

  afterEach(() => {
    if (container && document.body.contains(container)) {
      document.body.removeChild(container);
    }
  });

  describe("AgentInterface.sendMessage patch", () => {
    beforeEach(() => {
      // Add elements to container and DOM
      agentInterfaceEl.appendChild(messageEditorEl);
      container.appendChild(agentInterfaceEl);
      document.body.appendChild(container);

      // Add sendMessage method to agentInterface
      (agentInterfaceEl as any).sendMessage = async function (input: string, attachments?: any[]) {
        // Mock implementation
        if (!input.trim() && attachments?.length === 0) return;
        await this.session?.prompt?.(input);
      };
    });

    it("allows sending when session is streaming", async () => {
      patchSendDuringStreaming(agentInterfaceEl);

      const sendPromise = (agentInterfaceEl as any).sendMessage.call(
        agentInterfaceEl,
        "test message"
      );

      // Should not throw or return early
      await expect(sendPromise).resolves.toBeUndefined();

      // session.prompt should have been called
      expect((agentInterfaceEl as any).session.prompt).toHaveBeenCalledWith("test message");
    });

    it("still blocks empty messages during streaming", async () => {
      patchSendDuringStreaming(agentInterfaceEl);

      const promptSpy = vi.spyOn((agentInterfaceEl as any).session, "prompt");

      await (agentInterfaceEl as any).sendMessage.call(agentInterfaceEl, "");

      // Empty message should not call prompt
      expect(promptSpy).not.toHaveBeenCalled();
    });

    it("allows sending when session is not streaming", async () => {
      (agentInterfaceEl as any).session.state.isStreaming = false;

      patchSendDuringStreaming(agentInterfaceEl);

      const sendPromise = (agentInterfaceEl as any).sendMessage.call(
        agentInterfaceEl,
        "test message"
      );

      await expect(sendPromise).resolves.toBeUndefined();

      expect((agentInterfaceEl as any).session.prompt).toHaveBeenCalledWith("test message");
    });

    it("clears editor after sending", async () => {
      (messageEditorEl as any).value = "typed text";
      (messageEditorEl as any).attachments = [];

      patchSendDuringStreaming(agentInterfaceEl);

      await (agentInterfaceEl as any).sendMessage.call(
        agentInterfaceEl,
        "test message"
      );

      expect((messageEditorEl as any).value).toBe("");
    });
  });

  describe("MessageEditor.isStreaming patch", () => {
    beforeEach(() => {
      agentInterfaceEl.appendChild(messageEditorEl);
      container.appendChild(agentInterfaceEl);
      document.body.appendChild(container);
    });

    it("makes isStreaming always return false", () => {
      // Initially isStreaming is true
      expect((messageEditorEl as any).isStreaming).toBe(true);

      patchSendDuringStreaming(agentInterfaceEl);

      // After patch, should always be false
      expect((messageEditorEl as any).isStreaming).toBe(false);

      // Even if we try to set it
      (messageEditorEl as any).isStreaming = true;
      expect((messageEditorEl as any).isStreaming).toBe(false);
    });

    it("ignores attempts to set isStreaming", () => {
      patchSendDuringStreaming(agentInterfaceEl);

      // Try to set to true
      (messageEditorEl as any).isStreaming = true;
      expect((messageEditorEl as any).isStreaming).toBe(false);

      // Try to set to false (should still be false)
      (messageEditorEl as any).isStreaming = false;
      expect((messageEditorEl as any).isStreaming).toBe(false);
    });
  });

  describe("Cleanup function", () => {
    beforeEach(() => {
      agentInterfaceEl.appendChild(messageEditorEl);
      container.appendChild(agentInterfaceEl);
      document.body.appendChild(container);

      (agentInterfaceEl as any).sendMessage = async function (input: string) {
        if (!input.trim()) return;
        await this.session?.prompt?.(input);
      };
    });

    it("restores original sendMessage", async () => {
      const originalSendMessage = (agentInterfaceEl as any).sendMessage;

      const cleanup = patchSendDuringStreaming(agentInterfaceEl);

      // Patch should replace the method
      expect((agentInterfaceEl as any).sendMessage).not.toBe(originalSendMessage);

      // After cleanup, should restore original
      cleanup();
      expect((agentInterfaceEl as any).sendMessage).toBe(originalSendMessage);
    });

    it("restores original isStreaming property", () => {
      (messageEditorEl as any).isStreaming = true;
      const descriptor = Object.getOwnPropertyDescriptor(messageEditorEl, "isStreaming");

      const cleanup = patchSendDuringStreaming(agentInterfaceEl);

      // Patch should change the property
      expect(Object.getOwnPropertyDescriptor(messageEditorEl, "isStreaming")).not.toEqual(descriptor);

      // After cleanup, should restore
      cleanup();

      // The restored property should be settable again
      const restoredDescriptor = Object.getOwnPropertyDescriptor(messageEditorEl, "isStreaming");
      expect(restoredDescriptor?.writable || restoredDescriptor?.set).toBeTruthy();
    });

    it("can be called multiple times safely", () => {
      const cleanup = patchSendDuringStreaming(agentInterfaceEl);

      expect(() => {
        cleanup();
        cleanup();
      }).not.toThrow();
    });
  });

  describe("MutationObserver discovery", () => {
    it("finds agent-interface added after patch setup", async () => {
      const delayedContainer = document.createElement("div");
      document.body.appendChild(delayedContainer);

      const cleanup = patchSendDuringStreaming(delayedContainer);

      // Add agent-interface after observer is set up
      const delayedAgentInterface = document.createElement("agent-interface");
      const delayedMessageEditor = document.createElement("message-editor");
      delayedAgentInterface.appendChild(delayedMessageEditor);

      (delayedAgentInterface as any).sendMessage = async function (input: string) {
        if (!input.trim()) return;
        await this.session?.prompt?.(input);
      };

      (delayedAgentInterface as any).session = {
        state: { isStreaming: true, model: { provider: "anthropic" } },
        prompt: vi.fn(),
      };

      (delayedMessageEditor as any).isStreaming = true;
      (delayedMessageEditor as any).value = "";
      (delayedMessageEditor as any).attachments = [];

      delayedContainer.appendChild(delayedAgentInterface);

      // Give MutationObserver time to fire
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should have patched the element
      expect((delayedAgentInterface as any).sendMessage).toBeDefined();
      expect((delayedMessageEditor as any).isStreaming).toBe(false);

      cleanup();
      document.body.removeChild(delayedContainer);
    });

    it("finds message-editor already in DOM", async () => {
      agentInterfaceEl.appendChild(messageEditorEl);
      container.appendChild(agentInterfaceEl);
      document.body.appendChild(container);

      const cleanup = patchSendDuringStreaming(agentInterfaceEl);

      // Give observer time to find elements
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should have patched message-editor
      expect((messageEditorEl as any).isStreaming).toBe(false);

      cleanup();
    });
  });

  describe("Composition with patchMobileKeyboard", () => {
    it("does not interfere with existing mobile patch behavior", async () => {
      agentInterfaceEl.appendChild(messageEditorEl);
      container.appendChild(agentInterfaceEl);
      document.body.appendChild(container);

      patchSendDuringStreaming(agentInterfaceEl);

      // isStreaming should be false for send button display
      expect((messageEditorEl as any).isStreaming).toBe(false);

      // This allows patchMobileKeyboard's capturing phase listener
      // to work correctly (fires before MessageEditor's @keydown handler)
    });
  });

  describe("Error handling", () => {
    it("handles missing getAppStorage gracefully", async () => {
      // Remove the mock
      (window as any).getAppStorage = undefined;

      agentInterfaceEl.appendChild(messageEditorEl);
      container.appendChild(agentInterfaceEl);
      document.body.appendChild(container);

      (agentInterfaceEl as any).sendMessage = async function (input: string) {
        if (!input.trim()) return;
        console.error("No API key configured");
      };

      (agentInterfaceEl as any).session = {
        state: { isStreaming: true, model: { provider: "anthropic" } },
        prompt: vi.fn(),
      };

      const cleanup = patchSendDuringStreaming(agentInterfaceEl);

      // Should not throw
      await expect(
        (agentInterfaceEl as any).sendMessage.call(agentInterfaceEl, "test")
      ).resolves.toBeUndefined();

      cleanup();
    });

    it("handles missing session gracefully", async () => {
      agentInterfaceEl.appendChild(messageEditorEl);
      container.appendChild(agentInterfaceEl);
      document.body.appendChild(container);

      (agentInterfaceEl as any).sendMessage = async function (input: string) {
        if (!input.trim()) return;
        throw new Error("No session set");
      };

      (agentInterfaceEl as any).session = null;

      const cleanup = patchSendDuringStreaming(agentInterfaceEl);

      // Should throw (expected behavior)
      await expect(
        (agentInterfaceEl as any).sendMessage.call(agentInterfaceEl, "test")
      ).rejects.toThrow("No session set");

      cleanup();
    });
  });
});
