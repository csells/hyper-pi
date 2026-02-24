# Roster grouping by project with PID display and working indicator

Restructure the roster to group agents by project directory, display PID when available, and show a working/idle indicator on the selected agent's roster card.

**Files to modify:**
- `pi-de/src/App.tsx` — Roster section (the `.node-list` div):
  1. **Grouping (F1):** Add `useMemo` to group `nodes` by `projectName(node.cwd)` into a `Map<string, NodeInfo[]>`. Add `collapsedGroups` state (`Set<string>`) with toggle function. Render grouped: `[...groupedNodes.entries()].map(([project, projectNodes]) => <div className="project-group"><button className="project-header" onClick={toggleGroup}>...</button>{!collapsed && projectNodes.map(renderCard)}</div>)`.
  2. **PID display (F7):** In node card metadata span, append: `{node.pid ? ` • PID: ${node.pid}` : ""}`. The `pid?: number` field is available from Task 1's protocol update.
  3. **Working indicator in roster (F2 roster part):** On the selected agent's card, conditionally add `working` class to status dot: `<span className={`status-dot ${node.status} ${activeNode?.id === node.id && agent.isAgentStreaming ? 'working' : ''}`} />`. Uses `isAgentStreaming` from `useAgent` (added by Task 3).
- `pi-de/src/App.css` — Add styles: `.project-group`, `.project-header` (transparent bg, flex layout, uppercase text), `.collapse-icon`, `.project-count` (badge with agent count). The `.status-dot.working` animation CSS is defined by Task 3.
- `pi-de/src/App.test.tsx` — Update `makeNode` to optionally include `pid`. Add tests: grouping renders project headers, collapse/expand toggles, PID displays when present, working dot class applied to selected streaming agent.

**Acceptance criteria:**
- Agents grouped by project name (last path segment of cwd)
- Each group has collapsible header with project name and agent count
- Groups default to expanded; clicking header toggles collapse
- PID shows in node card metadata when present (e.g., 'localhost:8080 • PID: 12345')
- PID absent gracefully when not available
- Selected agent's card shows pulsing yellow dot during streaming
- Non-selected agents keep static green/gray dots
- All existing App.test.tsx tests pass
- New tests pass: `cd pi-de && npm test`
- Build succeeds: `cd pi-de && npm run build`
