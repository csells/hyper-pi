/**
 * Mobile virtual keyboard patch: intercepts Enter key to insert newlines
 * instead of submitting the prompt on touch devices.
 *
 * On mobile (coarse pointer), pressing Enter in the textarea inserts a newline.
 * On desktop, Enter submits (existing behavior). Shift+Enter always inserts a newline.
 * The Send button handles submission on mobile.
 */

/**
 * Detect if device has coarse pointer (touch) or fallback to ontouchstart.
 * Primary signal: `window.matchMedia("(pointer: coarse)").matches`
 * Fallback: `"ontouchstart" in window`
 */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;

  try {
    // Primary check: coarse pointer media query (targets touch devices)
    if (window.matchMedia("(pointer: coarse)").matches) {
      return true;
    }
  } catch {
    // matchMedia not supported, proceed to fallback
  }

  // Fallback: check for touchstart event support
  return "ontouchstart" in window;
}

/**
 * Patches the <agent-interface> element to intercept mobile keyboard Enter.
 *
 * Uses MutationObserver to find the textarea element (which renders in light DOM)
 * and registers a capturing keydown listener. When Enter is pressed on mobile
 * without Shift, stopImmediatePropagation is called to prevent MessageEditor's
 * @keydown handler from firing, allowing the default textarea behavior (newline).
 *
 * Returns a cleanup function that removes the listener and disconnects the observer.
 */
export function patchMobileKeyboard(el: HTMLElement): () => void {
  let textarea: HTMLTextAreaElement | null = null;
  let observer: MutationObserver | null = null;
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  /**
   * Handles keydown on the textarea. If on mobile and Enter is pressed
   * without Shift, prevent submission by calling stopImmediatePropagation.
   */
  const handleKeydown = (e: KeyboardEvent) => {
    if (isMobileDevice() && e.key === "Enter" && !e.shiftKey) {
      // Stop MessageEditor's @keydown handler from executing.
      // Our capturing listener fires before Lit's event binding.
      e.stopImmediatePropagation();
      // Default textarea behavior (insert newline) proceeds.
    }
  };

  /**
   * Set up the capturing keydown listener once we have the textarea.
   */
  const attachListener = () => {
    if (!textarea || keydownHandler) {
      return; // Already attached or no textarea yet
    }
    keydownHandler = handleKeydown;
    // Use capturing phase to intercept before Lit's event binding
    textarea.addEventListener("keydown", keydownHandler, { capture: true });
  };

  /**
   * MutationObserver watches for the textarea to appear in the light DOM.
   */
  const observeTextarea = () => {
    observer = new MutationObserver(() => {
      if (!textarea) {
        // Search for textarea in el's subtree
        textarea = el.querySelector("textarea");
        if (textarea) {
          attachListener();
          // Observer can be disconnected after we find the textarea
          // since it won't be removed/re-added
          observer?.disconnect();
        }
      }
    });

    // Watch el and its descendants for changes
    observer.observe(el, {
      childList: true,
      subtree: true,
    });

    // In case textarea already exists, search for it now
    textarea = el.querySelector("textarea");
    if (textarea) {
      attachListener();
      observer.disconnect();
    }
  };

  // Start observing for the textarea
  observeTextarea();

  /**
   * Cleanup: remove listener and disconnect observer.
   */
  return () => {
    if (textarea && keydownHandler) {
      textarea.removeEventListener("keydown", keydownHandler, { capture: true });
    }
    if (observer) {
      observer.disconnect();
    }
  };
}
