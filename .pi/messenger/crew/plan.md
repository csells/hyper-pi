The task plan is complete. Here's the summary:

## Task Execution Plan

| Wave | Tasks | Description |
|------|-------|-------------|
| **Wave 1** | Tasks 1, 2, 3 | PID field (cross-component), Theming (new hook + CSS), Stage improvements (header/offline/scroll) — all independent |
| **Wave 2** | Task 4 | Roster grouping (depends on Tasks 1 & 3 for PID type + `isAgentStreaming` state) |

**Critical path: 2 waves**

### Task dependency graph:
```
Task 1 (PID)  ──────┐
Task 2 (Theming)     │ (independent)
Task 3 (Stage)  ─────┼──→ Task 4 (Roster)
```

### Key design decisions:
- **F2 (working/idle indicator) split across Tasks 3 & 4**: Task 3 adds `isAgentStreaming` to `useAgent` + stage dot + CSS animation. Task 4 uses it for roster card dot.
- **No standalone types/config task**: Task 1 owns the full PID stack (protocol → pi-socket → hypivisor). Task 3 owns the `useAgent` streaming state addition alongside its real UI work.
- **File conflict minimization**: Tasks 1 (protocol/backend), 2 (hook + CSS vars), and 3 (stage section) touch non-overlapping file sections. Task 4 waits for both 1 and 3 to serialize App.tsx roster changes.