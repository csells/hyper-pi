# Pi-DE component unit test gaps (SpawnModal, initStorage, patchLit)

Add unit tests for the 3 untested Pi-DE modules. Create test files alongside each source file.

**Files to create/modify:**
- `pi-de/src/SpawnModal.test.tsx` (new — ~150 lines)
- `pi-de/src/initStorage.test.ts` (new — ~100 lines)
- `pi-de/src/patchLit.test.ts` (new — ~60 lines)

**SpawnModal tests (8-10 tests):**
1. Renders modal with title, file browser, controls
2. Calls `rpcCall("list_directories", {})` on mount (empty path = $HOME default)
3. Double-clicking a directory navigates into it (updates path, reloads dirs)
4. "Up" button navigates to parent directory
5. Successful spawn: calls `rpcCall("spawn_agent", { path, new_folder })`, calls `onClose()`
6. Failed spawn: shows error message, modal stays open, deploy button re-enables
7. Loading state: deploy button shows "Deploying…" and is disabled during RPC
8. Overlay click calls `onClose()`
9. Empty directory list shows "No subdirectories"
10. New folder input updates state

**initStorage tests (5-6 tests):**
1. `initPiDeStorage()` creates AppStorage and sets it via `setAppStorage()`
2. MemoryBackend get/set/delete/keys/has/clear work correctly
3. MemoryBackend transaction() executes operation
4. Dummy API keys pre-populated for all providers (anthropic, openai, google, etc.)
5. getQuotaInfo returns expected values
6. requestPersistence returns true

**patchLit tests (3-4 tests):**
1. When no `agent-interface` element registered, patch is a no-op (no errors)
2. When Lit element exists with class-field-shadowed properties, patch removes own properties and restores via accessor
3. Calling patched performUpdate doesn't throw

**Acceptance criteria:**
- ~18-20 new tests across 3 files
- Tests pass with `cd pi-de && npx vitest run`
- 100% line coverage on initStorage.ts, >80% on SpawnModal.tsx
