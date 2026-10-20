# Changelog

## 1.0.1 — 2026-10-21

- $BLVE launched on Pons: `0xC51b827315efb953BD53643d3BC6db08fe67C724`.
- Charter set on chain: `setCharterToken` (0x0ac137af…) and `setCharterMin(1,000,000 BLVE)` (0x05455209…). Holders of 1,000,000 $BLVE get ten agent vaults and three- and four-letter handles.
- Site: CA in the header, Pons link, Telegram group t.me/blackveilfi.

## 1.0.0 — 2026-10-18

First public release.

- `BlackveilBank` deployed on Robinhood Chain mainnet at `0xA47c92A006C3d8565310aB669ccde65AF229F78A` (block 91409330); source verified on Sourcify (exact match) and Blockscout (full match).
- Accounts in USDG: deposit, withdraw, pay by handle or address, from balance or wallet, to account or wallet. Fee 0.10 %, capped at 2 USDG, on the payer.
- Handles (3–20 characters; 3–4 with the charter).
- Requests to pay with optional expiry and memo, shareable as `/pay?r=<id>`.
- Agent vaults with mandates (per payment, per 24 hours, review line, allowlist), the review queue, pause, rotate, revoke; refusals logged on chain with a reason.
- Charter: one-time `setCharterToken`, `setCharterMin`; ten agent slots and short handles for holders.
- Website at blackveil.fi: home, bank app, payment page, agent guide, verification page; EIP-6963 wallet picker.
- Read-only API and event indexer; `blackveil-agent.mjs` SDK for agents.
- Tests: 19 unit and fuzz tests, one fork test against the real USDG; 51-check end-to-end browser test.
