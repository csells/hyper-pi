#!/usr/bin/env python3
"""Inspect all pi agents registered with the hypivisor.

Connects to the hypivisor WebSocket to get the node roster, then connects
to each agent's pi-socket to retrieve conversation state. Outputs a JSON
array of agent summaries to stdout.

Usage:
    python3 inspect-agents.py [--hypivisor-port PORT] [--filter-cwd PATH] [--timeout SECS]

Dependencies: websocat (brew install websocat)
"""

import argparse
import json
import os
import re
import subprocess
import sys

WEBSOCAT_BUF = 2_097_152  # 2MB - pi-socket init states can be large
DEFAULT_PORT = 31415
DEFAULT_TIMEOUT = 5


def websocat_recv(url: str, timeout: int = DEFAULT_TIMEOUT) -> str | None:
    """Connect to a WebSocket, receive the first message, and disconnect."""
    try:
        result = subprocess.run(
            ["websocat", "-B", str(WEBSOCAT_BUF), "-U", "-1", url],
            capture_output=True,
            timeout=timeout,
        )
        if result.returncode == 0 and result.stdout:
            return result.stdout.decode("utf-8", errors="replace")
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return None


def get_node_roster(port: int) -> list[dict]:
    """Fetch the node roster from the hypivisor init event."""
    raw = websocat_recv(f"ws://localhost:{port}/ws")
    if not raw:
        return []
    raw = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return data.get("nodes", [])


def parse_init_state(raw: str) -> dict:
    """Extract conversation summary from a pi-socket init state message."""
    raw = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"error": "unparseable"}

    msgs = data.get("messages", [])
    streaming = data.get("streaming", False)

    user_msgs = [m for m in msgs if m.get("role") == "user"]
    asst_msgs = [m for m in msgs if m.get("role") == "assistant"]

    def extract_text(content, max_len=300) -> str:
        if isinstance(content, list):
            texts = [c.get("text", "") for c in content if c.get("type") == "text"]
            return " ".join(texts)[:max_len].replace("\n", " ").strip()
        return str(content)[:max_len].replace("\n", " ").strip()

    def extract_tools(content) -> list[str]:
        if isinstance(content, list):
            return [c.get("name", "?") for c in content if c.get("type") == "tool_use"]
        return []

    # Find last substantive user message (skip trivial/empty)
    last_user = ""
    for m in reversed(msgs):
        if m.get("role") != "user":
            continue
        text = extract_text(m.get("content", ""))
        if len(text) > 5:
            last_user = text[:200]
            break

    # Find last assistant text
    last_asst = ""
    last_tools = []
    for m in reversed(msgs):
        if m.get("role") != "assistant":
            continue
        content = m.get("content", "")
        text = extract_text(content)
        tools = extract_tools(content)
        if text:
            last_asst = text[:200]
        last_tools = tools
        break

    return {
        "total_msgs": len(msgs),
        "user_msgs": len(user_msgs),
        "asst_msgs": len(asst_msgs),
        "streaming": streaming,
        "last_user": last_user,
        "last_assistant": last_asst,
        "last_tools": last_tools,
    }


def inspect_agent(node: dict, timeout: int) -> dict:
    """Connect to a single agent's pi-socket and return its summary."""
    port = node["port"]
    raw = websocat_recv(f"ws://localhost:{port}", timeout=timeout)
    summary = {
        "id": node.get("id", ""),
        "machine": node.get("machine", ""),
        "port": port,
        "cwd": node.get("cwd", ""),
        "project": os.path.basename(node.get("cwd", "")),
        "status": node.get("status", ""),
    }
    if raw is None:
        summary["error"] = "no response"
        return summary
    summary.update(parse_init_state(raw))
    return summary


def main():
    parser = argparse.ArgumentParser(description="Inspect running pi agents")
    parser.add_argument(
        "--hypivisor-port", type=int, default=DEFAULT_PORT, help=f"Hypivisor port (default: {DEFAULT_PORT})"
    )
    parser.add_argument("--filter-cwd", type=str, default=None, help="Only show agents with this cwd prefix")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help=f"WebSocket timeout in seconds (default: {DEFAULT_TIMEOUT})")
    parser.add_argument("--json", action="store_true", help="Output raw JSON instead of table")
    args = parser.parse_args()

    nodes = get_node_roster(args.hypivisor_port)
    if not nodes:
        print("No agents found (is hypivisor running?)", file=sys.stderr)
        sys.exit(1)

    if args.filter_cwd:
        nodes = [n for n in nodes if n.get("cwd", "").startswith(args.filter_cwd)]

    results = [inspect_agent(n, args.timeout) for n in nodes]

    if args.json:
        json.dump(results, sys.stdout, indent=2)
        print()
        return

    # Table output
    for r in sorted(results, key=lambda x: x["port"]):
        port = r["port"]
        proj = r["project"]
        err = r.get("error")
        if err:
            print(f"  :{port}  {proj:20s}  ☠️  {err}")
            continue
        status = "STREAMING" if r.get("streaming") else "idle"
        msgs = r.get("total_msgs", 0)
        user = r.get("last_user", "")
        summary = user if user else r.get("last_assistant", "(no text)")
        if len(summary) > 80:
            summary = summary[:77] + "..."
        print(f"  :{port}  {proj:20s}  [{status:9s}] {msgs:3d} msgs  {summary}")


if __name__ == "__main__":
    main()
