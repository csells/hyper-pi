# pi-de features

## End-to-End

- [x] abort/cancel + send-during-streaming: abort WebSocket message type added to protocol;
      pi-socket calls ctx.abort(); RemoteAgent.abort() sends { type: 'abort' } over WebSocket.
      MessageEditor conditionally shows stop button (empty input) or send button (typed text)
      based on patchSendDuringStreaming.ts.
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
- [x] need a cancel button AND a submit button during streaming responses
      (MessageEditor conditionally shows stop vs send based on input content —
      empty input shows stop, typed text shows send. RemoteAgent.abort() now
      sends abort message over WebSocket to cancel agent work.)
- [x] show the name of the session as well as the project
  - [x] make it easy to name the session
- [x] what are the greyed out agents for? why do I want to click on dead agents
      and see no content?
- [x] show the session as working or idle with a green or yellow dot
      respectively
- [x] theming contrast bugs: dark themes make the Spawn Agent button unreadable
      (dark grey on black); light themes make the SpawnModal folder selection
      unreadable (off-white on white background)
