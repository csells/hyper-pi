# pi-de features

## quality of life

- I STILL can't enter a prompt while the agent is producing it's result!!!
- group chats under projects
- autocomplete for commands/skills when the user presses "/"
- autocomplete for at-file references (`@`)
- show the system pid for debugging
- show a working indicator of some kind
- scroll position when selecting an agent isn't at the bottom -- it's at some
  random spot, perhaps based on the previous scroll position from the last
  selected agent
- check that Spawn works
- why does the tool output look SO different from the tui UI?
- theming: support all of the pi agent themes
- need a cancel button AND a submit button during streaming responses
- show the name of the session as well as the project
  - make it easy to name the session
- what are the greyed out agents for? why do I want to click on dead agents and
  see no content?
- show the session as working or idle with a green or yellow dot respectively

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
