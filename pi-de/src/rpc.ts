/**
 * JSON-RPC over WebSocket helper with timeout support.
 *
 * Usage:
 *   const result = await rpcCall(ws, "list_directories", { path: "/home" });
 */

const RPC_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const pendingRequests = new Map<string, PendingRequest>();

/** Send a JSON-RPC request and return a promise for the result */
export function rpcCall(
  ws: WebSocket,
  method: string,
  params?: any,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).substring(2, 9);

    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`RPC timeout: ${method}`));
    }, RPC_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/** Call from ws.onmessage when data.id is present */
export function handleRpcResponse(data: {
  id: string;
  result?: any;
  error?: string;
}) {
  const pending = pendingRequests.get(data.id);
  if (!pending) return;
  pendingRequests.delete(data.id);
  clearTimeout(pending.timer);
  data.error
    ? pending.reject(new Error(data.error))
    : pending.resolve(data.result);
}
