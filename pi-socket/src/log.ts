/** Structured logger for pi-socket extension */

const PREFIX = "[pi-socket]";

export const log = {
  info(msg: string, data?: Record<string, unknown>) {
    if (data) {
      console.log(`${PREFIX} ${msg}`, JSON.stringify(data));
    } else {
      console.log(`${PREFIX} ${msg}`);
    }
  },

  warn(msg: string, data?: Record<string, unknown>) {
    if (data) {
      console.warn(`${PREFIX} ${msg}`, JSON.stringify(data));
    } else {
      console.warn(`${PREFIX} ${msg}`);
    }
  },

  error(msg: string, err?: unknown) {
    const detail = err instanceof Error ? err.message : String(err ?? "");
    if (detail) {
      console.error(`${PREFIX} ${msg}: ${detail}`);
    } else {
      console.error(`${PREFIX} ${msg}`);
    }
  },
};
