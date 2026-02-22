/**
 * Wrap a Node event-loop callback with a safety net.
 *
 * Usage:
 *   wss.on("connection", boundary("wss.connection", (ws) => { ... }));
 *   setTimeout(boundary("reconnect", () => { ... }), ms);
 */
export declare function boundary<A extends unknown[]>(name: string, fn: (...args: A) => void): (...args: A) => void;
//# sourceMappingURL=safety.d.ts.map