import type { ToolInfo, InitStateEvent } from "./types.js";

/** Maximum serialized size of init_state before truncation kicks in */
const MAX_INIT_BYTES = 500 * 1024; // 500KB

/**
 * Build the init_state payload from pi's native session branch.
 *
 * Session entries from getBranch() are `{ type: "message", message: AgentMessage }`.
 * We extract the AgentMessage objects directly — no lossy conversion to flat events.
 *
 * This function is called from a wss.on("connection") handler which runs
 * on Node's event loop (outside pi's error-catching event system). It
 * MUST NOT throw, because an uncaught exception there would terminate
 * the pi process.
 */
export function buildInitState(
  entries: unknown[],
  tools: ToolInfo[],
): InitStateEvent {
  // Guard: if pi gives us something non-iterable, return empty state.
  if (!Array.isArray(entries)) {
    return { type: "init_state", messages: [], tools: tools ?? [] };
  }

  const messages: unknown[] = [];

  for (const raw of entries) {
    if (raw == null || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;

    // Only extract message entries (skip compaction, branch_summary, etc.)
    if (entry.type !== "message") continue;

    const msg = entry.message;
    if (msg == null || typeof msg !== "object") continue;

    // Validate it has a role (basic AgentMessage check)
    const m = msg as Record<string, unknown>;
    if (typeof m.role !== "string") continue;

    messages.push(msg);
  }

  // Truncation — drop oldest messages until under budget
  const serialized = JSON.stringify(messages);
  if (serialized.length > MAX_INIT_BYTES) {
    const totalMessages = messages.length;
    while (messages.length > 10) {
      messages.shift();
      if (JSON.stringify(messages).length <= MAX_INIT_BYTES) break;
    }
    return {
      type: "init_state",
      messages: messages as InitStateEvent["messages"],
      tools: tools ?? [],
      truncated: true,
      totalMessages,
    };
  }

  return {
    type: "init_state",
    messages: messages as InitStateEvent["messages"],
    tools: tools ?? [],
  };
}
