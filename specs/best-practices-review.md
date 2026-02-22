# Hyper-Pi: Best Practices Review

Consolidated findings from three independent AI code reviewers (Claude Sonnet, OpenAI o3, Gemini 2.5 Pro) assessing all implementation code against the Architecture Best Practices in AGENTS.md.

---

## Consolidated Compliance Matrix

| Practice | Claude | Codex | Gemini | Consensus |
|----------|--------|-------|--------|-----------|
| **TDD** | ❌ | ❌ | ❌ | ❌ No tests in any component |
| **DRY** | ⚠️ | ⚠️ | ⚠️ | ⚠️ Duplicated event-processing logic in App.tsx |
| **Separation of Concerns** | ⚠️ | ⚠️ | ⚠️ | ⚠️ App.tsx is a monolith; hypivisor main.rs does too much |
| **SRP** | ⚠️ | ⚠️ | ⚠️ | ⚠️ Same as above — extract hooks and modules |
| **Clear Abstractions** | ⚠️ | ⚠️ | ⚠️ | ⚠️ Heavy use of `any` in TypeScript; no traits in Rust |
| **Low Coupling, High Cohesion** | ⚠️ | ⚠️ | ⚠️ | ⚠️ UI tightly coupled to connection management |
| **Scalability & Statelessness** | ❌ | ⚠️ | ⚠️ | ⚠️ In-memory registry by design (see note below) |
| **Observability & Testability** | ❌ | ❌ | ❌ | ❌ No structured logging, metrics, or tracing |
| **KISS** | ✅ | ✅ | ✅ | ✅ Clean, straightforward architecture |
| **YAGNI** | ✅ | ✅ | ✅ | ✅ No speculative features |
| **Don't Swallow Errors** | ❌ | ❌ | ❌ | ❌ Multiple silent catches across all components |
| **No Placeholder Code** | ✅ | ✅ | ✅ | ✅ All production code |
| **No Comments for Removed Functionality** | ✅ | ✅ | ✅ | ✅ Clean |
| **Layered Architecture** | ✅ | ✅ | ✅ | ✅ Extension → Daemon → UI layering |
| **Prefer Non-Nullable** | ⚠️ | ⚠️ | ⚠️ | ⚠️ Excessive `| null` in React state |
| **Async Notifications** | ✅ | ✅ | ✅ | ✅ WebSocket push throughout |
| **First Principles** | ✅ | ✅ | ✅ | ✅ Sound architectural decisions |
| **Eliminate Race Conditions** | ⚠️ | ⚠️ | ⚠️ | ⚠️ Stale closures in reconnect; broadcast iteration |
| **Write for Maintainability** | ⚠️ | ⚠️ | ⚠️ | ⚠️ App.tsx complexity; `any` types hinder understanding |
| **Arrange Idiomatically** | ⚠️ | ⚠️ | ⚠️ | ⚠️ No linter, formatter, or static analysis configs |

**Scorecard:** 7 ✅ / 10 ⚠️ / 3 ❌

> **Note on Scalability:** The design spec (specs/design.md §"No hypivisor persistence") explicitly states in-memory registry is intentional — agents re-register via reconnect loop. This is a design decision, not a bug. However, all three reviewers flagged it, so it should be acknowledged as a known limitation.

---

## Critical Issues (all three reviewers agree)

### 1. No Tests — TDD Violation
**Severity:** Critical
**All components lack:** test files, test scripts, test dependencies, test infrastructure.

**Recommendations:**
- **pi-socket:** Add vitest. Unit test `buildInitState()`, broadcast logic, reconnect behavior.
- **hypivisor:** Add `#[cfg(test)]` module and integration tests in `tests/`. Test RPC dispatch, path validation, stale cleanup.
- **pi-de:** Add vitest + @testing-library/react. Test `rebuildHistory()`, `rpcCall()`, event handlers.

### 2. Silent Error Swallowing
**Severity:** Critical
**Locations identified by all three reviewers:**

| File | Location | Issue |
|------|----------|-------|
| `pi-socket/src/index.ts` | `catch {}` in `connectToHypivisor` | Catches and discards all errors |
| `pi-socket/src/index.ts` | `.on("error", () => {})` | Empty error handler |
| `pi-de/src/rpc.ts` | `setTimeout` timeout | Masks underlying hang causes |
| `hypivisor/src/main.rs` | `.unwrap()` on locks | Panics on poisoned mutex instead of recovery |

### 3. No Observability
**Severity:** Critical
**All three reviewers flagged:** Only `eprintln!` in Rust, only `ctx.ui.notify` in TypeScript. No structured logging, no metrics, no distributed tracing.

---

## Warnings (≥2 reviewers agree)

### 4. DRY Violation: Duplicated Event Processing
**File:** `pi-de/src/App.tsx`
**Issue:** `rebuildHistory()` (lines 13-49) and the inline `ws.onmessage` handler (lines 104-136) contain nearly identical switch/case logic for delta, tool_start, tool_end events.
**Fix:** Extract a shared `applyEvent(chat, event)` function.

### 5. SRP Violation: App.tsx Monolith
**File:** `pi-de/src/App.tsx` (~280 lines)
**Issue:** Handles hypivisor connection, agent connection, state management, input handling, and rendering.
**Fix:** Extract `useHypivisor()` and `useAgent()` custom hooks. Keep App.tsx as pure composition.

### 6. SRP Violation: main.rs Monolith
**File:** `hypivisor/src/main.rs` (~310 lines)
**Issue:** CLI parsing, app state, WebSocket handler, RPC dispatch, auth, file browsing, process spawning, stale cleanup all in one file.
**Fix:** Split into modules: `rpc.rs`, `auth.rs`, `fs_browser.rs`, `spawn.rs`, `cleanup.rs`.

### 7. Excessive `any` Types
**Files:** `pi-socket/src/index.ts`, `pi-de/src/App.tsx`, `pi-de/src/rpc.ts`
**Issue:** `any` used extensively for event payloads, RPC params, init state. Defeats TypeScript's value.
**Fix:** Define typed interfaces for all WebSocket message payloads.

### 8. Race Conditions
- **Stale closure in reconnect:** `pi-de/src/App.tsx` reconnect setTimeout captures node by value; may reconnect to wrong node if active node changes during delay.
- **Broadcast iteration:** `pi-socket/src/index.ts` iterates `wss.clients` which can be modified concurrently; should snapshot to array first.

### 9. Missing Linter/Formatter Configuration
**Issue:** No ESLint, Prettier, rustfmt.toml, or clippy CI configuration.
**Fix:** Add `.eslintrc.json` + `.prettierrc` for both TS projects; add `rustfmt.toml` + clippy deny for Rust.

### 10. Excessive Nullable State
**File:** `pi-de/src/App.tsx`
**Issue:** `activeNode: NodeInfo | null`, `hvWsRef: WebSocket | null`, etc. create cascading null checks.
**Fix:** Use discriminated union state machines or non-null assertion patterns where lifecycle guarantees existence.

---

## Recommendations (prioritized)

### Priority 1: Fix Before Next Feature

1. **Add test infrastructure to all three projects.** This is the single biggest gap.
   - `pi-socket`: `vitest` + mock WebSocket
   - `hypivisor`: native `#[tokio::test]` + integration tests
   - `pi-de`: `vitest` + `@testing-library/react`

2. **Fix error swallowing.** Every `catch {}` and empty `.on("error")` must log the error with context. Remove bare `catch` blocks.

3. **Add structured logging.**
   - Rust: `tracing` + `tracing-subscriber`
   - TypeScript: at minimum `console.error` with context; ideally a small logger wrapper

### Priority 2: Improve Code Organization

4. **Extract React hooks** from App.tsx: `useHypivisor()`, `useAgent()`, and a shared `applyEvent()` function.

5. **Split hypivisor/src/main.rs** into modules. At minimum: `main.rs` (startup), `rpc.rs` (dispatch + handlers), `state.rs` (AppState + NodeInfo).

6. **Type the WebSocket message payloads.** Replace `any` with discriminated union types for all agent events and RPC messages.

### Priority 3: Harden

7. **Add linter/formatter configs.** ESLint + Prettier for TS, rustfmt + clippy for Rust.

8. **Fix race conditions.** Snapshot `wss.clients` before iterating; use refs for latest node in reconnect timers.

9. **Add graceful shutdown** to hypivisor (handle SIGTERM/SIGINT).

10. **Add a health check endpoint** to hypivisor (`/health` or JSON-RPC `ping` method).

---

## Summary

The Hyper-Pi codebase demonstrates **strong architectural foundations**: clean layered separation (extension → daemon → dashboard), correct use of async WebSocket push (no polling), and disciplined scope (no over-engineering). The protocol design is sound and the code compiles cleanly across all three languages/frameworks.

However, **three critical gaps** were unanimously flagged by all reviewers: (1) zero test coverage, (2) silent error swallowing that will make production debugging impossible, and (3) no structured observability. These must be addressed before the code can be considered production-ready.

The secondary issues — monolithic files violating SRP, duplicated logic, excessive `any` types, and missing linter configs — are all straightforward to fix and will significantly improve maintainability as the codebase grows.
