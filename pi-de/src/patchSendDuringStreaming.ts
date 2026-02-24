/**
 * Patch for sending messages during streaming and showing send button during streaming.
 *
 * This patch addresses two gates that prevent user interaction during streaming:
 * 1. AgentInterface.sendMessage() blocks on isStreaming
 * 2. MessageEditor.isStreaming property controls button display and Enter key handling
 *
 * Solution:
 * - Override sendMessage to remove the isStreaming gate (but keep empty message block)
 * - Override MessageEditor.isStreaming to always return false
 *
 * Composition with patchMobileKeyboard:
 * - patchMobileKeyboard intercepts Enter on mobile at capturing phase
 * - MessageEditor with isStreaming=false will allow Enter-to-send on desktop
 * - Mobile still gets newline (patchMobileKeyboard fires first with stopImmediatePropagation)
 */

/**
 * Patches AgentInterface.sendMessage() to remove the isStreaming gate,
 * and MessageEditor.isStreaming to always return false.
 *
 * Uses MutationObserver to find elements in light DOM (same pattern as patchMobileKeyboard.ts).
 * Returns a cleanup function.
 */
export function patchSendDuringStreaming(el: HTMLElement): () => void {
  let agentInterface: HTMLElement & {
    sendMessage?: (input: string, attachments?: any[]) => Promise<void>;
  } | null = null;
  let messageEditor: HTMLElement & {
    isStreaming?: boolean | null;
  } | null = null;

  let agentInterfaceObserver: MutationObserver | null = null;
  let messageEditorObserver: MutationObserver | null = null;

  let originalSendMessage: ((input: string, attachments?: any[]) => Promise<void>) | null = null;
  let isStreamingDescriptor: PropertyDescriptor | null = null;

  /**
   * Patch AgentInterface.sendMessage to remove the isStreaming gate.
   * Keeps the empty message block and other validation.
   */
  const patchAgentInterface = () => {
    if (!agentInterface || !agentInterface.sendMessage) {
      return;
    }

    // Store original if not already stored
    if (!originalSendMessage) {
      originalSendMessage = agentInterface.sendMessage.bind(agentInterface);

      // Define patched version
      const patchedSendMessage = async function (
        this: any,
        input: string,
        attachments?: any[]
      ) {
        // Keep empty message block, but remove isStreaming gate
        if (!input.trim() && attachments?.length === 0) return;

        const session = this.session;
        if (!session) throw new Error("No session set on AgentInterface");
        if (!session.state.model) throw new Error("No model set on AgentInterface");

        // Check if API key exists for the provider
        const provider = session.state.model.provider;
        const apiKey = await (window as any).getAppStorage?.().providerKeys.get?.(provider);

        // If no API key, prompt for it
        if (!apiKey) {
          if (!this.onApiKeyRequired) {
            console.error("No API key configured and no onApiKeyRequired handler set");
            return;
          }

          const success = await this.onApiKeyRequired(provider);

          // If still no API key, abort the send
          if (!success) {
            return;
          }
        }

        // Call onBeforeSend hook before sending
        if (this.onBeforeSend) {
          await this.onBeforeSend();
        }

        // Clear editor (check both _messageEditor and messageEditor property)
        const messageEditor = this._messageEditor || (this as any).messageEditor || this.querySelector?.("message-editor");
        if (messageEditor) {
          messageEditor.value = "";
          messageEditor.attachments = [];
        }

        // Re-enable auto-scroll if available
        if (this._autoScroll !== undefined) {
          this._autoScroll = true;
        }

        // Send message
        if (attachments && attachments.length > 0) {
          await session.prompt({
            role: "user-with-attachments",
            content: input,
            attachments,
            timestamp: Date.now(),
          });
        } else {
          await session.prompt(input);
        }
      };

      // Replace the method
      agentInterface.sendMessage = patchedSendMessage;
    }
  };

  /**
   * Patch MessageEditor.isStreaming property to always return false.
   * This makes it always show the send button and allow Enter-to-send.
   */
  const patchMessageEditor = () => {
    if (!messageEditor) {
      return;
    }

    // Store original descriptor if not already stored
    if (!isStreamingDescriptor) {
      isStreamingDescriptor = Object.getOwnPropertyDescriptor(messageEditor, "isStreaming") || {
        value: messageEditor.isStreaming,
        writable: true,
        enumerable: true,
        configurable: true,
      };

      // Define patched property that always returns false
      Object.defineProperty(messageEditor, "isStreaming", {
        get() {
          return false;
        },
        set() {
          // No-op: ignore attempts to set
        },
        enumerable: true,
        configurable: true,
      });
    }
  };

  /**
   * Set up observer for <agent-interface> element.
   */
  const observeAgentInterface = () => {
    agentInterfaceObserver = new MutationObserver(() => {
      if (!agentInterface) {
        // Search for agent-interface in el's subtree
        agentInterface = el.querySelector("agent-interface") as any;
        if (agentInterface) {
          patchAgentInterface();
          agentInterfaceObserver?.disconnect();
        }
      }
    });

    // Watch el and its descendants for changes
    agentInterfaceObserver.observe(el, {
      childList: true,
      subtree: true,
    });

    // In case agent-interface already exists, patch it now
    agentInterface = el.querySelector("agent-interface") as any;
    if (agentInterface) {
      patchAgentInterface();
      agentInterfaceObserver.disconnect();
    }
  };

  /**
   * Set up observer for <message-editor> element.
   */
  const observeMessageEditor = () => {
    messageEditorObserver = new MutationObserver(() => {
      if (!messageEditor) {
        // Search for message-editor in el's subtree
        messageEditor = el.querySelector("message-editor") as any;
        if (messageEditor) {
          patchMessageEditor();
          messageEditorObserver?.disconnect();
        }
      }
    });

    // Watch el and its descendants for changes
    messageEditorObserver.observe(el, {
      childList: true,
      subtree: true,
    });

    // In case message-editor already exists, patch it now
    messageEditor = el.querySelector("message-editor") as any;
    if (messageEditor) {
      patchMessageEditor();
      messageEditorObserver.disconnect();
    }
  };

  // Start observing for both elements
  observeAgentInterface();
  observeMessageEditor();

  /**
   * Cleanup: restore original implementations and disconnect observers.
   */
  return () => {
    // Restore AgentInterface.sendMessage
    if (agentInterface && originalSendMessage) {
      agentInterface.sendMessage = originalSendMessage;
    }

    // Restore MessageEditor.isStreaming property
    if (messageEditor && isStreamingDescriptor) {
      Object.defineProperty(messageEditor, "isStreaming", isStreamingDescriptor);
    }

    // Disconnect observers
    if (agentInterfaceObserver) {
      agentInterfaceObserver.disconnect();
    }

    if (messageEditorObserver) {
      messageEditorObserver.disconnect();
    }
  };
}
