/**
 * Safety net: the outer layer of the two-layer error architecture.
 *
 * Wraps Node event-loop callbacks (wss.on, ws.on, setTimeout) so that
 * unanticipated exceptions are caught, logged for the hardening skill,
 * and never crash the pi host process.
 *
 * Known/expected errors should be handled in the inner layer (inside
 * the callback itself). If an error reaches boundary(), it means the
 * inner layer has a gap that the harden-pi-socket skill should close.
 */
import * as log from "./log.js";
/**
 * Wrap a Node event-loop callback with a safety net.
 *
 * Usage:
 *   wss.on("connection", boundary("wss.connection", (ws) => { ... }));
 *   setTimeout(boundary("reconnect", () => { ... }), ms);
 */
export function boundary(name, fn) {
    return (...args) => {
        try {
            fn(...args);
        }
        catch (err) {
            log.error(name, err);
        }
    };
}
//# sourceMappingURL=safety.js.map