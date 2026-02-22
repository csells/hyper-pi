import type { HistoryEvent, ToolInfo } from "./types.js";
import type { AgentEvent } from "./types.js";

/** Maximum serialized size of init_state before truncation kicks in */
const MAX_INIT_BYTES = 500 * 1024; // 500KB

/**
 * Build the init_state payload from pi's native session branch.
 *
 * This function is called from a wss.on("connection") handler which runs
 * on Node's event loop (outside pi's error-catching event system). It
 * MUST NOT throw, because an uncaught exception there would terminate
 * the pi process.
 *
 * Strategy: validate every property access defensively. If any entry is
 * malformed, skip it (not crash). If the entire input is bad, return an
 * empty valid payload.
 */
export function buildInitState(
  entries: unknown[],
  tools: ToolInfo[],
): AgentEvent & { type: "init_state" } {
  // Guard: if pi gives us something non-iterable, return empty state.
  if (!Array.isArray(entries)) {
    return { type: "init_state", events: [], tools: tools ?? [] };
  }

  const allEvents: HistoryEvent[] = [];

  for (const raw of entries) {
    // Each entry is from pi's internal session format. We don't control
    // the shape, so every access must be guarded.
    if (raw == null || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (entry.type !== "message") continue;

    const msg = entry.message;
    if (msg == null || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;

    const role = m.role;
    if (typeof role !== "string") continue;

    const content = m.content;

    if (role === "user") {
      let text = "";
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .filter((c) => c != null && typeof c === "object" && (c as Record<string, unknown>).type === "text")
          .map((c) => {
            const t = (c as Record<string, unknown>).text;
            return typeof t === "string" ? t : "";
          })
          .join("\n");
      }
      if (text) allEvents.push({ type: "user_message", text });
    } else if (role === "assistant") {
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block == null || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            allEvents.push({ type: "delta", text: b.text });
          } else if (b.type === "tool_use" && typeof b.name === "string") {
            allEvents.push({ type: "tool_start", name: b.name, args: b.input });
          }
        }
      }
    } else if (role === "toolResult" && typeof m.toolName === "string") {
      allEvents.push({
        type: "tool_end",
        name: m.toolName,
        isError: m.isError === true,
      });
    }
  }

  // Truncation — drop oldest events until under budget
  const serialized = JSON.stringify(allEvents);
  if (serialized.length > MAX_INIT_BYTES) {
    const totalEvents = allEvents.length;
    while (allEvents.length > 10) {
      allEvents.shift();
      if (JSON.stringify(allEvents).length <= MAX_INIT_BYTES) break;
    }
    return { type: "init_state", events: allEvents, tools: tools ?? [], truncated: true, totalEvents };
  }

  return { type: "init_state", events: allEvents, tools: tools ?? [] };
}
