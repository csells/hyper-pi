/**
 * Structured logger for pi-socket.
 *
 * pi-socket runs inside pi's Node.js process. console.log/error go to
 * pi's TUI and flood the user. stderr is also pi's TUI. So we log to
 * a JSONL file at ~/.pi/logs/pi-socket.jsonl.
 *
 * Log levels:
 * - info:  Normal operations — startup, connections, registrations.
 * - warn:  Expected degraded conditions — reconnecting, client dropped.
 * - error: Unanticipated errors caught by the safety net. Each error
 *          entry has needsHardening: true and represents a gap in the
 *          inner error-handling layer that should be fixed in code.
 *
 * The harden-pi-socket skill reads entries where needsHardening is true,
 * cross-references with its ledger, and proposes targeted code fixes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const LOG_DIR = path.join(os.homedir(), ".pi", "logs");
const LOG_FILE = path.join(LOG_DIR, "pi-socket.jsonl");
/** Exported so the hardening skill knows where to look. */
export const LOG_PATH = LOG_FILE;
let initialized = false;
function ensureDir() {
    if (initialized)
        return;
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        initialized = true;
    }
    catch {
        // Can't create log dir — logging is best-effort.
    }
}
function write(entry) {
    ensureDir();
    try {
        fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
    }
    catch {
        // Best-effort — do NOT throw.
    }
}
/**
 * Log a normal operational event.
 */
export function info(component, msg, data) {
    write({ ts: new Date().toISOString(), level: "info", component, msg, ...data });
}
/**
 * Log an expected degraded condition (not a bug, but worth noting).
 */
export function warn(component, msg, data) {
    write({ ts: new Date().toISOString(), level: "warn", component, msg, ...data });
}
/**
 * Log an unanticipated error caught by the safety net.
 * Marked with needsHardening: true for the hardening skill to process.
 */
export function error(boundary, err, data) {
    write({
        ts: new Date().toISOString(),
        level: "error",
        component: "pi-socket",
        msg: err instanceof Error ? err.message : String(err),
        needsHardening: true,
        boundary,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        ...data,
    });
}
//# sourceMappingURL=log.js.map