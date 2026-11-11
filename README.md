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
- Autosaves to the browser; Settings has sound + reset

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

Tip: in the browser console, `game.base.addCash(500)` gives you test cash.
