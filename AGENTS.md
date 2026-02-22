# Hyper-Pi

Decentralized control plane for pi coding agents: a WebSocket extension (pi-socket), a Rust registry daemon (hypivisor), and a React web dashboard (Pi-DE).

## Components

| Component | Tech | Location |
|-----------|------|----------|
| pi-socket | TypeScript (pi extension) | `pi-socket/` |
| hypivisor | Rust (Axum + Tokio) | `hypivisor/` |
| Pi-DE | React + Vite + TypeScript | `pi-de/` |

## Key Constraint

pi itself is never modified. Everything is additive — a global extension, an external daemon, and an external web app.

## Specs

All design decisions, requirements, and architecture are in `specs/`:

- `specs/vision.md` — project philosophy and naming conventions
- `specs/requirements.md` — 60+ requirements across all components
- `specs/design.md` — full architecture, protocols, and reference implementations

Read the relevant spec before implementing or modifying any component.

Each component has its own `AGENTS.md` with build commands.

## Architecture Best Practices

- **TDD** — write tests first; code isn't done until tests pass.
- **DRY** — extract shared utilities; no duplicated logic.
- **Separation of Concerns** — each module handles one distinct responsibility.
- **SRP** — every class/module/function/file has exactly one reason to change.
- **Clear Abstractions & Contracts** — small, stable interfaces; hide implementation details.
- **Low Coupling, High Cohesion** — self-contained modules, minimal cross-dependencies.
- **Scalability & Statelessness** — design for horizontal scale; prefer stateless services.
- **Observability & Testability** — logging, metrics, tracing; unit/integration testable.
- **KISS** — keep solutions as simple as possible.
- **YAGNI** — no speculative complexity or over-engineering.
- **Don't Swallow Errors** — never silently catch exceptions, fill in missing values, or add timeouts for hangs. Errors must be visible so root causes can be found.
- **No Placeholder Code** — production code only, not stubs or toys.
- **No Comments for Removed Functionality** — source implements current requirements only; history lives in git.
- **Layered Architecture** — clear tiers; each layer depends only on the one(s) below it.
- **Prefer Non-Nullable Variables** — use nullability sparingly.
- **Prefer Async Notifications** — over inefficient polling.
- **First Principles** — assess architecture against what you'd build from scratch.
- **Eliminate Race Conditions** — no dropped or corrupted data.
- **Write for Maintainability** — clear, readable code for future developers.
- **Arrange Idiomatically** — follow language/framework conventions for lints, static analysis, folder structure, and gitignore.
