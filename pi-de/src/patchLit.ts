/**
 * Patch Lit's ReactiveElement.performUpdate to handle class-field-shadowing.
 *
 * pi-web-ui uses native ES2022 class field declarations which overwrite
 * Lit's reactive prototype accessors. Lit dev mode throws in performUpdate.
 *
 * This module patches the ReactiveElement prototype WITHOUT importing
 * @lit/reactive-element (which would cause duplicate module instances and
 * the "Multiple versions of Lit loaded" warning). Instead, it discovers
 * ReactiveElement by walking the prototype chain of a known Lit element.
 *
 * MUST be imported AFTER pi-web-ui (so elements are registered) but the
 * patch takes effect before any element's first performUpdate (which runs
 * in a microtask after connectedCallback).
 */

// Find ReactiveElement from a registered pi-web-ui element
const Ctor = customElements.get("agent-interface");
if (Ctor) {
  // Walk up: AgentInterface → LitElement → ReactiveElement → HTMLElement
  let Base = Ctor as unknown as { prototype: Record<string, unknown> };
  while (Base && !Object.getOwnPropertyDescriptor(Base.prototype, "performUpdate")) {
    Base = Object.getPrototypeOf(Base);
  }

  if (Base?.prototype?.performUpdate) {
    const origPerformUpdate = Base.prototype.performUpdate as (this: HTMLElement) => void;

    Base.prototype.performUpdate = function (this: HTMLElement) {
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

      // 2. Delete own properties that shadow any prototype accessor (@query, etc.)
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
}
