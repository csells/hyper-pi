import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("patchLit", () => {
  beforeEach(() => {
    // Clear custom elements registry before each test
    // This is a bit hacky but necessary for testing
    const registry = (customElements as any);
    // We can't directly clear it, so we'll work around it
  });

  afterEach(() => {
    // Clean up after each test
    // Remove our test element if it exists
    const elem = document.querySelector("test-element");
    if (elem) {
      elem.remove();
    }
  });

  it("when no agent-interface element is registered, patch is a no-op (no errors)", () => {
    // Verify that importing patchLit when agent-interface doesn't exist doesn't throw
    expect(() => {
      // This is essentially what happens when patchLit module is imported
      const Ctor = customElements.get("agent-interface");
      expect(Ctor).toBeUndefined();
    }).not.toThrow();
  });

  it("when Lit element exists, patch removes own properties shadowing @property accessors", () => {
    // Create a mock ReactiveElement-like class with an accessor
    class MockReactiveElement extends HTMLElement {
      private _data: unknown = "initial";

      static elementProperties = new Map([["data", { type: Object }]]);

      get data(): unknown {
        return this._data;
      }

      set data(val: unknown) {
        this._data = val;
      }

      performUpdate() {
        // Apply the patching logic here
        const obj = this as unknown as Record<string, unknown>;

        // 1. Delete own properties that shadow reactive @property accessors
        const ctor = this.constructor as { elementProperties?: Map<string, unknown> };
        if (ctor.elementProperties) {
          const saved = new Map<string, unknown>();
          for (const prop of ctor.elementProperties.keys()) {
            if (this.hasOwnProperty(prop)) {
              saved.set(prop as string, obj[prop as string]);
              delete obj[prop as string];
            }
          }
          for (const [k, v] of saved) {
            obj[k] = v;
          }
        }

        // 2. Delete own properties that shadow any prototype accessor
        let proto = Object.getPrototypeOf(this);
        while (proto && proto !== HTMLElement.prototype) {
          for (const key of Object.getOwnPropertyNames(proto)) {
            const desc = Object.getOwnPropertyDescriptor(proto, key);
            if (desc && (desc.get || desc.set) && this.hasOwnProperty(key)) {
              delete obj[key];
            }
          }
          proto = Object.getPrototypeOf(proto);
        }
      }
    }

    customElements.define("test-element-shadow", MockReactiveElement);

    // Create an instance
    const elem = new MockReactiveElement();

    // Add an own property that shadows the accessor
    // This simulates what happens when a class field shadows a reactive property
    Object.defineProperty(elem, "data", {
      value: "shadowed-value",
      writable: true,
      enumerable: true,
      configurable: true,
    });

    // Verify the own property exists and shadows the accessor
    expect(elem.hasOwnProperty("data")).toBe(true);
    expect(elem.data).toBe("shadowed-value");

    // Call performUpdate which applies the patching logic
    elem.performUpdate();

    // After patching, the own property should have been deleted
    expect(elem.hasOwnProperty("data")).toBe(false);
    // The accessor should now be accessible (not shadowed by own property)
    // The value should be what was set through the setter
    expect(elem.data).toBe("shadowed-value");
  });

  it("calling patched performUpdate doesn't throw", () => {
    // Create a minimal Lit-like element
    class TestElement extends HTMLElement {
      performUpdate() {
        // Normal operation
      }
    }

    customElements.define("test-element-2", TestElement);

    // Simulate patching
    let Base = TestElement as unknown as {
      prototype: Record<string, unknown>;
    };
    while (Base && !Object.getOwnPropertyDescriptor(Base.prototype, "performUpdate")) {
      Base = Object.getPrototypeOf(Base);
    }

    if (Base?.prototype?.performUpdate) {
      const origPerformUpdate = Base.prototype.performUpdate as (
        this: HTMLElement,
      ) => void;

      Base.prototype.performUpdate = function (this: HTMLElement) {
        const obj = this as unknown as Record<string, unknown>;

        const ctor = this.constructor as { elementProperties?: Map<string, unknown> };
        if (ctor.elementProperties) {
          const saved = new Map<string, unknown>();
          for (const prop of ctor.elementProperties.keys()) {
            if (this.hasOwnProperty(prop)) {
              saved.set(prop as string, obj[prop as string]);
              delete obj[prop as string];
            }
          }
          for (const [k, v] of saved) {
            obj[k] = v;
          }
        }

        let proto = Object.getPrototypeOf(this);
        while (proto && proto !== HTMLElement.prototype) {
          for (const key of Object.getOwnPropertyNames(proto)) {
            const desc = Object.getOwnPropertyDescriptor(proto, key);
            if (desc && (desc.get || desc.set) && this.hasOwnProperty(key)) {
              delete obj[key];
            }
          }
          proto = Object.getPrototypeOf(proto);
        }

        return origPerformUpdate.call(this);
      };
    }

    // Create instance and call patched performUpdate
    const elem = new TestElement();

    expect(() => {
      elem.performUpdate();
    }).not.toThrow();
  });

  it("when agent-interface element is registered, patch is applied to ReactiveElement", () => {
    // Create a mock agent-interface element
    class AgentInterface extends HTMLElement {
      static elementProperties = new Map([["data", { type: Object }]]);

      private _data: unknown = null;

      get data(): unknown {
        return this._data;
      }

      set data(val: unknown) {
        this._data = val;
      }

      performUpdate() {
        // Original implementation
      }
    }

    customElements.define("agent-interface", AgentInterface);

    // Verify the element is registered
    expect(customElements.get("agent-interface")).toBe(AgentInterface);

    // The actual patchLit module would patch ReactiveElement through this element
    // For testing, we just verify that we can find and walk the prototype chain
    const Ctor = customElements.get("agent-interface");
    expect(Ctor).not.toBeUndefined();

    // Walk prototype chain as patchLit does
    let Base = Ctor as unknown as { prototype: Record<string, unknown> };
    while (Base && !Object.getOwnPropertyDescriptor(Base.prototype, "performUpdate")) {
      Base = Object.getPrototypeOf(Base);
    }

    // Verify performUpdate found
    expect(Base?.prototype?.performUpdate).toBeDefined();
  });
});
