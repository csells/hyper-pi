import type { HistoryEvent, ToolInfo } from "./types.js";
import type { AgentEvent } from "./types.js";

/** Maximum serialized size of init_state before truncation kicks in */
const MAX_INIT_BYTES = 500 * 1024; // 500KB

/**
 * Build the init_state payload from pi's native session branch.
 * Accepts the raw array from `ctx.sessionManager.getBranch()` and
 * the tools from `pi.getAllTools()`.
 *
 * We use `unknown[]` for the entries parameter because pi's internal
 * SessionEntry type includes union types that are difficult to replicate
 * exactly. We defensively access properties at runtime.
 */
export function buildInitState(
  entries: unknown[],
  tools: ToolInfo[],
): AgentEvent & { type: "init_state" } {
  const allEvents: HistoryEvent[] = [];

  for (const raw of entries) {
    const entry = raw as Record<string, unknown>;
    if (entry.type !== "message") continue;
    const msg = entry.message as Record<string, unknown> | undefined;
    if (!msg) continue;
    const role = msg.role as string;
    const content = msg.content;

    if (role === "user") {
      let text = "";
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .filter((c: Record<string, unknown>) => c.type === "text")
          .map((c: Record<string, unknown>) => (c.text as string) ?? "")
          .join("\n");
      }
      if (text) allEvents.push({ type: "user_message", text });
    } else if (role === "assistant") {
      if (Array.isArray(content)) {
        for (const block of content as Record<string, unknown>[]) {
          if (block.type === "text" && block.text) {
            allEvents.push({ type: "delta", text: block.text as string });
          } else if (block.type === "tool_use" && block.name) {
            allEvents.push({ type: "tool_start", name: block.name as string, args: block.input });
          }
        }
      }
    } else if (role === "toolResult" && msg.toolName) {
      allEvents.push({
        type: "tool_end",
        name: msg.toolName as string,
        isError: (msg.isError as boolean) ?? false,
      });
    }
  }

  // Truncation — drop oldest events until under budget
  const serialized = JSON.stringify(allEvents);
  if (serialized.length > MAX_INIT_BYTES) {
    const totalEvents = allEvents.length;
    while (JSON.stringify(allEvents).length > MAX_INIT_BYTES && allEvents.length > 10) {
      allEvents.shift();
    }
    return { type: "init_state", events: allEvents, tools, truncated: true, totalEvents };
  }

  return { type: "init_state", events: allEvents, tools };
}
