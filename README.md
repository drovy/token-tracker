# token-tracker

A Claude Code mod that keeps count of the tokens you use, for the current session and across every session you have ever run.

- **Status line under the prompt:** `$0.44 session · $1.91 all-time · 1.50M tokens`, from the moment a chat opens and after every turn.
- **`/tokens` command:** opens a pane with three bubbles: this session, all time, and your recent sessions. Each total is split into input, output, cache read and cache write tokens.
- The pane opens by itself when a session starts.
- **Clawd the crab** goes where the action is and acts out what Claude is doing. It lives on the hint line under the text box, where it watches you type (its eyes follow the cursor, and it reacts to questions and bug reports). While Claude works it hops onto the row of each tool as it runs: reading, editing, running, browsing, failing. Select a message in the transcript and it goes to sit on it; when Claude asks you a question it sits on top of the dialog; click into the Token usage pane (or press **call Clawd here**) and it moves there to be petted. Left alone for two minutes it falls asleep. It can't reach the permission dialog, the tasks list, the diff panel or settings: mods can't draw there.
- Totals are saved in the mod's own store on your machine, so they survive restarts.
- **Sync between computers:** each computer also writes its totals to `OneDrive\Claude\token-tracker`, and the pane adds up every computer's file there. Install the mod on each computer and sign in to the same OneDrive. To use another synced folder (Dropbox, Google Drive), set the mod's **Sync folder** option; set it to `off` to keep totals on one machine. Nothing is sent anywhere except through that folder.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install token-tracker --marketplace drovy/token-tracker
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). In the desktop app, click + next to the prompt box, then Plugins, Add marketplace with `drovy/token-tracker`, then Add plugin.

Counting starts when the mod loads; tokens used before that are not included.
