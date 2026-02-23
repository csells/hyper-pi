import { describe, it, expect } from "vitest";
import { buildInitState } from "./history.js";

describe("buildInitState", () => {
  it("returns empty messages for empty branch", () => {
    const result = buildInitState([], []);
    expect(result.type).toBe("init_state");
    expect(result.messages).toEqual([]);
    expect(result.tools).toEqual([]);
    expect(result.truncated).toBeUndefined();
  });

  it("extracts user messages directly as AgentMessage", () => {
    const entries = [
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "hello" }],
          timestamp: 1000,
        },
      },
    ];
    const result = buildInitState(entries, []);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1000,
    });
  });

  it("extracts assistant messages with all content blocks", () => {
    const entries = [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "let me think..." },
            { type: "text", text: "response text" },
            { type: "toolCall", id: "tc_1", name: "bash", arguments: { command: "ls" } },
          ],
          api: "anthropic-messages",
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          stopReason: "toolUse",
          timestamp: 2000,
        },
      },
    ];
    const result = buildInitState(entries, []);
    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0] as unknown as Record<string, unknown>;
    expect(msg.role).toBe("assistant");
    // Preserves ALL content blocks as-is (thinking, text, toolCall)
    expect((msg.content as unknown[]).length).toBe(3);
  });

  it("extracts toolResult messages directly", () => {
    const entries = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "tc_1",
          toolName: "bash",
          content: [{ type: "text", text: "file1.ts\nfile2.ts" }],
          isError: false,
          timestamp: 3000,
        },
      },
    ];
    const result = buildInitState(entries, []);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      role: "toolResult",
      toolCallId: "tc_1",
      toolName: "bash",
      content: [{ type: "text", text: "file1.ts\nfile2.ts" }],
      isError: false,
      timestamp: 3000,
    });
  });

  it("skips non-message entries", () => {
    const entries = [
      { type: "compaction", summary: "..." },
      { type: "branch_summary", summary: "..." },
      { type: "message", message: { role: "user", content: "hi", timestamp: 1000 } },
    ];
    const result = buildInitState(entries, []);
    expect(result.messages).toHaveLength(1);
  });

  it("passes tools through", () => {
    const tools = [{ name: "bash", description: "Run commands" }];
    const result = buildInitState([], tools);
    expect(result.tools).toEqual(tools);
  });

  it("handles a full conversation round-trip", () => {
    const entries = [
      {
        type: "message",
        message: { role: "user", content: "list files", timestamp: 1000 },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "I'll run ls" },
            { type: "toolCall", id: "tc_1", name: "bash", arguments: { command: "ls" } },
          ],
          api: "anthropic-messages",
          provider: "anthropic",
          model: "remote",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          stopReason: "toolUse",
          timestamp: 2000,
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "tc_1",
          toolName: "bash",
          content: [{ type: "text", text: "file1.ts" }],
          isError: false,
          timestamp: 3000,
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Here are the files" }],
          api: "anthropic-messages",
          provider: "anthropic",
          model: "remote",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          stopReason: "stop",
          timestamp: 4000,
        },
      },
    ];
    const result = buildInitState(entries, []);
    expect(result.messages).toHaveLength(4);
    expect((result.messages[0] as unknown as Record<string, unknown>).role).toBe("user");
    expect((result.messages[1] as unknown as Record<string, unknown>).role).toBe("assistant");
    expect((result.messages[2] as unknown as Record<string, unknown>).role).toBe("toolResult");
    expect((result.messages[3] as unknown as Record<string, unknown>).role).toBe("assistant");
  });

  it("handles non-array input gracefully", () => {
    const result = buildInitState(null as unknown as unknown[], []);
    expect(result.messages).toEqual([]);
  });

  it("skips entries with missing message", () => {
    const entries = [
      { type: "message" },
      { type: "message", message: null },
      { type: "message", message: { role: "user", content: "ok", timestamp: 1000 } },
    ];
    const result = buildInitState(entries, []);
    expect(result.messages).toHaveLength(1);
  });

  it("skips entries with missing role", () => {
    const entries = [
      { type: "message", message: { content: "no role" } },
    ];
    const result = buildInitState(entries, []);
    expect(result.messages).toEqual([]);
  });
});
