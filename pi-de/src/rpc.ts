/**
 * JSON-RPC over WebSocket helper with timeout support.
 *
 * Usage:
 *   const result = await rpcCall<ListNodesResult>(ws, "list_nodes");
 *   const dirs = await rpcCall<ListDirsResult>(ws, "list_directories", { path: "/home" });
 */

const RPC_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const pendingRequests = new Map<string, PendingRequest>();

/** Send a JSON-RPC request and return a typed promise for the result. */
export function rpcCall<TResult = unknown>(
  ws: WebSocket,
  method: string,
  params?: Record<string, unknown>,
): Promise<TResult> {
  return new Promise<TResult>((resolve, reject) => {
    const id = Math.random().toString(36).substring(2, 9);

    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`RPC timeout: ${method}`));
    }, RPC_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/** Call from ws.onmessage when data.id is present */
export function handleRpcResponse(data: {
  id: string;
  result?: unknown;
  error?: string;
}): void {
  const pending = pendingRequests.get(data.id);
  if (!pending) return;
  pendingRequests.delete(data.id);
  clearTimeout(pending.timer);
  if (data.error) {
    pending.reject(new Error(data.error));
  } else {
    pending.resolve(data.result);
  }
}
