/** Exported so the hardening skill knows where to look. */
export declare const LOG_PATH: string;
export type LogLevel = "info" | "warn" | "error";
/**
 * Log a normal operational event.
 */
export declare function info(component: string, msg: string, data?: Record<string, unknown>): void;
/**
 * Log an expected degraded condition (not a bug, but worth noting).
 */
export declare function warn(component: string, msg: string, data?: Record<string, unknown>): void;
/**
 * Log an unanticipated error caught by the safety net.
 * Marked with needsHardening: true for the hardening skill to process.
 */
export declare function error(boundary: string, err: unknown, data?: Record<string, unknown>): void;
//# sourceMappingURL=log.d.ts.map