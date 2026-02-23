# Cross-channel message visibility and TUI interaction tests

Test the cross-channel guarantee: messages sent from the web appear in TUI output, messages sent from TUI appear in web WebSocket events. Uses tmux sendkeys for TUI interaction.

**Files to create/modify:**
- `integration-tests/src/cross-channel.test.ts` (new — ~200 lines)

**Tests (5-7 tests):**
1. **Web → TUI visibility:** Send a message via proxy WebSocket, use `tmux capture-pane` to verify the message text appears in pi's TUI output
2. **TUI → Web visibility:** Use `tmux send-keys` to type a message in pi's TUI, verify `message_start` event with role "user" and matching content arrives on connected proxy WebSocket client
3. **TUI response → Web events:** Type a prompt in TUI via sendkeys, verify assistant response events (message_start, message_update, message_end) appear on WebSocket client
4. **Concurrent clients:** Web client + TUI both active, send from web → verify TUI shows it; send from TUI → verify web client gets event
5. **Follow-up from web while TUI-initiated turn is streaming:** TUI starts a prompt, web sends a follow-up during streaming → both messages eventually appear in conversation

**TUI interaction approach:**
- `tmux send-keys -t {session} "message text" Enter` to type into pi
- `tmux capture-pane -t {session} -p` to read TUI output
- Poll `capture-pane` output with timeout for expected text
- Use unique marker strings (e.g., `XTEST_abc123`) to avoid false matches

**Acceptance criteria:**
- Tests pass with `cd integration-tests && npm test -- --testPathPattern cross-channel`
- TUI interaction is reliable (polling, not fixed delays)
- All tmux sessions cleaned up
