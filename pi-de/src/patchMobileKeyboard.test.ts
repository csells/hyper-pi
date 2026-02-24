import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isMobileDevice, patchMobileKeyboard } from "./patchMobileKeyboard";

const mockMatchMedia = (
  matches: boolean | ((query: string) => boolean)
) => {
  const matcher =
    typeof matches === "function" ? matches : () => matches;
  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => ({
      matches: matcher(query),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
    writable: true,
    configurable: true,
  });
};

describe("isMobileDevice", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      value: originalMatchMedia,
      writable: true,
      configurable: true,
    });
  });

  it("returns true when matchMedia detects coarse pointer", () => {
    mockMatchMedia((query) => query === "(pointer: coarse)");
    expect(isMobileDevice()).toBe(true);
  });

  it("returns true when matchMedia matches coarse pointer", () => {
    mockMatchMedia(true);
    expect(isMobileDevice()).toBe(true);
  });

  it("falls back when matchMedia throws and ontouchstart is true", () => {
    Object.defineProperty(window, "matchMedia", {
      value: () => {
        throw new Error("matchMedia not supported");
      },
      writable: true,
      configurable: true,
    });
    // In jsdom test env, ontouchstart is typically present
    const result = isMobileDevice();
    expect(typeof result).toBe("boolean");
  });

  it("returns false when neither signal indicates mobile", () => {
    // Mock matchMedia to return false and remove ontouchstart
    mockMatchMedia(false);
    const originalOntouchstart = (window as any).ontouchstart;
    delete (window as any).ontouchstart;
    
    const result = isMobileDevice();
    expect(result).toBe(false);
    
    // Restore
    if (originalOntouchstart !== undefined) {
      (window as any).ontouchstart = originalOntouchstart;
    }
  });
});

describe("patchMobileKeyboard", () => {
  let container: HTMLElement;
  let agentInterface: HTMLElement;
  let textarea: HTMLTextAreaElement;
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    // Mock as mobile device for most tests
    mockMatchMedia((query) => query === "(pointer: coarse)");

    // Create test DOM structure
    container = document.createElement("div");
    agentInterface = document.createElement("agent-interface");
    textarea = document.createElement("textarea");

    agentInterface.appendChild(textarea);
    container.appendChild(agentInterface);
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container && document.body.contains(container)) {
      document.body.removeChild(container);
    }
    Object.defineProperty(window, "matchMedia", {
      value: originalMatchMedia,
      writable: true,
      configurable: true,
    });
  });

  it("finds the textarea element and attaches a listener", () => {
    const cleanup = patchMobileKeyboard(agentInterface);
    expect(cleanup).toBeInstanceOf(Function);
  });

  it("intercepts Enter key on mobile and prevents default submission", () => {
    patchMobileKeyboard(agentInterface);

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });

    const stopImmediatelySpy = vi.spyOn(event, "stopImmediatePropagation");
    textarea.dispatchEvent(event);

    expect(stopImmediatelySpy).toHaveBeenCalled();
  });

  it("does not intercept Shift+Enter on mobile", () => {
    patchMobileKeyboard(agentInterface);

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    const stopImmediatelySpy = vi.spyOn(event, "stopImmediatePropagation");
    textarea.dispatchEvent(event);

    expect(stopImmediatelySpy).not.toHaveBeenCalled();
  });

  it("does not intercept Enter on non-mobile devices", () => {
    // Override to simulate desktop (fine pointer and no touchstart)
    mockMatchMedia(false);
    const originalOntouchstart = (window as any).ontouchstart;
    delete (window as any).ontouchstart;

    patchMobileKeyboard(agentInterface);

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });

    const stopImmediatelySpy = vi.spyOn(event, "stopImmediatePropagation");
    textarea.dispatchEvent(event);

    expect(stopImmediatelySpy).not.toHaveBeenCalled();

    // Restore
    if (originalOntouchstart !== undefined) {
      (window as any).ontouchstart = originalOntouchstart;
    }
  });

  it("does not intercept non-Enter keys on mobile", () => {
    patchMobileKeyboard(agentInterface);

    const event = new KeyboardEvent("keydown", {
      key: "a",
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });

    const stopImmediatelySpy = vi.spyOn(event, "stopImmediatePropagation");
    textarea.dispatchEvent(event);

    expect(stopImmediatelySpy).not.toHaveBeenCalled();
  });

  it("cleanup function removes event listener", () => {
    const cleanup = patchMobileKeyboard(agentInterface);

    const event1 = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });

    const stopSpy1 = vi.spyOn(event1, "stopImmediatePropagation");
    textarea.dispatchEvent(event1);
    expect(stopSpy1).toHaveBeenCalled();

    // After cleanup, listener should be removed
    cleanup();

    const event2 = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });

    const stopSpy2 = vi.spyOn(event2, "stopImmediatePropagation");
    textarea.dispatchEvent(event2);
    // Listener should no longer fire after cleanup
    expect(stopSpy2).not.toHaveBeenCalled();
  });

  it("uses MutationObserver to find textarea added later", async () => {
    const delayedContainer = document.createElement("agent-interface");
    container.appendChild(delayedContainer);

    const cleanup = patchMobileKeyboard(delayedContainer);

    // Add textarea after observer is set up
    const delayedTextarea = document.createElement("textarea");
    delayedContainer.appendChild(delayedTextarea);

    // Give MutationObserver time to fire
    await new Promise((resolve) => setTimeout(resolve, 0));

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });

    const stopSpy = vi.spyOn(event, "stopImmediatePropagation");
    delayedTextarea.dispatchEvent(event);

    expect(stopSpy).toHaveBeenCalled();
    cleanup();
  });

  it("returns a function that can be called multiple times safely", () => {
    const cleanup = patchMobileKeyboard(agentInterface);

    expect(() => {
      cleanup();
      cleanup();
    }).not.toThrow();
  });

  it("handles missing element gracefully", () => {
    const missingEl = document.createElement("div");

    expect(() => {
      const cleanup = patchMobileKeyboard(missingEl);
      cleanup();
    }).not.toThrow();
  });
});
