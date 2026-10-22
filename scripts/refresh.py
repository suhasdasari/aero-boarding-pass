#!/usr/bin/env python3
"""Aero Boarding Pass data refresh.

Reads the official Aero migration contracts (addresses from
https://app.aero.xyz/docs/security) on Base and OP Mainnet through public RPCs and
writes data/board.json:
  * upgrade totals (paidBasis) and remaining legacy supply
  * hourly upgrade history from VeNFTMigrated / LiquidMigrated events (incremental)
  * the largest legacy veNFTs that have not been upgraded, and relay (managed veNFT) totals
Standard library only. No API keys. On any failure the previous file is kept.
"""
import json, os, sys, time, random, urllib.request, datetime

DEADLINE = time.time() + float(os.environ.get("REFRESH_BUDGET_S", "1500"))
class Timeout(RuntimeError): pass
def check_deadline():
    if time.time() > DEADLINE: raise Timeout("refresh time budget exceeded")
def backoff(i, base=1.0, cap=20.0):
    time.sleep(min(cap, base * 2 ** i) * (0.5 + random.random() / 2))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "board.json")
MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"
MIGRATION_OPEN = 1792622048  # MIGRATION_OPEN() on both migration contracts (2026-10-21 22:34:08 UTC)
T_VE = "0x7189c8333f41695423e354bdab493c3cb377f4c8764d35a31f271b9cd61e84c8"  # VeNFTMigrated(address,address,uint256,uint256,uint256,bool,bool)
T_LQ = "0xd9c26a8129d7a870c63a2a30cbfff89ae6ad16f1949c342160b9d5e2c182ea63"  # LiquidMigrated(address,address,uint256,uint256)
S = dict(paidBasis="a05a9486", totalSupply="18160ddd", balanceOf="70a08231", supply="047fc9aa", locked="b45a3c0e",
         escrowType="7c728000", ownerOf="6352211e", voted="8fbb38ff", tokenId="17d70f7c", aggregate3="82ad56cb",
         migrationTokenId=None)

CHAINS = {
    "base": {"name": "Base", "symbol": "AERO", "ratio": 1.0,
             "migration": "0x22a2F7340a3fB4C7C389D91eE954766B12476721",
             # V2_TOKEN() / V2_ESCROW() / MIGRATION_TOKEN_ID() read from the migration contract
             "v2token": "0x940181a94A35A4569E4529A3CDfB74e38FD98631", "v2escrow": "0xeBf418Fe2512e7E6bd9b87a8f0f294aCDC67e6B4", "migId": 0x203c0,
             "rpcs": ["https://base-rpc.publicnode.com", "https://mainnet.base.org", "https://base.drpc.org", "https://base.gateway.tenderly.co"],
             "logrpcs": ["https://base.gateway.tenderly.co", "https://mainnet.base.org", "https://base.drpc.org"], "logstep": 1000, "blocktime": 2},
    "op": {"name": "OP Mainnet", "symbol": "VELO", "ratio": 0.044,
           "migration": "0x6daE95FE833f190640dB1176F8C8a2e50C6a66c0",
           "v2token": "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db", "v2escrow": "0xFAf8FD17D9840595845582fCB047DF13f006787d", "migId": 0x86a2,
           "rpcs": ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io", "https://optimism.drpc.org", "https://optimism.gateway.tenderly.co"],
           "logrpcs": ["https://mainnet.optimism.io", "https://optimism.gateway.tenderly.co", "https://optimism.drpc.org"], "logstep": 5000, "blocktime": 2},
}

def rpc(chain, method, params, tries=5, urls=None):
    err = None
    urls = urls or CHAINS[chain]["rpcs"]
    for i in range(tries):
        for url in urls:
            check_deadline()
            try:
                req = urllib.request.Request(url, json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                             {"content-type": "application/json", "user-agent": "Mozilla/5.0 aero-boarding-pass"})
                r = json.load(urllib.request.urlopen(req, timeout=30))
                if "error" in r: err = r["error"]; continue
                if r.get("result") is None: err = "null result"; continue
                return r["result"]
            except Exception as e:
                err = e
        if i < tries - 1: backoff(i)
    raise RuntimeError(f"{chain} {method} failed: {err}")

def w(x): return hex(x)[2:].zfill(64) if isinstance(x, int) else x.lower().replace("0x", "").zfill(64)
def ec(chain, to, sel, *args): return rpc(chain, "eth_call", [{"to": to, "data": "0x" + sel + "".join(w(a) for a in args)}, "latest"])
def u(h, i=0): return int(h[2 + 64 * i: 2 + 64 * (i + 1)], 16)
def s128(v): return v - (1 << 256) if v >> 255 else v
E18 = 10 ** 18

def multicall(chain, calls):
    """calls: list of (target, calldata_hex_no0x). Returns list of hex return data or None."""
    n = len(calls)
    head, tail, off = [], [], 32 * n
    for tgt, data in calls:
        b = bytes.fromhex(data)
        enc = w(tgt) + w(1) + w(96) + w(len(b)) + (b + b"\0" * ((32 - len(b) % 32) % 32)).hex()
        head.append(w(off)); tail.append(enc); off += len(enc) // 2
    payload = "0x" + S["aggregate3"] + w(32) + w(n) + "".join(head) + "".join(tail)
    r = bytes.fromhex(rpc(chain, "eth_call", [{"to": MULTICALL3, "data": payload}, "latest"])[2:])
    rd = lambda o: int.from_bytes(r[o:o + 32], "big")
    base = rd(0); cnt = rd(base); out = []
    for i in range(cnt):
        eo = base + 32 + rd(base + 32 + 32 * i)
        ok = rd(eo); bo = eo + rd(eo + 32); ln = rd(bo)
        out.append(r[bo + 32: bo + 32 + ln].hex() if ok else None)
    return out

def totals(ch):
    c = CHAINS[ch]
    paid = u(ec(ch, c["migration"], S["paidBasis"])) / E18
    ts = u(ec(ch, c["v2token"], S["totalSupply"])) / E18
    inesc = u(ec(ch, c["v2token"], S["balanceOf"], c["v2escrow"])) / E18
    esup = u(ec(ch, c["v2escrow"], S["supply"])) / E18
    mig = s128(u(ec(ch, c["v2escrow"], S["locked"], c["migId"]))) / E18
    return {"paidBasis": paid, "totalSupply": ts, "inEscrow": inesc, "escrowSupply": esup, "migrationLock": mig,
            "remainingLocked": esup - mig, "liquidOutside": ts - inesc}

def scan_logs(ch, state):
    c = CHAINS[ch]
    head = int(rpc(ch, "eth_blockNumber", []), 16)
    cur = state.get("cursor")
    if not cur:
        blk = rpc(ch, "eth_getBlockByNumber", [hex(head), False]); ts = int(blk["timestamp"], 16)
        cur = head - (ts - MIGRATION_OPEN) // c["blocktime"] - 200
    hourly = {int(k): v for k, v in state.get("hourly", {}).items()}
    largest = state.get("largest", [])
    step = c["logstep"]; b = cur
    while b <= head:
        check_deadline()
        e = min(b + step - 1, head)
        try:
            logs = rpc(ch, "eth_getLogs", [{"address": c["migration"], "fromBlock": hex(b), "toBlock": hex(e), "topics": [[T_VE, T_LQ]]}], tries=2, urls=c["logrpcs"])
        except Timeout: raise
        except Exception:
            if step > 100: step //= 2; continue
            raise
        for l in logs:
            ts = int(l.get("blockTimestamp") or rpc(ch, "eth_getBlockByNumber", [l["blockNumber"], False])["timestamp"], 16)
            hr = ts - ts % 3600
            hv = hourly.setdefault(hr, {"ve": 0.0, "veN": 0, "liq": 0.0, "liqN": 0})
            amt = u(l["data"], 0) / E18
            if l["topics"][0] == T_VE:
                hv["ve"] += amt; hv["veN"] += 1
                largest.append({"id": int(l["topics"][3], 16), "amount": amt, "tx": l["transactionHash"], "ts": ts})
            else:
                hv["liq"] += amt; hv["liqN"] += 1
        b = e + 1
    largest = sorted(largest, key=lambda x: -x["amount"])[:10]
    return {"cursor": head + 1, "head": head, "hourly": {str(k): hourly[k] for k in sorted(hourly)}, "largest": largest}

def ground(ch, top=25, batch=250):
    c = CHAINS[ch]; esc = c["v2escrow"]
    maxid = u(ec(ch, esc, S["tokenId"]))
    normal, managed = [], []
    lockedN = 0
    for start in range(1, maxid + 1, batch):
        ids = list(range(start, min(start + batch, maxid + 1)))
        calls = []
        for i in ids: calls += [(esc, S["locked"] + w(i)), (esc, S["escrowType"] + w(i))]
        res = multicall(ch, calls)
        for k, i in enumerate(ids):
            lk, et = res[2 * k], res[2 * k + 1]
            if not lk or not et: continue
            amt = s128(int(lk[:64], 16)) / E18; etype = int(et[:64], 16)
            if i == c["migId"]: continue
            if etype == 1: lockedN += 1
            if amt <= 0: continue
            rec = {"id": i, "amount": amt, "end": int(lk[64:128], 16), "permanent": bool(int(lk[128:192], 16))}
            (managed if etype == 2 else normal).append(rec) if etype != 1 else None
    normal.sort(key=lambda x: -x["amount"]); managed.sort(key=lambda x: -x["amount"])
    topn = normal[:top]; topm = managed[:15]
    calls = []
    for r in topn + topm: calls += [(esc, S["ownerOf"] + w(r["id"])), (esc, S["voted"] + w(r["id"]))]
    res = multicall(ch, calls)
    for k, r in enumerate(topn + topm):
        r["owner"] = "0x" + res[2 * k][24:64] if res[2 * k] else None
        r["voted"] = bool(int(res[2 * k + 1][:64], 16)) if res[2 * k + 1] else None
        if r["owner"]:
            code = rpc(ch, "eth_getCode", [r["owner"], "latest"])
            r["ownerType"] = "eoa" if code in ("0x", "0x0") else ("eoa-7702" if code.startswith("0xef0100") else "contract")
    return {"maxTokenId": maxid, "normalCount": len(normal), "normalAmount": sum(x["amount"] for x in normal),
            "relayDepositCount": lockedN, "relayCount": len(managed), "relayAmount": sum(x["amount"] for x in managed),
            "top": topn, "relays": topm}

def main():
    prev = {}
    if os.path.exists(OUT):
        try: prev = json.load(open(OUT))
        except Exception: prev = {}
    out = {"generatedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "https://app.aero.xyz/docs/security", "migrationOpen": MIGRATION_OPEN, "chains": {}}
    ok = False
    for ch in CHAINS:
        p = prev.get("chains", {}).get(ch, {})
        d = {"name": CHAINS[ch]["name"], "symbol": CHAINS[ch]["symbol"], "ratio": CHAINS[ch]["ratio"]}
        for key, fn in (("totals", lambda: totals(ch)), ("events", lambda: scan_logs(ch, p.get("events", {}))), ("ground", lambda: ground(ch))):
            try:
                d[key] = fn(); d[key + "At"] = out["generatedAt"]; ok = True
            except Exception as e:
                print(f"[{ch}] {key} failed: {e}", file=sys.stderr)
                if key in p: d[key] = p[key]; d[key + "At"] = p.get(key + "At")
                d.setdefault("errors", []).append(f"{key}: {str(e)[:160]}")
        out["chains"][ch] = d
    if not ok:
        print("nothing refreshed; keeping previous file", file=sys.stderr); return 1
    tmp = OUT + ".tmp"
    json.dump(out, open(tmp, "w"), indent=1); os.replace(tmp, OUT)
    print("wrote", OUT); return 0

if __name__ == "__main__":
    sys.exit(main())
