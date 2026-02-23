import { describe, it, expect, vi, beforeEach } from "vitest";
import { rpcCall, handleRpcResponse, rejectAllPending, pendingRequests } from "./rpc";

describe("rpc", () => {
  beforeEach(() => {
    pendingRequests.clear();
  });

  it("rpcCall sends JSON-RPC message with id", () => {
    const sent: string[] = [];
    const mockWs = { send: (msg: string) => sent.push(msg) } as unknown as WebSocket;

    rpcCall(mockWs, "list_nodes", { foo: "bar" });

    expect(sent).toHaveLength(1);
    const parsed = JSON.parse(sent[0]);
    expect(parsed.method).toBe("list_nodes");
    expect(parsed.params).toEqual({ foo: "bar" });
    expect(parsed.id).toBeDefined();
    expect(pendingRequests.size).toBe(1);
  });

  it("handleRpcResponse resolves pending request", async () => {
    const mockWs = { send: vi.fn() } as unknown as WebSocket;

    const promise = rpcCall(mockWs, "test");
    // Extract the id from the pending request
    const id = Array.from(pendingRequests.keys())[0];

    handleRpcResponse({ id, result: { status: "ok" } });

    const result = await promise;
    expect(result).toEqual({ status: "ok" });
    expect(pendingRequests.size).toBe(0);
  });

  it("handleRpcResponse rejects on error", async () => {
    const mockWs = { send: vi.fn() } as unknown as WebSocket;

    const promise = rpcCall(mockWs, "test");
    const id = Array.from(pendingRequests.keys())[0];

    handleRpcResponse({ id, error: "something broke" });

    await expect(promise).rejects.toThrow("something broke");
    expect(pendingRequests.size).toBe(0);
  });

  it("ignores responses for unknown ids", () => {
    handleRpcResponse({ id: "unknown-id", result: {} });
    expect(pendingRequests.size).toBe(0);
  });

  it("rejectAllPending rejects all pending requests and clears map", async () => {
    const mockWs = { send: vi.fn() } as unknown as WebSocket;

    const promise1 = rpcCall(mockWs, "test1");
    const promise2 = rpcCall(mockWs, "test2");
    const promise3 = rpcCall(mockWs, "test3");

    expect(pendingRequests.size).toBe(3);

    const reason = "WebSocket closed";
    rejectAllPending(reason);

    expect(pendingRequests.size).toBe(0);

    await expect(promise1).rejects.toThrow(reason);
    await expect(promise2).rejects.toThrow(reason);
    await expect(promise3).rejects.toThrow(reason);
  });

  it("rejectAllPending clears timeouts", async () => {
    const mockWs = { send: vi.fn() } as unknown as WebSocket;
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    const promise1 = rpcCall(mockWs, "test1");
    const promise2 = rpcCall(mockWs, "test2");

    expect(pendingRequests.size).toBe(2);

    rejectAllPending("Connection lost");

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);
    expect(pendingRequests.size).toBe(0);

    // Catch rejections to prevent unhandled rejection warnings
    await promise1.catch(() => {});
    await promise2.catch(() => {});

    clearTimeoutSpy.mockRestore();
  });
});
