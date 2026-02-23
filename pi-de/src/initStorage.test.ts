import { describe, it, expect, afterEach, vi } from "vitest";
import { initPiDeStorage } from "./initStorage";
import {
  getAppStorage,
  setAppStorage,
  AppStorage,
} from "@mariozechner/pi-web-ui";

describe("initStorage", () => {
  afterEach(() => {
    // Reset app storage after each test
    setAppStorage(null as any);
  });

  it("initPiDeStorage() creates AppStorage and sets it via setAppStorage", () => {
    // Initialize storage
    initPiDeStorage();

    // Verify storage is now set
    const storage = getAppStorage();
    expect(storage).toBeInstanceOf(AppStorage);
    expect(storage).not.toBeNull();
  });

  it("MemoryBackend get/set/delete work correctly", async () => {
    initPiDeStorage();
    const storage = getAppStorage();
    const backend = storage.backend;

    // Test set and get
    await backend.set("test-store", "key1", "value1");
    const retrieved = await backend.get("test-store", "key1");
    expect(retrieved).toBe("value1");

    // Test get non-existent key returns null
    const notFound = await backend.get("test-store", "nonexistent");
    expect(notFound).toBeNull();

    // Test delete
    await backend.delete("test-store", "key1");
    const afterDelete = await backend.get("test-store", "key1");
    expect(afterDelete).toBeNull();
  });

  it("MemoryBackend keys returns all keys in store", async () => {
    initPiDeStorage();
    const storage = getAppStorage();
    const backend = storage.backend;

    await backend.set("store1", "a", 1);
    await backend.set("store1", "b", 2);
    await backend.set("store1", "c", 3);

    const keys = await backend.keys("store1");
    expect(keys).toContain("a");
    expect(keys).toContain("b");
    expect(keys).toContain("c");
    expect(keys.length).toBe(3);
  });

  it("MemoryBackend keys with prefix filters results", async () => {
    initPiDeStorage();
    const storage = getAppStorage();
    const backend = storage.backend;

    await backend.set("store1", "prefix:a", 1);
    await backend.set("store1", "prefix:b", 2);
    await backend.set("store1", "other:c", 3);

    const keys = await backend.keys("store1", "prefix:");
    expect(keys).toContain("prefix:a");
    expect(keys).toContain("prefix:b");
    expect(keys).not.toContain("other:c");
    expect(keys.length).toBe(2);
  });

  it("MemoryBackend has returns correct boolean", async () => {
    initPiDeStorage();
    const storage = getAppStorage();
    const backend = storage.backend;

    await backend.set("store1", "exists", "value");

    const hasExisting = await backend.has("store1", "exists");
    expect(hasExisting).toBe(true);

    const hasNonExisting = await backend.has("store1", "notexist");
    expect(hasNonExisting).toBe(false);
  });

  it("MemoryBackend clear removes all entries from store", async () => {
    initPiDeStorage();
    const storage = getAppStorage();
    const backend = storage.backend;

    await backend.set("store1", "a", 1);
    await backend.set("store1", "b", 2);
    await backend.set("store1", "c", 3);

    const keysBefore = await backend.keys("store1");
    expect(keysBefore.length).toBe(3);

    await backend.clear("store1");

    const keysAfter = await backend.keys("store1");
    expect(keysAfter.length).toBe(0);
  });

  it("MemoryBackend transaction executes operation", async () => {
    initPiDeStorage();
    const storage = getAppStorage();
    const backend = storage.backend;

    const result = await backend.transaction(
      ["store1"],
      "readwrite",
      async (tx) => {
        await tx.set("store1", "key1", "value1");
        await tx.set("store1", "key2", "value2");
        return "transaction-result";
      },
    );

    expect(result).toBe("transaction-result");

    // Verify the transaction actually committed
    const val1 = await backend.get("store1", "key1");
    const val2 = await backend.get("store1", "key2");
    expect(val1).toBe("value1");
    expect(val2).toBe("value2");
  });

  it("MemoryBackend getQuotaInfo returns expected values", async () => {
    initPiDeStorage();
    const storage = getAppStorage();
    const backend = storage.backend;

    const quota = await backend.getQuotaInfo();
    expect(quota.usage).toBe(0);
    expect(quota.quota).toBe(Infinity);
    expect(quota.percent).toBe(0);
  });

  it("MemoryBackend requestPersistence returns true", async () => {
    initPiDeStorage();
    const storage = getAppStorage();
    const backend = storage.backend;

    const result = await backend.requestPersistence();
    expect(result).toBe(true);
  });

  it("pre-populates dummy API keys for all providers", async () => {
    initPiDeStorage();
    const storage = getAppStorage();
    const backend = storage.backend;

    const providers = [
      "anthropic",
      "openai",
      "google",
      "mistral",
      "groq",
      "xai",
      "openrouter",
      "lmstudio",
      "bedrock",
    ];

    for (const provider of providers) {
      const key = await backend.get("provider-keys", provider);
      expect(key).toBe("remote-agent-key");
    }
  });
});
