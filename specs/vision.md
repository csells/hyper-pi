# Hyper-Pi: Vision

## What Is Hyper-Pi?

Hyper-Pi is a decentralized, globally accessible control plane for autonomous AI
coding agents. Built on top of Mario Zechner's ultra-minimalist `pi` CLI engine,
it transforms isolated terminal-based agents into a coordinated mesh
network—observable, controllable, and accessible from any CLI, desktop browser,
or mobile device, anywhere in the world.

## The Problem

The `pi` coding agent is a brilliantly minimal CLI tool: you `cd` into a project
directory, run `pi`, and get an isolated, context-aware AI coding assistant. But
this simplicity creates limitations:

- **No remote access.** You must be at the terminal where `pi` is running.
- **No visibility across instances.** Running `pi` in three project folders
  gives you three isolated brains with no unified view.
- **No web interface.** There's no way to interact with a running `pi` instance
  from a browser.
- **No cross-machine coordination.** Agents on different machines can't discover
  or communicate with each other.

## The Solution

Hyper-Pi adds three lightweight layers on top of the unmodified `pi` engine:

1. **pi-socket** — A globally installed `pi` extension that exposes each CLI
   instance via a local WebSocket, enabling real-time I/O from any client.
2. **hypivisor** — A central Rust daemon that maintains a live registry of every
   running `pi` agent across all machines in the mesh.
3. **Pi-DE** — A responsive web dashboard (the "Pi IDE") that lets users browse,
   connect to, and interact with any agent from a single pane of glass.

## Core Philosophy

### Keep Pi Pure
Hyper-Pi never modifies the core `pi` engine. Everything is additive—a global
extension, an optional daemon, and an external web app. If the hypivisor isn't
running, `pi` works exactly as it always has. If it is running, your agents
silently upgrade into the mesh.

### Unix Composability
Each component is a small, single-purpose tool. `pi` is the brain. `pi-socket`
is the tether. `hypivisor` is the registry. Pi-DE is the viewport. They compose
cleanly and fail independently.

### Agents Are Indestructible
A `pi` agent runs until the user explicitly stops it. Network drops, browser
closures, and WebSocket disconnections are transient events that never kill an
agent or lose its state. The mesh is a viewport into the agents, not their
life-support system.

### Access From Anywhere
Whether you're at the terminal on your home server, on your phone at a coffee
shop via a Tailscale tunnel, or in a browser on a different continent—you see
the same live mesh and can interact with any agent.

## What This Enables

- **Local god-mode.** Run `pi` in three project folders on one machine; see and
  control all three from one browser tab.
- **Autonomous agent swarms.** Combine with `pi-messenger` (Nico Bailon's
  extension) for agent-to-agent communication. A lead agent delegates backend
  work to one agent and frontend work to another—all visible in real time.
- **Horizontal scaling across machines.** Sync the `pi-messenger` state
  directories across machines (via Syncthing, Tailscale, etc.) and agents
  coordinate across physical boundaries. The hypivisor aggregates all
  agents—local and remote—into a single dashboard.
- **Remote mobile access.** Tunnel into the hypivisor from any device. Review
  code an agent wrote overnight, approve a pending command, and close the
  browser. The swarm keeps working.
- **Spawn agents from the web.** Browse your file system from the Pi-DE, select
  or create a project folder, and deploy a new `pi` agent—all without touching a
  terminal.

## Naming Conventions

| Name | What It Is |
|------|-----------|
| **Hyper-Pi** | The project / overall system |
| **`pi`** | The CLI (Mario Zechner's unmodified pi-coding-agent) |
| **pi-socket** | The global `pi` extension providing WebSocket I/O |
| **hypivisor** | The central Rust registry daemon |
| **Pi-DE** | The web dashboard / IDE interface |

## Target Users

- Solo developers who run multiple `pi` instances across projects and want a
  unified view.
- Teams who want shared visibility into what their agents are doing across
  repos.
- Power users who want to orchestrate multi-agent coding workflows from
  anywhere.
- Anyone who wants the lightweight power of `pi` with the accessibility of a web
  IDE.
