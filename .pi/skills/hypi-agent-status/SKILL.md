---
name: hypi-agent-status
description: Inspect all running pi agents via the hypivisor and pi-socket WebSockets. Shows what each agent is doing — conversation state, message counts, streaming status, last user prompt. Use when asked to check agent status, list running agents, see what agents are doing, summarize agent activity, or before killing/managing agents. Triggers on "what are the agents doing", "agent status", "inspect agents", "list agents", "check agents".
---

# Agent Inspector

Inspect running pi agents by querying the hypivisor roster and each agent's pi-socket init state.

## Quick usage

```bash
# All agents — table view
python3 .pi/skills/hypi-agent-status/scripts/inspect-agents.py

# Only agents in a specific directory
python3 .pi/skills/hypi-agent-status/scripts/inspect-agents.py --filter-cwd /Users/csells/Code/csells/hyper-pi

# Raw JSON for programmatic use
python3 .pi/skills/hypi-agent-status/scripts/inspect-agents.py --json

# Custom hypivisor port
python3 .pi/skills/hypi-agent-status/scripts/inspect-agents.py --hypivisor-port 39997
```

## How it works

1. Connects to `ws://localhost:31415/ws` — the hypivisor sends an `init` event containing the full node roster (id, machine, port, cwd, status)
2. For each node, connects to `ws://localhost:{port}` — pi-socket sends an `init` event with the full conversation history (messages array, streaming flag)
3. Parses each conversation to extract: message counts by role, last user prompt, last assistant text, active tool calls, streaming status

## Key details

- Uses `websocat -B 2097152` — pi-socket init states can exceed 500KB for long conversations; the default 64KB buffer silently truncates
- Strips control characters (tool output often contains raw terminal escapes) before JSON parsing
- Requires `websocat` (`brew install websocat`)

## When managing agents (killing, filtering)

**Always use `--filter-cwd` or the JSON output to identify agents by project before killing.** Each agent's `cwd` field distinguishes projects — never kill all `pi` processes indiscriminately. Cross-reference the `port` field with `lsof -iTCP:{port} -sTCP:LISTEN -t` to get the OS PID for targeted kills.

```bash
# Safe kill pattern: only agents in a specific project
python3 .pi/skills/hypi-agent-status/scripts/inspect-agents.py --json \
  | python3 -c "
import sys, json, subprocess
agents = json.load(sys.stdin)
for a in agents:
    if a['cwd'].startswith('/target/project/path'):
        port = a['port']
        result = subprocess.run(['lsof', '-iTCP:'+str(port), '-sTCP:LISTEN', '-t'], capture_output=True, text=True)
        pid = result.stdout.strip()
        if pid:
            print(f'kill {pid}  # :{port} {a.get(\"project\",\"\")}')
"
```
