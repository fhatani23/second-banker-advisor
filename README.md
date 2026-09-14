# Second Banker Advisor — Improved No-Node Version

No Node.js or npm required. Open `index.html` directly in your browser.

## Core strategy
- Wait for 2+ consecutive Player results.
- Wait for Banker to break the Player streak.
- That first Banker is the trigger only.
- Bet Banker on the next hand.
- Progression: 1 unit → 2 units → 3 units.
- If Level 3 also loses, stop betting.
- The resulting PPP becomes the new qualifying Player streak.
- Wait for the next Banker trigger.
- Tie is neutral; on an active Banker bet it is treated as a push.

## Improvements in this version
- Better mobile layout
- Voice alerts
- Cycle win-rate tracking
- Level 1 / 2 / 3 win counts
- Average cycle result
- Maximum drawdown
- Player / Banker / Tie counters
- Session history
- CSV export
- Improved advisor highlighting
- Safer undo/reset behavior
- Persistent localStorage

## Run
Extract all files into one folder and open `index.html`.

## Files
- index.html
- styles.css
- app.js
- README.md
