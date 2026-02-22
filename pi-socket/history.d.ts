import type { ToolInfo } from "./types.js";
import type { AgentEvent } from "./types.js";
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
export declare function buildInitState(entries: unknown[], tools: ToolInfo[]): AgentEvent & {
    type: "init_state";
};
//# sourceMappingURL=history.d.ts.map