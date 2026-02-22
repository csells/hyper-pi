/**
 * Patch Lit's ReactiveElement.performUpdate to handle class-field-shadowing.
 *
 * pi-web-ui uses native ES2022 class field declarations which overwrite
 * Lit's reactive prototype accessors. Lit dev mode throws in performUpdate.
 *
 * This module imports @lit/reactive-element and patches its prototype
 * immediately at module evaluation time (no function call needed).
 * It MUST be imported before @mariozechner/pi-web-ui.
 */
import { ReactiveElement } from "@lit/reactive-element";

// Access protected member via any-cast — we're monkey-patching the prototype
const proto = ReactiveElement.prototype as unknown as Record<string, unknown>;
const origPerformUpdate = proto.performUpdate as () => void;

proto.performUpdate = function (this: HTMLElement) {
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
    // Restore through Lit's prototype setters
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
