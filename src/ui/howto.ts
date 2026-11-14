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
  <h3>⬆️ Upgrade pads</h3>
  <ul>
    <li>Round ⬆️ pads appear next to buildings and helpers. Stand on one to buy the next level.</li>
    <li>Machines make more, counters sell for more, helpers get faster and carry more.</li>
    <li>A counter's pad first hires a <b>2nd cashier</b> (two lines), then unlocks <b>bigger orders</b>.</li>
    <li>A ⚠️ tag over a building means something is backed up (shelf full, nothing to sell...).</li>
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
