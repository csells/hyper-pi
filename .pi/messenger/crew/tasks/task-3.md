# Stage improvements — header, offline handling, scroll fix, and working indicator

Enhance the stage area with an informative header (F3), proper offline agent handling (F4), scroll-to-bottom on agent selection (F5), and a working/idle status indicator in the stage header (F2 stage part).

**Files to modify:**
- `pi-de/src/useAgent.ts` — Add `isAgentStreaming: boolean` React state. Subscribe to `remoteAgent` events and update: `const [isAgentStreaming, setIsAgentStreaming] = useState(false);` with `useEffect(() => { const unsub = remoteAgent.subscribe(() => setIsAgentStreaming(remoteAgent.state.isStreaming)); return unsub; }, [remoteAgent]);`. Add to `UseAgentReturn` interface and return value.
- `pi-de/src/useAgent.test.ts` — Add tests for `isAgentStreaming` state updates.
- `pi-de/src/App.tsx` — Stage section changes (the `.main-stage` div):
  1. **Session name (F3):** Add `sessionName` state initialized from `localStorage.getItem('pi-de-session-' + activeNode.id) || projectName(activeNode.cwd)`. Render as `<input className="session-name-input" value={sessionName} onChange={...} />` in stage header. Save to localStorage on change.
  2. **Header layout (F3):** Replace `<h3>{activeNode.cwd}</h3>` with structured header: project name, session name input, machine:port metadata, status dot.
  3. **Offline view (F4):** When `agent.status === "offline"`, render `<div className="offline-stage">` with Agent Offline message and last known info instead of `<agent-interface>`.
  4. **Scroll fix (F5):** After `onInitState` fires, scroll `.overflow-y-auto` container to bottom: `requestAnimationFrame(() => { const el = agentInterfaceRef.current?.querySelector('.overflow-y-auto'); if (el) el.scrollTop = el.scrollHeight; });`
  5. **Working dot (F2):** Add `<span className={`status-dot ${agent.isAgentStreaming ? 'working' : 'active'}`} />` in stage header.
- `pi-de/src/App.css` — Add styles: `.session-name-input`, `.offline-stage`, `.header-info`, `.header-meta`, `.status-dot.working` (pulsing yellow: `background-color: #eab308; animation: pulse 1.5s ease-in-out infinite;`), `@keyframes pulse`.
- `pi-de/src/App.test.tsx` — Add tests for session name, offline view, working dot.

**Exported symbols:**
- `useAgent.ts`: adds `isAgentStreaming: boolean` to `UseAgentReturn`

**Acceptance criteria:**
- `isAgentStreaming` updates reactively when RemoteAgent streams/stops
- Stage header shows project name prominently, editable session name, machine:port metadata
- Session name persists in localStorage keyed by `pi-de-session-{nodeId}`
- Session name defaults to project name (last path segment of cwd)
- Offline agent selected → 'Agent Offline' message with last known info, no empty chat
- Chat scrolls to bottom when selecting a new agent (after init_state)
- Pulsing yellow dot in stage header when streaming, static green when idle
- Tests pass: `cd pi-de && npm test`
- Build succeeds: `cd pi-de && npm run build`
