/**
 * pi-socket: Hyper-Pi WebSocket extension for the pi coding agent
 *
 * Exposes each pi CLI instance via a local WebSocket server, broadcasts
 * agent events in real time, and registers with the hypivisor.
 *
 * ## Error architecture
 *
 * pi.on() handlers: pi catches errors via ExtensionRunner.emit().
 * We let errors propagate so pi reports them.
 *
 * Node callbacks (wss.on, ws.on, setTimeout): wrapped with boundary()
 * which catches unanticipated errors and logs them with needsHardening.
 *
 * Inner layer: known errors handled at source (safeSerialize, readyState
 * guards, hypivisorUrlValid, defensive buildInitState).
 *
 * Outer layer: boundary() catches everything else → log → harden skill.
 *
 * ## Logging
 *
 * All operational events are logged to ~/.pi/logs/pi-socket.jsonl as
 * structured JSONL. Errors needing attention are marked needsHardening.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
export default function piSocket(pi: ExtensionAPI): void;
//# sourceMappingURL=index.d.ts.map