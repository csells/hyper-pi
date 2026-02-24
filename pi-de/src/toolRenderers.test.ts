import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted — can't reference outer variables.
// Use vi.hoisted to create mocks that survive hoisting.
const { mockRegister, mockHeader } = vi.hoisted(() => ({
  mockRegister: vi.fn(),
  mockHeader: vi.fn(() => "<mock-header>"),
}));

vi.mock("@mariozechner/pi-web-ui", () => ({
  registerToolRenderer: mockRegister,
  renderCollapsibleHeader: mockHeader,
}));

vi.mock("lit", () => ({
  html: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((result, str, i) => result + str + (values[i] ?? ""), ""),
}));

vi.mock("lit/directives/ref.js", () => ({
  createRef: () => ({ value: null }),
}));

vi.mock("lucide", () => ({
  FileText: "FileText",
  FilePenLine: "FilePenLine",
  FolderOpen: "FolderOpen",
  Search: "Search",
  FileSearch: "FileSearch",
  SquareTerminal: "SquareTerminal",
}));

import { registerCompactToolRenderers } from "./toolRenderers";

function makeResult(text: string, isError = false) {
  return {
    role: "toolResult" as const,
    isError,
    content: [{ type: "text" as const, text }],
    toolCallId: "1",
    toolName: "test",
    timestamp: Date.now(),
  };
}

describe("toolRenderers", () => {
  beforeEach(() => {
    mockRegister.mockClear();
    mockHeader.mockClear();
  });

  describe("registerCompactToolRenderers", () => {
    it("registers all 7 built-in tool renderers", () => {
      registerCompactToolRenderers();
      expect(mockRegister).toHaveBeenCalledTimes(7);

      const names = mockRegister.mock.calls.map((c: unknown[]) => c[0]);
      expect(names).toEqual(["read", "write", "edit", "bash", "ls", "find", "grep"]);
    });

    it("each renderer has a render method", () => {
      registerCompactToolRenderers();
      for (const call of mockRegister.mock.calls) {
        expect(typeof call[1].render).toBe("function");
      }
    });
  });

  describe("individual renderers", () => {
    function getRenderer(name: string) {
      mockRegister.mockClear();
      registerCompactToolRenderers();
      const call = mockRegister.mock.calls.find((c: unknown[]) => c[0] === name);
      return call![1];
    }

    describe("read", () => {
      it("renders in-progress without result", () => {
        const r = getRenderer("read");
        const out = r.render({ path: "src/app.ts", offset: 10, limit: 20 }, undefined, true);
        expect(out.isCustom).toBe(false);
      });

      it("renders output with truncation", () => {
        const r = getRenderer("read");
        const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
        const out = r.render({ path: "src/app.ts" }, makeResult(lines.join("\n")), false);
        expect(String(out.content)).toContain("more lines");
      });

      it("renders error state", () => {
        const r = getRenderer("read");
        const out = r.render({ path: "x.ts" }, makeResult("Not found", true), false);
        expect(out.isCustom).toBe(false);
      });

      it("shortens home directory paths", () => {
        const r = getRenderer("read");
        mockHeader.mockClear();
        r.render({ path: "/Users/csells/Code/project/src/app.ts" }, makeResult("ok"), false);
        // The header text passed to renderCollapsibleHeader should have shortened path
        expect(mockHeader).toHaveBeenCalled();
        const headerArg = String((mockHeader.mock.calls[0] as unknown[])[2]);
        expect(headerArg).toContain("~/Code/project/src/app.ts");
      });
    });

    describe("write", () => {
      it("renders with file content preview", () => {
        const r = getRenderer("write");
        const out = r.render({ path: "src/new.ts", content: "export const x = 1;\n" }, undefined, false);
        expect(out.isCustom).toBe(false);
      });

      it("renders error", () => {
        const r = getRenderer("write");
        const out = r.render({ path: "x.ts", content: "test" }, makeResult("Permission denied", true), false);
        expect(out.isCustom).toBe(false);
      });
    });

    describe("edit", () => {
      it("renders old/new text diff", () => {
        const r = getRenderer("edit");
        const out = r.render(
          { path: "src/app.ts", oldText: "const x = 1;", newText: "const x = 2;" },
          undefined,
          false,
        );
        expect(out.isCustom).toBe(false);
      });

      it("renders without params", () => {
        const r = getRenderer("edit");
        const out = r.render(undefined, undefined, true);
        expect(out.isCustom).toBe(false);
      });

      it("renders error", () => {
        const r = getRenderer("edit");
        const out = r.render({ path: "x.ts" }, makeResult("oldText not found", true), false);
        expect(out.isCustom).toBe(false);
      });
    });

    describe("bash", () => {
      it("renders command in-progress", () => {
        const r = getRenderer("bash");
        const out = r.render({ command: "echo hello" }, undefined, true);
        expect(out.isCustom).toBe(false);
      });

      it("renders with output", () => {
        const r = getRenderer("bash");
        const out = r.render({ command: "echo hello" }, makeResult("hello\n"), false);
        expect(out.isCustom).toBe(false);
      });

      it("renders empty output without content block", () => {
        const r = getRenderer("bash");
        const out = r.render({ command: "true" }, makeResult(""), false);
        expect(out.isCustom).toBe(false);
      });

      it("renders with timeout", () => {
        const r = getRenderer("bash");
        mockHeader.mockClear();
        r.render({ command: "sleep 100", timeout: 30 }, undefined, true);
        // The header text passed to renderCollapsibleHeader should contain timeout
        expect(mockHeader).toHaveBeenCalled();
        const headerArg = String((mockHeader.mock.calls[0] as unknown[])[2]);
        expect(headerArg).toContain("timeout 30s");
      });
    });

    describe("ls", () => {
      it("renders with path", () => {
        const r = getRenderer("ls");
        const out = r.render({ path: "src/" }, undefined, true);
        expect(out.isCustom).toBe(false);
      });

      it("renders with output", () => {
        const r = getRenderer("ls");
        const out = r.render({ path: "." }, makeResult("file1.ts\nfile2.ts"), false);
        expect(out.isCustom).toBe(false);
      });
    });

    describe("find", () => {
      it("renders with pattern and path", () => {
        const r = getRenderer("find");
        const out = r.render({ pattern: "*.ts", path: "src/" }, undefined, true);
        expect(out.isCustom).toBe(false);
      });
    });

    describe("grep", () => {
      it("renders with pattern, path, and glob", () => {
        const r = getRenderer("grep");
        const out = r.render({ pattern: "TODO", path: "src/", glob: "*.ts" }, undefined, true);
        expect(out.isCustom).toBe(false);
      });

      it("renders with output and truncation", () => {
        const r = getRenderer("grep");
        const lines = Array.from({ length: 20 }, (_, i) => `src/file${i}.ts:${i}: match`);
        const out = r.render({ pattern: "match", path: "src/" }, makeResult(lines.join("\n")), false);
        expect(String(out.content)).toContain("more lines");
      });
    });
  });
});
