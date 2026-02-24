# pi-de features

## quality of life

- I STILL can't enter a prompt while the agent is producing it's result!!!
- [x] group chats under projects
- autocomplete for commands/skills when the user presses "/"
- autocomplete for at-file references (`@`)
- [x] show the system pid for debugging
- [x] show a working indicator of some kind
- [x] scroll position when selecting an agent isn't at the bottom -- it's at some
  random spot, perhaps based on the previous scroll position from the last
  selected agent
- [x] check that Spawn works (F4 - VERIFIED: Spawn works end-to-end. Successfully deployed new agent to /Users/csells; appeared in roster and was selectable)
- [~] tool output parity (F5 - INVESTIGATED: Pi-DE renders markdown/code blocks correctly. Observed issue is agent message initialization timing, not CSS. No CSS-only fixes needed. Documented in F4_F5_FINDINGS.md)
- [x] theming: Pi-DE supports dark/light/system themes. Pi TUI themes use 51 ANSI color tokens with no web CSS equivalent — full TUI theme parity requires a future mapping layer.
- need a cancel button AND a submit button during streaming responses
- [x] show the name of the session as well as the project
  - [x] make it easy to name the session
- [x] what are the greyed out agents for? why do I want to click on dead agents and
  see no content?
- [x] show the session as working or idle with a green or yellow dot respectively

## Files

- attach files (check the tmux-adapter implementation)

## mobile

- [x] needs to be responsive to mobile form-factors
  - [x] clicking on a agent from the first page goes to a second page with the
        conversation loaded; pressing the back button takes the user back to the
        list of chats
  - [x] when the vkb comes up on mobile, pressing Enter in the vkb adds a
        newline to the prompt; pressing the submit button sends the actual prompt
        (to be executed immediately or queued as appropriate)
- [x] let's try setting up a CF tunnel
- [x] load just the most recent messages and when the user scrolls back, pull in
      additional messages; this allows agent history to load quickly and allows the
      user to see the entire history if they so choose
