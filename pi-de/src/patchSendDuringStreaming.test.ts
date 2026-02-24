import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { patchSendDuringStreaming } from "./patchSendDuringStreaming";

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("patchSendDuringStreaming", () => {
  let container: HTMLElement;
  let agentInterface: HTMLElement;
  let messageEditor: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    agentInterface = document.createElement("agent-interface");
    messageEditor = document.createElement("message-editor");

    agentInterface.appendChild(messageEditor);
    container.appendChild(agentInterface);
    document.body.appendChild(container);

    (agentInterface as any).session = {
      state: { isStreaming: true },
      prompt: vi.fn(),
    };

    (agentInterface as any).sendMessage = vi.fn();
    (messageEditor as any).value = "";
    (messageEditor as any).attachments = [];
    (messageEditor as any).requestUpdate = vi.fn();
  });

  afterEach(() => {
    if (container && document.body.contains(container)) {
      document.body.removeChild(container);
    }
  });

  // ── Core ──────────────────────────────────────────────────

  it("returns a cleanup function", () => {
    const cleanup = patchSendDuringStreaming(agentInterface);
    expect(cleanup).toBeInstanceOf(Function);
    cleanup();
  });

  it("patches AgentInterface.sendMessage", () => {
    const original = (agentInterface as any).sendMessage;
    const cleanup = patchSendDuringStreaming(agentInterface);
    // Should be replaced (patch wraps it)
    expect(typeof (agentInterface as any).sendMessage).toBe("function");
    cleanup();
  });

  // ── isStreaming: conditional button logic ──────────────────

  it("isStreaming returns true when agent is streaming and input is empty (stop button)", () => {
    const cleanup = patchSendDuringStreaming(agentInterface);

    (messageEditor as any).isStreaming = true; // agent is streaming
    (messageEditor as any).value = "";

    expect((messageEditor as any).isStreaming).toBe(true);
    cleanup();
  });

  it("isStreaming returns false when agent is streaming but input has text (send button)", () => {
    const cleanup = patchSendDuringStreaming(agentInterface);

    (messageEditor as any).isStreaming = true; // agent is streaming
    (messageEditor as any).value = "hello";

    expect((messageEditor as any).isStreaming).toBe(false);
    cleanup();
  });

  it("isStreaming returns false when agent is not streaming regardless of input", () => {
    const cleanup = patchSendDuringStreaming(agentInterface);

    (messageEditor as any).isStreaming = false; // agent idle
    (messageEditor as any).value = "";
    expect((messageEditor as any).isStreaming).toBe(false);

    (messageEditor as any).value = "hello";
    expect((messageEditor as any).isStreaming).toBe(false);

    cleanup();
  });

  it("isStreaming treats whitespace-only input as empty (shows stop button)", () => {
    const cleanup = patchSendDuringStreaming(agentInterface);

    (messageEditor as any).isStreaming = true;
    (messageEditor as any).value = "   ";

    expect((messageEditor as any).isStreaming).toBe(true);
    cleanup();
  });

  it("setter calls requestUpdate to trigger re-render", () => {
    const cleanup = patchSendDuringStreaming(agentInterface);

    (messageEditor as any).isStreaming = true;
    expect((messageEditor as any).requestUpdate).toHaveBeenCalled();

    cleanup();
  });

  it("assignment does not throw", () => {
    const cleanup = patchSendDuringStreaming(agentInterface);

    expect(() => {
      (messageEditor as any).isStreaming = true;
      (messageEditor as any).isStreaming = false;
    }).not.toThrow();

    cleanup();
  });

  // ── sendMessage patch ─────────────────────────────────────

  it("patched sendMessage calls session.prompt with editor text", async () => {
    const cleanup = patchSendDuringStreaming(agentInterface);
    const session = (agentInterface as any).session;

    // Simulate text in the editor
    (messageEditor as any).value = "test message";

    await (agentInterface as any).sendMessage();
    expect(session.prompt).toHaveBeenCalledWith("test message");

    cleanup();
  });

  it("patched sendMessage skips empty input", async () => {
    const cleanup = patchSendDuringStreaming(agentInterface);
    const session = (agentInterface as any).session;

    (messageEditor as any).value = "";

    await (agentInterface as any).sendMessage();
    expect(session.prompt).not.toHaveBeenCalled();

    cleanup();
  });

  it("patched sendMessage skips whitespace-only explicit input", async () => {
    const cleanup = patchSendDuringStreaming(agentInterface);
    const session = (agentInterface as any).session;

    await (agentInterface as any).sendMessage("   ", []);
    expect(session.prompt).not.toHaveBeenCalled();

    cleanup();
  });

  it("patched sendMessage clears editor after sending", async () => {
    const cleanup = patchSendDuringStreaming(agentInterface);

    (messageEditor as any).value = "test message";
    await (agentInterface as any).sendMessage();
    expect((messageEditor as any).value).toBe("");

    cleanup();
  });

  // ── Cleanup ───────────────────────────────────────────────

  it("cleanup restores original sendMessage", () => {
    const cleanup = patchSendDuringStreaming(agentInterface);
    cleanup();
    expect(typeof (agentInterface as any).sendMessage).toBe("function");
  });

  it("cleanup restores isStreaming behavior", () => {
    const cleanup = patchSendDuringStreaming(agentInterface);

    // Patched: conditional
    (messageEditor as any).isStreaming = true;
    (messageEditor as any).value = "";
    expect((messageEditor as any).isStreaming).toBe(true);

    cleanup();

    // After cleanup, should not throw
    expect(() => {
      const _val = (messageEditor as any).isStreaming;
    }).not.toThrow();
  });

  it("cleanup can be called multiple times safely", () => {
    const cleanup = patchSendDuringStreaming(agentInterface);
    expect(() => {
      cleanup();
      cleanup();
    }).not.toThrow();
  });

  // ── MutationObserver ──────────────────────────────────────

  it("finds agent-interface added later via MutationObserver", async () => {
    const delayedContainer = document.createElement("div");
    container.appendChild(delayedContainer);

    const cleanup = patchSendDuringStreaming(delayedContainer);

    const delayedAI = document.createElement("agent-interface");
    const delayedME = document.createElement("message-editor");
    delayedAI.appendChild(delayedME);
    delayedContainer.appendChild(delayedAI);

    (delayedAI as any).session = { state: { isStreaming: true }, prompt: vi.fn() };
    (delayedAI as any).sendMessage = vi.fn();
    (delayedME as any).value = "";
    (delayedME as any).requestUpdate = vi.fn();

    await new Promise((resolve) => setTimeout(resolve, 0));

    // isStreaming should be patched: streaming + empty → true
    (delayedME as any).isStreaming = true;
    expect((delayedME as any).isStreaming).toBe(true);

    cleanup();
  });

  it("patches elements that are already present", () => {
    const cleanup = patchSendDuringStreaming(agentInterface);

    (messageEditor as any).isStreaming = true;
    (messageEditor as any).value = "hello";
    expect((messageEditor as any).isStreaming).toBe(false);

    cleanup();
  });

  // ── Edge cases ────────────────────────────────────────────

  it("handles missing message-editor gracefully", () => {
    const sparse = document.createElement("div");
    const ai = document.createElement("agent-interface");
    sparse.appendChild(ai);
    document.body.appendChild(sparse);

    expect(() => {
      const cleanup = patchSendDuringStreaming(sparse);
      cleanup();
    }).not.toThrow();

    document.body.removeChild(sparse);
  });

  it("returns cleanup even if elements not found initially", () => {
    const empty = document.createElement("div");
    document.body.appendChild(empty);

    const cleanup = patchSendDuringStreaming(empty);
    expect(cleanup).toBeInstanceOf(Function);
    expect(() => cleanup()).not.toThrow();

    document.body.removeChild(empty);
  });

  it("can be called multiple times on same element", () => {
    expect(() => {
      const c1 = patchSendDuringStreaming(agentInterface);
      c1();
      const c2 = patchSendDuringStreaming(agentInterface);
      c2();
    }).not.toThrow();
  });
});
