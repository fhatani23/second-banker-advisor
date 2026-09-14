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


## Rolling progression update

The progression now carries across trigger cycles:

- First triggered cycle: 1u → 2u → 3u.
- If all three lose, stop betting and wait for the next Banker trigger.
- The next cycle starts at the last unit reached, so 3u → 4u → 5u.
- If that whole cycle loses, the next cycle starts 5u → 6u → 7u.
- When Banker wins, the next cycle starts at winning unit minus 1.
- Minimum start is always 1 unit.
- Ties remain pushes and repeat the same unit/attempt.

Examples:
- Win at 5u → next trigger starts 4u → 5u → 6u.
- Win at 4u → next trigger starts 3u → 4u → 5u.
- Win at 1u → next trigger still starts at 1u.
