import type { HistoryEvent, ToolInfo } from "./types.js";
import type { AgentEvent } from "./types.js";

/** Maximum serialized size of init_state before truncation kicks in */
const MAX_INIT_BYTES = 500 * 1024; // 500KB

/**
 * Build the init_state payload from pi's native session branch.
 *
 * SAFETY: This function MUST NEVER throw. It is called from a WebSocket
 * connection handler inside a pi extension. Any uncaught exception here
 * will propagate up and terminate the host pi process. Every property
 * access on session data must be defensive — pi's internal types are
 * not guaranteed to be stable.
 */
export function buildInitState(
  entries: unknown[],
  tools: ToolInfo[],
): AgentEvent & { type: "init_state" } {
  try {
    if (!Array.isArray(entries)) {
      return { type: "init_state", events: [], tools: tools ?? [] };
    }

    const allEvents: HistoryEvent[] = [];

    for (const raw of entries) {
      try {
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
      } catch {
        continue; // skip malformed entry, never crash
      }
    }

    // Truncation — drop oldest events until under budget
    try {
      const serialized = JSON.stringify(allEvents);
      if (serialized.length > MAX_INIT_BYTES) {
        const totalEvents = allEvents.length;
        while (allEvents.length > 10) {
          allEvents.shift();
          // Re-check size; avoid JSON.stringify on every iteration for perf
          if (JSON.stringify(allEvents).length <= MAX_INIT_BYTES) break;
        }
        return { type: "init_state", events: allEvents, tools: tools ?? [], truncated: true, totalEvents };
      }
    } catch {
      // Serialization failed (circular ref?) — return what we can
      return { type: "init_state", events: [], tools: tools ?? [], truncated: true, totalEvents: allEvents.length };
    }

    return { type: "init_state", events: allEvents, tools: tools ?? [] };
  } catch {
    // Catastrophic failure — return empty but valid state
    return { type: "init_state", events: [], tools: [] };
  }
}
