"use strict";
// Addresses: migration contracts from https://app.aero.xyz/docs/security (Migration section).
// v2 token/escrow/migration-veNFT are read on-chain from the migration contract (V2_TOKEN, V2_ESCROW, MIGRATION_TOKEN_ID).
const SRC = "https://app.aero.xyz/docs/security";
const CH = {
  base: { name: "Base", sym: "AERO", ratio: 1, migration: "0x22a2F7340a3fB4C7C389D91eE954766B12476721",
    v3token: "0x3f5bF3EdAc59d650D8fDf9657a71F2f904A3a4Ee", v3escrow: "0xBF7977E1521e9a3032bf7243Ee4712f311f13915",
    rpcs: ["https://base-rpc.publicnode.com", "https://mainnet.base.org", "https://base.drpc.org", "https://base.gateway.tenderly.co"] },
  op: { name: "OP Mainnet", sym: "VELO", ratio: 0.044, migration: "0x6daE95FE833f190640dB1176F8C8a2e50C6a66c0",
    rpcs: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io", "https://optimism.drpc.org", "https://optimism.gateway.tenderly.co"] },
};
const MIGRATION_OPEN = 1792622048; // MIGRATION_OPEN() on-chain (Oct 21 22:34:08 UTC)
const LIQUID_OPEN = MIGRATION_OPEN - (MIGRATION_OPEN % 604800) + 604800; // epochNext(MIGRATION_OPEN) = Oct 22 00:00 UTC
const S = { V2_TOKEN: "2a178847", V2_ESCROW: "135b13db", V2_MINTER: "603b391e", paidBasis: "a05a9486", totalSupply: "18160ddd",
  balanceOf: "70a08231", supply: "047fc9aa", locked: "b45a3c0e", escrowType: "7c728000", voted: "8fbb38ff", ownerToNFTokenIdList: "8bf9d84c",
  idToManaged: "19a0a9d5", restricted: "3b17b94b", previewConversion: "70421ab9", rewardsDistributor: "3f2a5540", claimable: "d1d58b25", lastVoted: "f3594be0" };
const E18 = 10n ** 18n;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function rpc(ch, method, params) {
  let err;
  for (let round = 0; round < 3; round++) {
    for (const url of CH[ch].rpcs) {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: ctl.signal,
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        clearTimeout(t);
        const j = await r.json();
        if (j.error) { err = j.error.message || JSON.stringify(j.error); continue; }
        if (j.result == null) { err = "null result"; continue; }
        return j.result;
      } catch (e) { err = e.message; }
    }
    await sleep(600 * 2 ** round);
  }
  throw new Error(`${CH[ch].name} ${method}: ${err}`);
}
const w = (x) => (typeof x === "bigint" || typeof x === "number" ? BigInt(x).toString(16) : x.toLowerCase().replace(/^0x/, "")).padStart(64, "0");
const call = (ch, to, sel, ...a) => rpc(ch, "eth_call", [{ to, data: "0x" + sel + a.map(w).join("") }, "latest"]);
const word = (h, i = 0) => BigInt("0x" + (h.slice(2 + 64 * i, 2 + 64 * (i + 1)) || "0"));
const s128 = (v) => (v >> 255n ? v - (1n << 256n) : v);
const addrOf = (h) => "0x" + h.slice(26, 66);
const num = (big, dec = 18) => Number(big) / 10 ** dec;
const fmt = (x, d = 0) => (x == null || !isFinite(x) ? "n/a" : x.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
const fmtM = (x) => (x == null || !isFinite(x) ? "n/a" : Math.abs(x) >= 1e6 ? fmt(x / 1e6, 2) + "M" : Math.abs(x) >= 1e3 ? fmt(x / 1e3, 1) + "k" : fmt(x, 2));
const pct = (a, b) => (b > 0 ? (100 * a) / b : null);
const short = (a) => a ? a.slice(0, 6) + "…" + a.slice(-4) : "n/a";
const edt = (ts) => new Date(ts * 1000).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";

// Resolve legacy addresses on-chain from the verified migration contracts.
const meta = {};
async function resolve(ch) {
  if (meta[ch]) return meta[ch];
  const m = CH[ch].migration;
  const [t, e, id, mn] = await Promise.all([call(ch, m, S.V2_TOKEN), call(ch, m, S.V2_ESCROW), call(ch, m, "d075d4a2").catch(() => null), call(ch, m, S.V2_MINTER)]);
  meta[ch] = { token: addrOf(t), escrow: addrOf(e), minter: addrOf(mn), migId: id ? word(id) : null };
  return meta[ch];
}

async function totals(ch) {
  const r = await resolve(ch); const m = CH[ch].migration;
  const [paid, ts, inEsc, sup, mig] = await Promise.all([call(ch, m, S.paidBasis), call(ch, r.token, S.totalSupply),
    call(ch, r.token, S.balanceOf, r.escrow), call(ch, r.escrow, S.supply), r.migId != null ? call(ch, r.escrow, S.locked, r.migId) : null]);
  const t = { paid: num(word(paid)), totalSupply: num(word(ts)), inEscrow: num(word(inEsc)), escrowSupply: num(word(sup)) };
  t.migLock = mig ? num(s128(word(mig))) : null;
  t.remainingLocked = t.migLock != null ? t.escrowSupply - t.migLock : null;
  t.liquidOutside = t.totalSupply - t.inEscrow;
  return t;
}

let DATA = null;
async function loadData() {
  try { const r = await fetch("data/board.json?ts=" + Date.now()); if (r.ok) DATA = await r.json(); } catch (e) { DATA = null; }
}
function liquidUpgraded(ch) {
  const ev = DATA && DATA.chains[ch] && DATA.chains[ch].events;
  if (!ev) return null;
  return Object.values(ev.hourly).reduce((s, h) => s + h.liq, 0);
}

function card(k, v, d, p) {
  return `<div class="card"><div class="k">${k}</div><div class="v">${v}</div>${p != null ? `<div class="bar"><i style="width:${Math.min(100, p).toFixed(2)}%"></i></div>` : ""}<div class="d">${d}</div></div>`;
}

async function renderBoard() {
  const now = Date.now() / 1000;
  const res = await Promise.allSettled([totals("base"), totals("op")]);
  const cards = [];
  const errs = [];
  [["base", "AERO", "veAERO"], ["op", "VELO", "veVELO"]].forEach(([ch, liq, ve], i) => {
    const r = res[i];
    if (r.status !== "fulfilled") {
      errs.push(r.reason.message);
      cards.push(card(`${liq} → new AERO`, "n/a", "RPC unavailable: " + esc(r.reason.message)));
      cards.push(card(`${ve} → sAERO`, "n/a", "RPC unavailable"));
      return;
    }
    const t = r.value; const ratio = CH[ch].ratio;
    const L = liquidUpgraded(ch);
    const V = L == null ? null : t.paid - L;
    if (L == null) {
      cards.push(card(`${liq} (liquid) → new AERO`, "n/a", "Event history file not loaded, so liquid vs locked can't be split. Total upgraded (both): " + fmtM(t.paid) + " " + liq));
      cards.push(card(`${ve} (locked) → sAERO`, "n/a", "See note on the left."));
      return;
    }
    const lp = pct(L, L + t.liquidOutside);
    cards.push(card(`${liq} (liquid) → new AERO`, fmt(lp, 2) + "%",
      `${fmtM(L)} of ${fmtM(L + t.liquidOutside)} ${liq} upgraded → ${fmtM(L * ratio)} AERO. ` + (now < LIQUID_OPEN ? `<b>Liquid upgrades open ${edt(LIQUID_OPEN)}</b> (on-chain).` : ""), lp));
    const vp = t.remainingLocked != null ? pct(V, V + t.remainingLocked) : null;
    cards.push(card(`${ve} (locked) → sAERO`, fmt(vp, 2) + "%",
      `${fmtM(V)} of ${fmtM(V + (t.remainingLocked ?? NaN))} locked ${liq} upgraded → ${fmtM(V * ratio)} sAERO. ${fmtM(t.remainingLocked)} still in legacy locks (incl. relays).`, vp));
  });
  $("board").innerHTML = cards.join("");
  $("board-status").innerHTML = (errs.length ? "Some data unavailable. " : "Live from Base and OP Mainnet RPCs. ") + "Updated " + new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York" }) + " ET. Refreshes every 60s." +
    (DATA ? ` History indexed through ${esc(DATA.generatedAt)}.` : "");
}

function renderChart() {
  if (!DATA) { $("chart").innerHTML = '<p class="muted">n/a: history file not available.</p>'; return; }
  const hours = new Set(); const H = {};
  for (const ch of ["base", "op"]) {
    const ev = DATA.chains[ch]?.events; if (!ev) continue;
    for (const [h, v] of Object.entries(ev.hourly)) { hours.add(+h); (H[h] ||= {})[ch] = (v.ve + v.liq) * CH[ch].ratio; }
  }
  const hs = [...hours].sort((a, b) => a - b);
  if (!hs.length) { $("chart").innerHTML = '<p class="muted">No upgrades indexed yet.</p>'; return; }
  const all = []; for (let h = hs[0]; h <= hs[hs.length - 1]; h += 3600) all.push(h);
  const max = Math.max(...all.map((h) => (H[h]?.base || 0) + (H[h]?.op || 0)));
  $("chart").innerHTML = all.map((h) => { const a = H[h]?.base || 0, o = H[h]?.op || 0;
    return `<div class="c" title="${edt(h)}: ${fmtM(a)} from AERO, ${fmtM(o)} from VELO (in new-AERO terms)"><i class="o" style="height:${(100 * o) / max}%"></i><i class="a" style="height:${(100 * a) / max}%"></i></div>`; }).join("");
  $("chart-note").innerHTML = `Bars in new-AERO terms (VELO × 0.044). <span style="color:var(--acc)">■</span> from AERO/veAERO <span style="color:#f472b6">■</span> from VELO/veVELO. ${edt(all[0])} to ${edt(all[all.length - 1])}. Updated by the refresh job.`;
}

function renderGround() {
  for (const ch of ["base", "op"]) {
    const g = DATA?.chains[ch]?.ground; const el = $("ground-" + ch); const sym = CH[ch].sym;
    if (!g) { el.innerHTML = '<p class="muted">n/a: snapshot not available.</p>'; continue; }
    const row = (r) => `<tr><td>#${r.id}</td><td class="n">${fmtM(r.amount)}</td><td class="mono">${short(r.owner)}</td><td>${r.ownerType === "contract" ? "contract" : "wallet"}</td><td>${r.permanent ? "permanent" : r.end ? "until " + new Date(r.end * 1000).toISOString().slice(0, 10) : ""}${r.voted ? ' <span class="pill w">voted</span>' : ""}</td></tr>`;
    el.innerHTML = `<p class="small">${fmt(g.normalCount)} legacy veNFTs hold ${fmtM(g.normalAmount)} ${sym}. ${fmt(g.relayCount)} relays hold ${fmtM(g.relayAmount)} ${sym} from ${fmt(g.relayDepositCount)} deposited veNFTs (withdraw from the relay first).</p>
      <table><tr><th>veNFT</th><th class="n">${sym}</th><th>Owner</th><th></th><th>Lock</th></tr>${g.top.slice(0, 15).map(row).join("")}</table>
      <h3>Largest relays still holding deposits</h3>
      <table><tr><th>Relay veNFT</th><th class="n">${sym}</th><th>Relay address</th><th></th><th></th></tr>${g.relays.slice(0, 8).map(row).join("")}</table>`;
  }
  if (DATA) $("ground-at").textContent = "Snapshot: " + DATA.generatedAt + ".";
}

function renderContracts() {
  const rows = [["Base", "AerodromeMigration", CH.base.migration], ["OP Mainnet", "VelodromeMigration", CH.op.migration],
    ["Base", "VelodromeMigrationEntrypoint", "0x6daE95FE833f190640dB1176F8C8a2e50C6a66c0"], ["Base", "New AERO token", CH.base.v3token], ["Base", "New VotingEscrow (sAERO)", CH.base.v3escrow]];
  let h = `<table><tr><th>Chain</th><th>Contract</th><th>Address</th><th>Source</th></tr>` + rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="mono">${r[2]}</td><td><a href="${SRC}" rel="noopener">Aero docs</a></td></tr>`).join("");
  for (const ch of ["base", "op"]) if (meta[ch]) h += `<tr><td>${CH[ch].name}</td><td>Legacy ${CH[ch].sym} / escrow</td><td class="mono">${meta[ch].token}<br>${meta[ch].escrow}</td><td>read on-chain from the migration contract</td></tr>`;
  $("contracts").innerHTML = h + "</table>";
}

// ---------- wallet checker ----------
async function checkChain(ch, owner) {
  const r = await resolve(ch); const m = CH[ch].migration; const sym = CH[ch].sym; const ratio = CH[ch].ratio;
  const [bal, nb, distH] = await Promise.all([call(ch, r.token, S.balanceOf, owner), call(ch, r.escrow, S.balanceOf, owner), call(ch, r.minter, S.rewardsDistributor).catch(() => null)]);
  const liquid = num(word(bal)); const n = Number(word(nb)); const dist = distH ? addrOf(distH) : null;
  const now = Date.now() / 1000; const out = { liquid, items: [] };
  const ids = await Promise.all([...Array(Math.min(n, 50)).keys()].map((i) => call(ch, r.escrow, S.ownerToNFTokenIdList, owner, i).then(word)));
  for (const id of ids) {
    const [lk, et, vt, rs, pv, cl] = await Promise.all([call(ch, r.escrow, S.locked, id), call(ch, r.escrow, S.escrowType, id), call(ch, r.escrow, S.voted, id),
      call(ch, m, S.restricted, id), call(ch, m, S.previewConversion, id).catch(() => null), dist ? call(ch, dist, S.claimable, id).catch(() => null) : null]);
    const amt = num(s128(word(lk))), end = Number(word(lk, 1)), perm = word(lk, 2) === 1n, type = Number(word(et));
    const it = { id: id.toString(), amt, end, perm, type, blockers: [], expected: null };
    if (type === 1) {
      const mid = word(await call(ch, r.escrow, S.idToManaged, id));
      it.blockers.push(`Deposited in a Relay (managed veNFT #${mid}). Withdraw it from the relay first; the portal does this as step 1.`);
    }
    if (type === 2) it.blockers.push("This veNFT is a Relay (managed veNFT). It can't be upgraded with this flow; the relay operator handles it.");
    if (word(vt) === 1n) it.blockers.push("Has an active vote. Reset it first (the portal's Reset step); if you voted in the final epoch, wait one hour.");
    if (word(rs) === 1n) it.blockers.push("Restricted by the migration contract.");
    if (!perm && end && end <= now && now < LIQUID_OPEN) it.blockers.push(`Lock has expired. Expired locks can upgrade from ${edt(LIQUID_OPEN)}.`);
    if (amt <= 0 && type !== 1) it.blockers.push("Nothing locked in this veNFT.");
    if (cl && word(cl) > 0n) it.claim = num(word(cl));
    if (pv) it.expected = num(word(pv, 1)); else it.expected = amt * ratio;
    it.liquidOut = pv ? word(pv, 3) === 1n : null;
    out.items.push(it);
  }
  out.more = n > 50 ? n - 50 : 0;
  return out;
}

async function onCheck(ev) {
  ev.preventDefault();
  const a = $("waddr").value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) { $("wout").innerHTML = '<p class="pill bad">Enter a valid 0x address.</p>'; return; }
  $("wout").innerHTML = '<p class="muted">Reading Base and OP Mainnet…</p>';
  const res = await Promise.allSettled([checkChain("base", a), checkChain("op", a)]);
  const now = Date.now() / 1000; let total = 0, html = "";
  [["base", "AERO", "veAERO", "https://aerodrome.finance/upgrade"], ["op", "VELO", "veVELO", "https://velodrome.finance/upgrade"]].forEach(([ch, sym, ve, portal], i) => {
    const r = res[i]; const ratio = CH[ch].ratio;
    html += `<h3>${CH[ch].name}</h3>`;
    if (r.status !== "fulfilled") { html += `<p class="pill bad">n/a: ${esc(r.reason.message)}</p>`; return; }
    const v = r.value; const le = v.liquid * ratio; total += le;
    html += `<table><tr><th>Position</th><th class="n">Legacy amount</th><th class="n">Expected</th><th>Status</th></tr>`;
    html += `<tr><td>Liquid ${sym}</td><td class="n">${fmt(v.liquid, 4)}</td><td class="n">${fmt(le, 4)} AERO</td><td>${v.liquid <= 0 ? "none" : now < LIQUID_OPEN ? `<span class="pill w">opens ${edt(LIQUID_OPEN)}</span>` : '<span class="pill ok">upgradeable</span>'}</td></tr>`;
    for (const it of v.items) {
      total += it.expected || 0;
      const st = it.blockers.length ? it.blockers.map((b) => `<span class="pill bad">${esc(b)}</span>`).join(" ") : '<span class="pill ok">ready to upgrade</span>';
      const cl = it.claim ? ` <span class="pill w">claim ${fmt(it.claim, 4)} ${sym} rebase first</span>` : "";
      html += `<tr><td>${ve} #${it.id}<br><span class="muted small">${it.type === 1 ? "in relay" : it.perm ? "permanent lock" : it.end ? "lock ends " + new Date(it.end * 1000).toISOString().slice(0, 10) : ""}</span></td><td class="n">${fmt(it.amt, 4)}</td><td class="n">${fmt(it.expected, 4)} ${it.liquidOut ? "AERO" : "sAERO"}</td><td>${st}${cl}</td></tr>`;
    }
    html += `</table>${v.more ? `<p class="small muted">${v.more} more veNFTs not shown.</p>` : ""}`;
    html += `<p class="small">Voting rewards aren't listed here; the portal shows any to claim before upgrading. ${ch === "op" ? "veVELO upgrades from OP Mainnet pay a cross-chain fee in ETH on OP, and the sAERO arrives on Base. " : ""}Upgrade at <a href="${portal}" rel="noopener">${portal.replace("https://", "")}</a>.</p>`;
  });
  html = `<div class="card"><div class="k">Expected new AERO + sAERO across Base and OP (official rates)</div><div class="v">${fmt(total, 2)}</div><div class="d">Read-only estimate. The portal's numbers are what count.</div></div>` + html;
  // Already upgraded (new AERO on Base)
  try { const nb = num(word(await call("base", CH.base.v3token, S.balanceOf, a))); html += `<p class="small">New AERO already in this wallet on Base: <b>${fmt(nb, 4)}</b>. sAERO positions show at <a href="https://app.aero.xyz" rel="noopener">app.aero.xyz</a>.</p>`; } catch (e) {}
  $("wout").innerHTML = html;
}

async function main() {
  $("wform").addEventListener("submit", onCheck);
  await loadData();
  renderChart(); renderGround();
  await renderBoard().catch((e) => ($("board-status").textContent = "Error: " + e.message));
  renderContracts();
  const hm = location.hash.match(/addr=(0x[0-9a-fA-F]{40})/);
  if (hm) { $("waddr").value = hm[1]; await onCheck({ preventDefault() {} }); }
  window.__boardLoaded = true;
  setInterval(() => renderBoard().catch(() => {}), 60000);
}
main();
