# 🐜✈️🦖 Anthill Airways

**Start as an ant. End up running an airline to an island full of dinosaurs.**

An idle arcade tycoon (walk around, stack stuff on your back, unlock new land) with
**gate runs**: send your goods down a lane through `+ / x / - / ÷ / ?` gates to grow
(or shrink!) your payout.

▶️ **Play:** https://capflyingfun.github.io/Anthill-Airways-Dino/
On iPhone: open in Safari → Share → **Add to Home Screen** to install it as an app (works offline).

## Phase 1 prototype — Nest Entrance

- Drag anywhere for a floating joystick (WASD / arrows on desktop)
- Crumb piles → oven (IN / OUT) → SELL counter → beetle customers pay → collect cash
- Glowing tiles: pour cash in to unlock (crumb pile, cashier, gate runs, backpack,
  worker ants, faster oven, Big Order)
- Gate runs: load 5+ snack packs on the beetle cart, tap **LAUNCH RUN**, steer through gates
- Automation: Cashier, Worker Ants (crumbs → oven), **Runner Ant** and **Conveyor Belt** (oven → counter)
- **XP & levels (ARK style):** every task gives XP; each level = 1 point for Carry Weight,
  Movement Speed, Work Speed, Haggling or Luck (tap your level, top left)
- Autosaves to the browser; Settings has sound + reset

## 3D models

Real rigged bug models, compressed for phones (`public/models`), legs animated in code:
fire ant **Major** (you), **Worker**, **Queen** and larvae, aphid, housefly, earthworm and
props from *Thronemound Colony Sim*; **Black Widow** and **Jumping Spider** from the
*TRADDOMIUM* releases.

## Project layout

| Folder | What's in it |
| --- | --- |
| `src/data/config.ts` | **Every tunable number** (speeds, costs, gate math). Balance the game here. |
| `src/core` | Input (joystick), save, sound effects |
| `src/world` | The base map, stations, items/stacks, labels |
| `src/actors` | Ant & beetle models, player, worker AI |
| `src/runs` | Gate run mode |
| `src/ui` | HUD overlay |

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check + production build into dist/
```

Pushing to `main` deploys automatically with GitHub Actions
(Settings → Pages → Source: **GitHub Actions**).

Tips: in the browser console, `game.base.addCash(500)` gives test cash and
`game.progress.addXp(100)` gives XP. Add `?speed=4` to the URL to fast-forward.
