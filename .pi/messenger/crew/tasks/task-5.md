# Message round-trip integration tests (Web → Agent → Web)

Test the full message flow: send a message to a pi agent through the hypivisor proxy WebSocket, verify the agent processes it, and verify response events flow back through the proxy.

**Files to create/modify:**
- `integration-tests/src/message-roundtrip.test.ts` (new — ~150 lines)

**Tests (5-7 tests):**
1. **Send text through proxy → agent receives it:** Connect to `/ws/agent/{nodeId}`, receive `init_state`, send plain text message, verify agent begins processing (message_start event flows back)
2. **Full turn round-trip:** Send a simple prompt ("What is 2+2?"), verify message_start (user), message_start (assistant), streaming message_update deltas, message_end all flow back through proxy
3. **init_state contains conversation history:** After a round-trip, disconnect and reconnect to same agent → init_state messages array includes the previous exchange
4. **Multiple clients see same events:** Connect 2 proxy clients to same agent, send message from client A, verify client B also receives broadcast events
5. **Follow-up message while streaming:** Send a message, then immediately send another → second message delivered as followUp (verified by both appearing in conversation)
6. **Tools list in init_state:** init_state.tools array is non-empty and contains expected tools (bash, read, etc.)

**Infrastructure:**
- Reuse `pi-agent-helpers.ts` from Task 4 to start real pi agents in tmux
- Connect to agent through hypivisor proxy: `ws://localhost:{hvPort}/ws/agent/{nodeId}`
- Use `BufferedWs` from existing helpers for message queuing

**Acceptance criteria:**
- Tests pass with `cd integration-tests && npm test -- --testPathPattern message-roundtrip`
- Tests are deterministic (polling with timeout, not fixed delays)
- Clean up all WebSocket connections and tmux sessions
