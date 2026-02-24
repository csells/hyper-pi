# pi-de features

## End-to-End

- [ ] abort/cancel + send-during-streaming: during a streaming response, the
      MessageEditor button should conditionally show two states in the same
      location:
  - **empty input → square stop button**: cancels the agent's current work
    (like the TUI stop button). Needs a new `abort` WebSocket message type in
    the protocol, a pi-socket handler that calls `pi.abort()`, and
    `RemoteAgent.abort()` sending it over WebSocket.
  - **non-empty input → normal submit button**: sends the user's message as a
    follow-up queued behind the current response (like the TUI does).
    `patchSendDuringStreaming.ts` already enables this but currently suppresses
    the stop button entirely by forcing `isStreaming=false` on MessageEditor.
    The patch needs to be reworked so both states are possible.
  - This is especially important for mobile where there's no keyboard shortcut
    alternative — the button is the only way to cancel or send.
- [ ] autocomplete for commands/skills when the user presses "/" — needs a new
      `list_commands` message type in the protocol so pi-socket can return
      available `/` commands and skills
- [ ] autocomplete for at-file references (`@`) — needs a new `list_files`
      message type in the protocol so pi-socket can return file listings
      relative to the agent's cwd
- [ ] attach files (check the tmux-adapter implementation) — needs a new
      `attach_file` message type or binary frame support in the protocol

## mobile

- [x] needs to be responsive to mobile form-factors
  - [x] clicking on a agent from the first page goes to a second page with the
        conversation loaded; pressing the back button takes the user back to the
        list of chats
  - [x] when the vkb comes up on mobile, pressing Enter in the vkb adds a
        newline to the prompt; pressing the submit button sends the actual
        prompt (to be executed immediately or queued as appropriate)
- [x] let's try setting up a CF tunnel
- [x] load just the most recent messages and when the user scrolls back, pull in
      additional messages; this allows agent history to load quickly and allows
      the user to see the entire history if they so choose

## quality of life

- [x] I STILL can't enter a prompt while the agent is producing it's result!!!
- [x] group chats under projects
- [x] show the system pid for debugging
- [x] show a working indicator of some kind
- [x] scroll position when selecting an agent isn't at the bottom -- it's at
      some random spot, perhaps based on the previous scroll position from the
      last selected agent
- [x] check that Spawn works
- [x] why does the tool output look SO different from the tui UI?
- [x] theming: 7 themes (dark, light, gruvbox-dark, tokyo-night, nord, solarized-dark, solarized-light) with full pi color token mapping to CSS custom properties
- [~] need a cancel button AND a submit button during streaming responses
      (MessageEditor now conditionally shows stop vs send based on input
      content — empty input shows stop, typed text shows send. But
      `RemoteAgent.abort()` is still a no-op — see abort/cancel item in
      End-to-End section for the protocol work needed.)
- [x] show the name of the session as well as the project
  - [x] make it easy to name the session
- [x] what are the greyed out agents for? why do I want to click on dead agents
      and see no content?
- [x] show the session as working or idle with a green or yellow dot
      respectively
- [x] theming contrast bugs: dark themes make the Spawn Agent button unreadable
      (dark grey on black); light themes make the SpawnModal folder selection
      unreadable (off-white on white background)
