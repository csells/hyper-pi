/**
 * Initialize a minimal AppStorage for Pi-DE.
 *
 * pi-web-ui's AgentInterface.sendMessage() calls getAppStorage() to check
 * provider API keys before forwarding to session.prompt(). In Pi-DE the
 * remote pi agent owns its own keys, so we provide a simple in-memory
 * backend that returns a dummy key for all providers.
 */
import {
  AppStorage,
  setAppStorage,
  ProviderKeysStore,
  SessionsStore,
  SettingsStore,
  CustomProvidersStore,
} from "@mariozechner/pi-web-ui";
import type {
  StorageBackend,
  StorageTransaction,
} from "@mariozechner/pi-web-ui";

/** Simple in-memory StorageBackend. */
class MemoryBackend implements StorageBackend {
  private stores = new Map<string, Map<string, unknown>>();

  private getStore(name: string): Map<string, unknown> {
    let s = this.stores.get(name);
    if (!s) {
      s = new Map();
      this.stores.set(name, s);
    }
    return s;
  }

  async get<T = unknown>(storeName: string, key: string): Promise<T | null> {
    return (this.getStore(storeName).get(key) as T) ?? null;
  }
  async set<T = unknown>(storeName: string, key: string, value: T): Promise<void> {
    this.getStore(storeName).set(key, value);
  }
  async delete(storeName: string, key: string): Promise<void> {
    this.getStore(storeName).delete(key);
  }
  async keys(storeName: string, prefix?: string): Promise<string[]> {
    const all = [...this.getStore(storeName).keys()];
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }
  async getAllFromIndex<T = unknown>(storeName: string): Promise<T[]> {
    return [...this.getStore(storeName).values()] as T[];
  }
  async clear(storeName: string): Promise<void> {
    this.getStore(storeName).clear();
  }
  async has(storeName: string, key: string): Promise<boolean> {
    return this.getStore(storeName).has(key);
  }
  async transaction<T>(
    _storeNames: string[],
    _mode: "readonly" | "readwrite",
    operation: (tx: StorageTransaction) => Promise<T>,
  ): Promise<T> {
    // Single-threaded JS — no real transaction needed
    return operation({
      get: (s: string, k: string) => this.get(s, k),
      set: <V = unknown>(s: string, k: string, v: V) => this.set(s, k, v),
      delete: (s: string, k: string) => this.delete(s, k),
    });
  }
  async getQuotaInfo() {
    return { usage: 0, quota: Infinity, percent: 0 };
  }
  async requestPersistence() {
    return true;
  }
}

export function initPiDeStorage(): void {
  const backend = new MemoryBackend();

  const settings = new SettingsStore();
  const providerKeys = new ProviderKeysStore();
  const sessions = new SessionsStore();
  const customProviders = new CustomProvidersStore();

  // Wire backend into each store
  settings.setBackend(backend);
  providerKeys.setBackend(backend);
  sessions.setBackend(backend);
  customProviders.setBackend(backend);

  // Pre-populate a dummy API key so sendMessage's provider check passes.
  // The remote pi agent uses its own real key — this just satisfies the guard.
  backend.set("provider-keys", "anthropic", "remote-agent-key");

  setAppStorage(new AppStorage(settings, providerKeys, sessions, customProviders, backend));
}
