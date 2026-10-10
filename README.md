# Snake Draft Copilot

A one-page helper for fantasy football snake drafts. It answers three questions while the clock runs:

1. **Who should I take right now?**
2. **Who can I wait on?** It uses ADP to estimate the chance a player is still there at your next pick.
3. **What should be in my queue?** One click copies a ranked list you can enter in your draft app's queue as a backup if your timer runs out.

**Live demo:** https://simibharaj.github.io/snake-draft-copilot/ (made-up sample players)

## Why it exists

I built the first version during a real draft and it was too much work: every pick had to be entered twice, once in the draft app and once in the tool, with 90 seconds per pick. What actually helped was simpler:

- One clear answer per pick
- Knowing which players would last until my next turn, so I could take the one who wouldn't
- Spotting bye-week pile-ups and injury tags
- A well-ordered queue in the draft app as a safety net

This version is built around those four things and asks for as little input as possible.

## How to use it

1. Set **Teams**, **Your pick** and **Rounds**.
2. Optional: load your league's projections as a CSV (see format below). Otherwise it uses the sample data.
3. During the draft, **paste** the draft board, pick list or chat into the paste box. Any player names it recognizes are marked as taken, so you don't enter picks one by one.
4. When you pick, tap **I took this** or type the name and press Enter.
5. Tap **Copy queue** and add those players to your draft app's queue.

Your progress is saved in your browser, so a refresh doesn't lose the draft.

## How it decides

| Factor | What it does |
|---|---|
| Value over waiver level | Points above roughly the last player at that position who usually gets drafted in a league your size |
| Roster need | Starters first, then FLEX, then bench. A second QB or TE is a backup, and a third is almost never suggested |
| Kicker and defense | Held until your last two picks |
| Will he last? | Each player's draft spot is modeled as a normal curve around their ADP. Among players with close scores, it suggests taking the one least likely to make it back to you |
| Bye weeks | Small penalty when a player shares a bye with players already on your roster |
| Injuries | Q, O, IR and similar tags lower the score |

The engine (`engine.js`) has no dependencies and is covered by tests, including full simulated drafts from every pick position that check the roster comes out balanced.

## CSV format

Headers can be in any order. `name`, `pos` and `proj` are required.

```csv
name,pos,team,bye,adp,proj,status
Jane Doe,WR,ABC,7,24.5,215.3,
Sam Roe,RB,XYZ,11,40.1,190.0,Q
```

- `pos`: QB, RB, WR, TE, K, DST (DEF works too)
- `proj`: season projected points in your league's scoring
- `status`: blank, Q, D, DTD, O, IR

## Run the tests

```bash
npm test
```

Requires Node 18 or newer. No install step.

## Notes

- The sample data is made up: fake players and fake teams. Use your own league's projections for a real draft.
- This is a fun side project, not betting or financial advice. Projections and ADP are estimates, and players still have bad weeks.
- Default roster: 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 D/ST. Change `DEFAULT_LEAGUE` in `engine.js` for other formats.
