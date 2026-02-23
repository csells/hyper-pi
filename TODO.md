# pi-de features

## architecture

- why the heck are you picking and choosing what messages to send???
- architectural best practices
- harden!

## mobile

- I STILL can't enter a prompt while the agent is producing it's result!!!
- needs to be responsive to mobile form-factors
  - clicking on a agent from the first page goes to a second page with the
    conversation loaded; pressing the back button takes the user back to the
    list of chats
  - when the vkb comes up on mobile, pressing Enter in the vkb adds a newline to
    the prompt; pressing the submit button sends the actual prompt (to be
    executed immediately or queued as appropriate)
- let's try setting up a CF tunnel
- group chats under projects
- chat that Spawn works
- why does the tool output look SO different from the tui UI?
- theming: light, dark, system and keep it between sessions
- need a cancel button AND a submit button during streaming responses
- show the name of the session as well as the project
  - make it easy to name the session
- load just the most recent messages and when the user scrolls back, pull in
  additional messages; this allows agent history to load quickly and allows the
  user to see the entire history if they so choose
  pi
- what are the greyed out agents for?

## files

- attach files (check the tmux-adapter implementation)
