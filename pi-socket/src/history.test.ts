import { describe, it, expect } from "vitest";
import { buildInitState } from "./history.js";

describe("buildInitState", () => {
  it("returns empty events for empty branch", () => {
    const result = buildInitState([], []);
    expect(result.type).toBe("init_state");
    expect(result.events).toEqual([]);
    expect(result.tools).toEqual([]);
    expect(result.truncated).toBeUndefined();
  });

  it("extracts user messages from branch entries", () => {
    const entries = [
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "hello" }],
        },
      },
    ];
    const result = buildInitState(entries, []);
    expect(result.events).toEqual([{ type: "user_message", text: "hello" }]);
  });

  it("handles string content for user messages", () => {
    const entries = [
      {
        type: "message",
        message: { role: "user", content: "hello world" },
      },
    ];
    const result = buildInitState(entries, []);
    expect(result.events).toEqual([{ type: "user_message", text: "hello world" }]);
  });

  it("extracts assistant text as delta events", () => {
    const entries = [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "response text" }],
        },
      },
    ];
    const result = buildInitState(entries, []);
    expect(result.events).toEqual([{ type: "delta", text: "response text" }]);
  });

  it("extracts tool_use blocks as tool_start events", () => {
    const entries = [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "bash", input: { command: "ls" } }],
        },
      },
    ];
    const result = buildInitState(entries, []);
    expect(result.events).toEqual([
      { type: "tool_start", name: "bash", args: { command: "ls" } },
    ]);
  });

  it("extracts toolResult entries as tool_end events", () => {
    const entries = [
      {
        type: "message",
        message: { role: "toolResult", toolName: "bash", isError: false },
      },
    ];
    const result = buildInitState(entries, []);
    expect(result.events).toEqual([
      { type: "tool_end", name: "bash", isError: false },
    ]);
  });

  it("skips non-message entries", () => {
    const entries = [
      { type: "compaction", message: { role: "system", content: [] } },
      { type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
    ];
    const result = buildInitState(entries, []);
    expect(result.events).toHaveLength(1);
  });

  it("passes tools through", () => {
    const tools = [{ name: "bash", description: "Run commands" }];
    const result = buildInitState([], tools);
    expect(result.tools).toEqual(tools);
  });

  it("handles a full conversation round-trip", () => {
    const entries = [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "list files" }] } },
      { type: "message", message: { role: "assistant", content: [
        { type: "text", text: "I'll run ls" },
        { type: "tool_use", name: "bash", input: { command: "ls" } },
      ] } },
      { type: "message", message: { role: "toolResult", toolName: "bash", isError: false } },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Here are the files" }] } },
    ];
    const result = buildInitState(entries, []);
    expect(result.events).toEqual([
      { type: "user_message", text: "list files" },
      { type: "delta", text: "I'll run ls" },
      { type: "tool_start", name: "bash", args: { command: "ls" } },
      { type: "tool_end", name: "bash", isError: false },
      { type: "delta", text: "Here are the files" },
    ]);
  });
});
