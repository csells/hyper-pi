import type { ToolInfo, InitStateEvent, HistoryPageResponse } from "./types.js";

/** Maximum serialized size of init_state before truncation kicks in */
const MAX_INIT_BYTES = 500 * 1024; // 500KB

/**
 * Extract AgentMessage objects from pi's session entries.
 *
 * Session entries from getBranch() are `{ type: "message", message: AgentMessage }`.
 * This helper extracts the AgentMessage objects directly — no lossy conversion.
 *
 * Used by both buildInitState() and getHistoryPage().
 */
function extractMessages(entries: unknown[]): unknown[] {
  // Guard: if pi gives us something non-iterable, return empty array.
  if (!Array.isArray(entries)) {
    return [];
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

  return messages;
}

/**
 * Fetch a page of messages from the session history.
 *
 * Returns messages in the range [max(0, before-limit) .. before], plus
 * metadata about whether older messages exist.
 *
 * Example: if total messages = 10, before = 8, limit = 3:
 *   Returns messages at indices [5, 6, 7] (3 messages)
 *   oldestIndex = 5
 *   hasMore = true (messages 0-4 exist)
 */
export function getHistoryPage(
  entries: unknown[],
  before: number,
  limit: number,
): HistoryPageResponse {
  const messages = extractMessages(entries);

  // Clamp before to [0, messages.length]
  const clampedBefore = Math.max(0, Math.min(before, messages.length));

  // Calculate start index: fetch up to 'limit' messages before clampedBefore
  const startIdx = Math.max(0, clampedBefore - limit);

  // Slice the range [startIdx, clampedBefore)
  const pageMessages = messages.slice(startIdx, clampedBefore);

  // Determine if older messages exist
  const hasMore = startIdx > 0;

  return {
    type: "history_page",
    messages: pageMessages as HistoryPageResponse["messages"],
    hasMore,
    oldestIndex: startIdx,
  };
}

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
  const messages = extractMessages(entries);

  // Truncation — single-pass estimator instead of O(n²) re-serialization
  const serialized = JSON.stringify(messages);
  if (serialized.length > MAX_INIT_BYTES) {
    const totalMessages = messages.length;
    
    // Single-pass estimator: compute average message size and calculate keepCount
    const avgMessageSize = serialized.length / messages.length;
    const targetSize = MAX_INIT_BYTES * 0.9; // keep at 90% of budget to be safe
    const estimatedKeepCount = Math.max(10, Math.floor(targetSize / avgMessageSize));
    const startIdx = Math.max(0, messages.length - estimatedKeepCount);
    
    const truncatedMessages = messages.slice(startIdx);
    
    return {
      type: "init_state",
      messages: truncatedMessages as InitStateEvent["messages"],
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
