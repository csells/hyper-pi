import "@testing-library/jest-dom/vitest";

// Polyfill DOMMatrix for jsdom environment (needed by pdfjs-dist)
if (typeof globalThis.DOMMatrix === "undefined") {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
  };
}

// Polyfill DataTransferItem for jsdom environment (needed by FileAttachment tests)
if (typeof globalThis.DataTransferItem === "undefined") {
  (globalThis as any).DataTransferItem = class DataTransferItem {
    constructor(public kind: string, public type: string) {}
    getAsFile(): File | null {
      return null;
    }
    getAsString(callback: (data: string) => void): void {
      callback("");
    }
  };
}

// Polyfill DataTransfer for jsdom environment (needed by FileAttachment tests)
if (typeof globalThis.DataTransfer === "undefined") {
  (globalThis as any).DataTransfer = class DataTransfer {
    items: DataTransferItem[] = [];
    types: string[] = [];
    files: File[] = [];

    setData(type: string, value: string): void {
      if (!this.types.includes(type)) {
        this.types.push(type);
      }
    }

    getData(type: string): string {
      return "";
    }

    clearData(type?: string): void {
      if (type) {
        const index = this.types.indexOf(type);
        if (index > -1) {
          this.types.splice(index, 1);
        }
      } else {
        this.types = [];
      }
    }

    setDragImage(image: Element, x: number, y: number): void {
      // No-op
    }
  };
}

// Polyfill DragEvent for jsdom environment (needed by FileAttachment tests)
if (typeof globalThis.DragEvent === "undefined") {
  (globalThis as any).DragEvent = class DragEvent extends Event {
    dataTransfer: DataTransfer | null = null;

    constructor(type: string, init?: DragEventInit & { dataTransfer?: DataTransfer }) {
      super(type, init);
      if (init?.dataTransfer) {
        this.dataTransfer = init.dataTransfer;
      }
    }
  };
}
