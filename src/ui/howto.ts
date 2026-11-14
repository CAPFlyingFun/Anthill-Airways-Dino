// ============================================================================
// howto.ts — 📖 How to play (⚙️ Settings → 📖 How to play).
//
// The full guide, for after the tutorial (or for anyone who skipped it).
// Plain HTML sections, shown in the shared guide card (hud.showGuide).
// Keep it short per section: it's read on a phone.
// ============================================================================

export const HOWTO_TITLE = '📖 How to play';

export const HOWTO_HTML = `
<section>
  <h3>👆 Moving around</h3>
  <ul>
    <li><b>Drag anywhere</b> on the screen to walk. Let go to stop.</li>
    <li>You do things by <b>standing on pads</b>: no buttons needed.</li>
    <li>👁️ (bottom right) switches between the normal and first-person view.</li>
  </ul>
</section>

<section>
  <h3>💵 Making money</h3>
  <ol>
    <li>Pick up food from a pile (🍞 crumbs, 🌿 leaves, 🍬 sugar...).</li>
    <li>Drop it on a machine's <b>IN</b> pad. It makes snacks.</li>
    <li>Grab the snacks from the <b>OUT</b> pad.</li>
    <li>Stand on <b>SELL</b> to stock the counter. Customers buy them.</li>
    <li>Walk over the <b>green cash pads</b> to collect the money.</li>
  </ol>
  <p>Carrying the wrong thing? Stand on a 🗑️ trash bin to throw it away (it even pays a little:
  $1 a piece, more with upgrades, up to 100 pieces every 5 minutes).</p>
</section>

<section>
  <h3>✨ Unlocking</h3>
  <ul>
    <li><b>Glowing tiles</b> on the ground show a price. Stand on one and your cash pours in.</li>
    <li>You can pay a bit at a time: what you've paid is saved.</li>
    <li>Tiles unlock helpers, faster machines, bigger backpacks and whole new areas 🗺️.</li>
    <li>🔒 The <b>Big Orders</b> that open a new area also need a <b>player level</b> (the tile shows a 🔒 and "LOCKED: Lv 18" until you get there).</li>
  </ul>
</section>

<section>
  <h3>🐜 Helpers (idle income)</h3>
  <ul>
    <li><b>Cashiers</b> serve customers, <b>Workers</b> bring food to machines, <b>Runners</b> carry snacks to the counter.</li>
    <li><b>Bankers</b> (and assistants in later worlds) collect the cash for you.</li>
    <li>Money collected by helpers is your idle income: the <b>+$/min</b> under your cash.</li>
    <li>Helpers earn XP and level up as they work (up to Lv 20).</li>
  </ul>
</section>

<section>
  <h3>⬆️ Upgrading buildings</h3>
  <ul>
    <li>Walk up to a building and tap the <b>⬆️ button</b> (bottom right), or just <b>tap the building</b>, to open its panel.</li>
    <li>Each upgrade shows what it does now and after the next level. Buy <b>×1</b>, <b>×5</b> or <b>MAX</b> (as many as you can afford). The button glows gold when you can afford a level.</li>
    <li>⭐ <b>Lv 5 and Lv 10 are milestones</b>: those levels give a bigger jump.</li>
    <li>A shop's panel also hires a <b>2nd cashier</b> (two lines), then <b>bigger orders</b>.</li>
    <li>The <b>👷 Staff</b> tab (or tap a helper) upgrades every helper's speed and carry, and your bankers' and assistants' grab speed and cash.</li>
    <li>A ⚠️ tag over a building (and in its panel) means something is backed up (shelf full, nothing to sell...).</li>
  </ul>
</section>

<section>
  <h3>🚩 Gate runs</h3>
  <ul>
    <li>Drop 5 or more items on a cart (or raft, boat, helicopter...) and tap <b>🚀 LAUNCH RUN</b>.</li>
    <li><b>Drag left and right</b> to steer through the gates: <b>+</b> and <b>×</b> are good, <b>−</b> and <b>÷</b> are bad, <b>?</b> is a gamble.</li>
    <li>Puddles and hazards knock some of your load off.</li>
    <li>📦 <b>Delivery contracts:</b> reach the target number to earn a +50% bonus.</li>
    <li>⚠️ From your 3rd run, some rows offer a <b>gold RISKY ×2 gate</b> with a hazard right behind it.</li>
    <li>🚩 The cart holds up to <b>×6</b> what you loaded (the launch button shows how many). Once it's <b>FULL</b>,
    + and × gates add nothing: dodge the − and ÷ gates and the hazards to keep your haul. Finish-line bonuses
    (📦 the contract's +50%, the ×1.25 photo snaps) still count on top.</li>
  </ul>
</section>

<section>
  <h3>📊 Levels and stats</h3>
  <ul>
    <li>XP comes from <b>doing things</b>: picking up, dropping off, selling (your helpers' sales count a little too), unlocking tiles and gate runs. Tap your <b>level</b> (top left) to spend points.</li>
    <li>Each stat goes up to <b>50</b> (Carry, Speed, Work, Haggling, Luck, Charm, Leadership, Toughness, Night Manager). Every point is a small boost, so choose what fits how you play.</li>
    <li>👑 At level 20 the <b>Queen</b> is crowned. Her own points boost your Bankers and trash money.</li>
    <li>📊 <b>Lifetime stats</b> (in the same screen) show your all-time totals.</li>
  </ul>
</section>

<section>
  <h3>💤 Offline earnings</h3>
  <ul>
    <li>While you're away, you earn <b>50%</b> of your <b>+$/min</b> for up to <b>4 hours</b>.</li>
    <li>💤 Night Manager points raise the share (up to +25%). 💎 Night Shift shards add +5% and 48 more minutes each, so the best is <b>100% for 8 hours</b>.</li>
    <li>When you come back you can just collect, or play a 💰 <b>bonus run</b>: it pays from <b>x0.75 up to x2</b>, depending on how many bundles reach the finish.</li>
  </ul>
</section>

<section>
  <h3>🗺️ Your route</h3>
  <ul>
    <li>Colony 🐜 → Tunnels → Hangar → Airport ✈️ → Dino Island 🦖 → Mount Anthill 🌋 → Grand Resort 🏨.</li>
    <li>The <b>🛫 Next</b> chip (top left) shows what to unlock next (and the level its Big Order needs); tap it for the full departures board.</li>
    <li>Tap 🌍 (top left) to travel between the worlds you've opened. Each keeps working while you're away.</li>
    <li>🌋 At Mount Anthill you can set off <b>the Big Eruption</b>: the island and volcano reset for 💎 Obsidian
    Shards (worth more the more the island and volcano earned), which buy permanent boosts at the Obsidian Shrine (tap your level).</li>
  </ul>
</section>

<section>
  <h3>⚙️ Settings</h3>
  <ul>
    <li>🎵 Music and 🔊 effects volume (sound plays even with the iPhone's silent switch on).</li>
    <li>🐜 <b>Movement speed</b>: how fast everyone walks. Money and machines aren't affected.</li>
    <li>💾 Three save slots, so others can play on the same phone.</li>
  </ul>
</section>
`;

// ============================================================================
// 🏝️ Anthill Island (the new game, a test version for now)
// ============================================================================
export const HOME_HOWTO_TITLE = '📖 How to play: Anthill Island';

export const HOME_HOWTO_HTML = `
<section>
  <h3>👆 Moving around</h3>
  <ul>
    <li><b>Drag anywhere</b> to walk. You do things by <b>standing on pads</b>.</li>
    <li>👁️ (bottom right) switches to first-person view.</li>
  </ul>
</section>

<section>
  <h3>🐜 Your ant farm</h3>
  <ol>
    <li>Grab crumbs 🍞 from the bread box.</li>
    <li>Drop them on the farm's <b>IN</b> tray: the ants turn them into snack packs 🍪.</li>
    <li>Pick the packs up from the <b>OUT</b> tray.</li>
  </ol>
</section>

<section>
  <h3>🙋 Neighbors' orders</h3>
  <ul>
    <li>Neighbors come to the table by the fence and ask for snack packs.</li>
    <li>Stand on <b>ORDER</b> to hand them over: each order pays <b>cash and lots of XP</b>.</li>
    <li>A new neighbor comes by a few seconds later.</li>
  </ul>
</section>

<section>
  <h3>🐜 Farm levels = ant helpers</h3>
  <ul>
    <li>The glowing tile by the farm grows it. Each level sends out an ant for a job you used to do:</li>
    <li><b>Lv 2</b> Gatherer (bread box → crumb basket) · <b>Lv 3</b> Carrier (basket → farm, and farm → café) ·
    <b>Lv 4</b> café Cashier · <b>Lv 5</b> Banker (collects the café's cash).</li>
  </ul>
</section>

<section>
  <h3>📦 The delivery crate and 🪵 planks</h3>
  <ul>
    <li>Fill the crate with the snack packs and crumbs it asks for. It goes off on a truck and comes back with <b>🪵 planks</b>.</li>
    <li>Your planks show next to the area name (top left).</li>
  </ul>
</section>

<section>
  <h3>🏡 New plots</h3>
  <ul>
    <li>The tile by the east gate opens the next plot. It needs a <b>player level</b>, <b>ants working</b>, <b>planks</b> and <b>cash</b>: the sign over the gate ticks them off.</li>
    <li>☕ The <b>Corner Café</b> buys your snack packs: bring them to its SELL spot. Customers pay on the cash pad.</li>
    <li>🎁 Every new plot hides a chest.</li>
  </ul>
</section>

<section>
  <h3>⬆️ Upgrading</h3>
  <ul>
    <li>Walk up to a building and tap the <b>⬆️ button</b>, or just <b>tap the building</b> (a helper opens the Staff tab).</li>
  </ul>
</section>

<section>
  <h3>🧪 Test version</h3>
  <ul>
    <li>This is the first test of the new game: the backyard and the first café plot.</li>
    <li>Your other games are safe in <b>⚙️ Settings → Save slots</b>.</li>
  </ul>
</section>
`;
