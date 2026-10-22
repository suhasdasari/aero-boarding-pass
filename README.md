# Aero Boarding Pass

Live, on-chain tracker for the Aerodrome + Velodrome upgrade to Aero. Static site (GitHub Pages), client-side JS only.

- **Boarding board**: percent of liquid AERO/VELO and locked veAERO/veVELO upgraded, read live from the official migration contracts (`paidBasis()`) and legacy token/escrow supply through public RPCs with fallbacks and retries.
- **Still on the ground**: largest legacy veNFTs not yet upgraded, plus relay (managed veNFT) totals, from `data/board.json`.
- **Wallet checker** (Base + OP Mainnet): legacy balances and veNFTs, blockers (relay deposit, active vote, restricted, expired lock, unclaimed rebase), and expected new AERO/sAERO (`previewConversion`). Open `index.html#addr=0x…` to run it directly.

Addresses: migration contracts and new AERO/VotingEscrow from https://app.aero.xyz/docs/security; legacy token/escrow read on-chain from the migration contracts.

Data refresh: `python3 scripts/refresh.py` (standard library only, time budget, keeps the previous file on failure). `.github/workflows/refresh.yml` runs it hourly and commits `data/board.json`.

Not financial advice. Built by Satoshi Drops 🪂 [@SatoshiDropsHQ](https://x.com/SatoshiDropsHQ)
