/**
 * Patch for send-during-streaming: allows users to send messages while
 * the agent is streaming (isStreaming = true).
 *
 * Two overrides:
 * 1. AgentInterface.sendMessage() — remove the isStreaming gate so prompt()
 *    is called even during streaming. pi-socket handles follow-ups via
 *    `pi.sendUserMessage(text, { deliverAs: "followUp" })`.
 * 2. MessageEditor.isStreaming property — dynamically returns:
 *    - true (show stop button) when agent is streaming AND input is empty
 *    - false (show send button) when input has text
 *    This gives mobile users a stop button when idle and a send button
 *    when they've typed something, all in the same button location.
 *
 * Uses MutationObserver to find elements in light DOM, same pattern as
 * patchMobileKeyboard.ts. Returns a cleanup function.
 */

/**
 * Patches the <agent-interface> element subtree to allow sending messages
 * while the agent is streaming. Call with the agent-interface element or
 * a parent container.
 *
 * Returns a cleanup function that restores original behavior.
 */
export function patchSendDuringStreaming(el: HTMLElement): () => void {
  let observer: MutationObserver | null = null;
  let patchedAgentInterface: HTMLElement | null = null;
  let patchedMessageEditor: HTMLElement | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let originalSendMessage: ((...args: any[]) => any) | null = null;
  let originalIsStreamingDescriptor: PropertyDescriptor | undefined;

  // Track the real streaming state from Lit property updates
  let realIsStreaming = false;

  const patchElements = () => {
    // Find agent-interface (el itself or a descendant)
    const ai = el.tagName === "AGENT-INTERFACE"
      ? el
      : el.querySelector("agent-interface");
    if (!ai || patchedAgentInterface) return;

    // Find message-editor inside agent-interface
    const me = ai.querySelector("message-editor");

    // ── Patch AgentInterface.sendMessage ──
    // The original gates on `this.session?.state.isStreaming`. We replace it
    // with a version that skips that check but preserves everything else.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aiAny = ai as any;
    if (typeof aiAny.sendMessage === "function") {
      originalSendMessage = aiAny.sendMessage.bind(ai);
      aiAny.sendMessage = async function (input?: string, attachments?: unknown[]) {
        // If called from MessageEditor's onSend callback, input is provided.
        if (input !== undefined && !input.trim() && (!attachments || attachments.length === 0)) {
          return;
        }

        const session = aiAny.session;
        if (!session) return;

        // Resolve the text to send
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const editor = ai.querySelector("message-editor") as any;
        const text: string = input ?? (editor?.value as string) ?? "";
        if (!text.trim()) return;

        // Clear editor
        if (editor) {
          editor.value = "";
          editor.attachments = [];
        }

        // Call prompt — RemoteAgent.prompt sends over WebSocket
        await session.prompt(text);
      };
      patchedAgentInterface = ai as HTMLElement;
    }

    // ── Patch MessageEditor.isStreaming ──
    // Override so it dynamically decides which button to show:
    // - Agent streaming + empty input → isStreaming=true → stop button
    // - Agent streaming + text in input → isStreaming=false → send button
    // - Agent idle → isStreaming=false → send button
    if (me) {
      // Walk prototype chain to find existing descriptor
      let proto: object | null = me;
      while (proto && !originalIsStreamingDescriptor) {
        originalIsStreamingDescriptor = Object.getOwnPropertyDescriptor(proto, "isStreaming");
        if (!originalIsStreamingDescriptor) {
          proto = Object.getPrototypeOf(proto);
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meAny = me as any;

      Object.defineProperty(me, "isStreaming", {
        get: () => {
          if (!realIsStreaming) return false;
          // When streaming: show stop button only if input is empty
          const value: string = meAny.value ?? "";
          return !value.trim();
        },
        set: (v: boolean) => {
          // Capture the real value from Lit's property system
          realIsStreaming = v;
          // Trigger a re-render so the button updates
          meAny.requestUpdate?.();
        },
        configurable: true,
      });
      patchedMessageEditor = me as HTMLElement;
    }

    // Both patched — stop observing
    if (patchedAgentInterface && patchedMessageEditor && observer) {
      observer.disconnect();
      observer = null;
    }
  };

  // Try immediately, then watch for DOM changes
  patchElements();
  if (!patchedAgentInterface || !patchedMessageEditor) {
    observer = new MutationObserver(patchElements);
    observer.observe(el, { childList: true, subtree: true });
  }

  // Cleanup
  return () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    // Restore AgentInterface.sendMessage
    if (patchedAgentInterface && originalSendMessage) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patchedAgentInterface as any).sendMessage = originalSendMessage;
    }
    // Restore MessageEditor.isStreaming
    if (patchedMessageEditor) {
      if (originalIsStreamingDescriptor) {
        Object.defineProperty(patchedMessageEditor, "isStreaming", originalIsStreamingDescriptor);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (patchedMessageEditor as any).isStreaming;
      }
    }
  };
}
