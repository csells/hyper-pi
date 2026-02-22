import type { ChatMessage, AgentEvent, HistoryEvent } from "./types";

/**
 * Apply a single agent event to a chat message array, returning a new array.
 * Used by both `rebuildHistory()` and the real-time event handler.
 */
export function applyEvent(chat: ChatMessage[], event: AgentEvent | HistoryEvent): ChatMessage[] {
  const result = [...chat];
  const last = result[result.length - 1];

  switch (event.type) {
    case "user_message":
      result.push({ role: "user", content: event.text });
      break;

    case "delta":
      if (!last || last.role !== "assistant") {
        result.push({ role: "assistant", content: event.text });
      } else {
        result[result.length - 1] = {
          ...last,
          content: last.content + event.text,
        };
      }
      break;

    case "tool_start":
      result.push({ role: "system", content: `⏳ Running \`${event.name}\`…` });
      break;

    case "tool_end":
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i].role === "system" && result[i].content.includes(event.name)) {
          result[i] = {
            ...result[i],
            content: event.isError
              ? `✗ \`${event.name}\` failed`
              : `✓ \`${event.name}\``,
          };
          break;
        }
      }
      break;
  }

  return result;
}

/** Rebuild full chat history from an array of historical events. */
export function rebuildHistory(events: HistoryEvent[]): ChatMessage[] {
  return events.reduce<ChatMessage[]>((chat, ev) => applyEvent(chat, ev), []);
}
