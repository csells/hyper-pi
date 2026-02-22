import { describe, it, expect } from "vitest";
import { applyEvent, rebuildHistory } from "./events";
import type { ChatMessage, HistoryEvent } from "./types";

describe("applyEvent", () => {
  it("adds user message", () => {
    const result = applyEvent([], { type: "user_message", text: "hello" });
    expect(result).toEqual([{ role: "user", content: "hello" }]);
  });

  it("starts a new assistant message for delta when no prior assistant", () => {
    const result = applyEvent([], { type: "delta", text: "hi" });
    expect(result).toEqual([{ role: "assistant", content: "hi" }]);
  });

  it("appends to existing assistant message for delta", () => {
    const chat: ChatMessage[] = [{ role: "assistant", content: "he" }];
    const result = applyEvent(chat, { type: "delta", text: "llo" });
    expect(result).toEqual([{ role: "assistant", content: "hello" }]);
  });

  it("starts new assistant message after user message", () => {
    const chat: ChatMessage[] = [{ role: "user", content: "q" }];
    const result = applyEvent(chat, { type: "delta", text: "a" });
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ role: "assistant", content: "a" });
  });

  it("adds tool_start as system message", () => {
    const result = applyEvent([], { type: "tool_start", name: "bash", args: {} });
    expect(result[0].role).toBe("system");
    expect(result[0].content).toContain("bash");
    expect(result[0].content).toContain("⏳");
  });

  it("updates tool_start to success on tool_end", () => {
    const chat: ChatMessage[] = [
      { role: "system", content: "⏳ Running `bash`…" },
    ];
    const result = applyEvent(chat, { type: "tool_end", name: "bash", isError: false });
    expect(result[0].content).toBe("✓ `bash`");
  });

  it("updates tool_start to failure on tool_end with error", () => {
    const chat: ChatMessage[] = [
      { role: "system", content: "⏳ Running `bash`…" },
    ];
    const result = applyEvent(chat, { type: "tool_end", name: "bash", isError: true });
    expect(result[0].content).toBe("✗ `bash` failed");
  });

  it("does not mutate original array", () => {
    const original: ChatMessage[] = [{ role: "user", content: "hi" }];
    const result = applyEvent(original, { type: "delta", text: "yo" });
    expect(original).toHaveLength(1);
    expect(result).toHaveLength(2);
  });
});

describe("rebuildHistory", () => {
  it("returns empty array for empty events", () => {
    expect(rebuildHistory([])).toEqual([]);
  });

  it("rebuilds a full conversation", () => {
    const events: HistoryEvent[] = [
      { type: "user_message", text: "list files" },
      { type: "delta", text: "Running ls" },
      { type: "tool_start", name: "bash", args: {} },
      { type: "tool_end", name: "bash", isError: false },
      { type: "delta", text: "Done" },
    ];
    const result = rebuildHistory(events);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ role: "user", content: "list files" });
    expect(result[1]).toEqual({ role: "assistant", content: "Running ls" });
    expect(result[2].role).toBe("system");
    expect(result[2].content).toBe("✓ `bash`");
    expect(result[3]).toEqual({ role: "assistant", content: "Done" });
  });
});
