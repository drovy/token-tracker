# token-tracker

A Claude Code mod that keeps count of the tokens you use, for the current session and across every session you have ever run.

- **Status line:** `Tokens: 12.3k session · 4.56M all-time`, updated after every turn.
- **`/tokens` command:** opens a pane with three bubbles: this session, all time, and your recent sessions. Each total is split into input, output, cache read and cache write tokens.
- The pane opens by itself when a session starts.
- Totals are saved in the mod's own store on your machine, so they survive restarts.
- **Sync between computers:** each computer also writes its totals to `OneDrive\Claude\token-tracker`, and the pane adds up every computer's file there. Install the mod on each computer and sign in to the same OneDrive. To use another synced folder (Dropbox, Google Drive), set the mod's **Sync folder** option; set it to `off` to keep totals on one machine. Nothing is sent anywhere except through that folder.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install token-tracker --marketplace drovy/token-tracker
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). In the desktop app, click + next to the prompt box, then Plugins, Add marketplace with `drovy/token-tracker`, then Add plugin.

Counting starts when the mod loads; tokens used before that are not included.
