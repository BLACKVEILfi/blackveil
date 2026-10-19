# Architecture

BLACKVEIL has three parts. Only the first one holds money.

```
┌──────────────────────────── Robinhood Chain (4663) ────────────────────────────┐
│  BlackveilBank (immutable)  ── holds USDG, owes it to accounts, vaults, queue  │
│  USDG (Paxos)               ── settlement token                                │
│  $BLVE (Pons)               ── charter token, read with balanceOf              │
└───────────────────────▲────────────────────────────────▲───────────────────────┘
                        │ signed txs (wallet / agent key) │ eth_call, eth_getLogs
        ┌───────────────┴─────────────┐        ┌──────────┴───────────────┐
        │  Browser: blackveil.fi      │        │  server.mjs (Node)       │
        │  pages + js/wallet.js       │◀──────▶│  static files            │
        │  (EIP-6963 wallet picker)   │  JSON  │  read-only JSON API      │
        └─────────────────────────────┘        │  event indexer → data/   │
                                               └──────────────────────────┘
        ┌─────────────────────────────┐
        │  AI agent + blackveil-agent │── agentPay with its own key, inside the mandate
        └─────────────────────────────┘
```

## 1. The contract

`contracts/src/BlackveilBank.sol`. See [CONTRACT.md](CONTRACT.md). It is the only component that can move funds, and every rule (handles, fees, mandates, the review queue, the charter) is enforced there. The website and the API could disappear and every account could still be used directly through a block explorer or any Ethereum library.

## 2. The website (`public/`)

Plain HTML, CSS and ES modules, no build step, no framework, no third-party scripts at runtime. Fonts, `ethers` and `three.js` are served from the same origin (`public/fonts`, `public/vendor`).

| Page | File | Purpose |
|---|---|---|
| `/` | `index.html`, `js/home.js`, `js/coin3d.js` | overview, live activity from the event log, mandate simulator, charter, fees, FAQ |
| `/app` | `app.html`, `js/app.js` | the bank: handle, deposit / withdraw, pay, requests, agents and review queue, activity |
| `/pay?r=<id>` | `pay.html` | settle a request to pay |
| `/agents` | `agents.html` | integration guide for agent builders |
| `/verify` | `verify.html`, `js/verify.js` | every claim with its status, contract facts read live, evidence links |

Wallet access (`js/wallet.js`, `js/walletpicker.js`):

- discovers wallets with EIP-6963 and falls back to `window.ethereum`;
- adds / switches to Robinhood Chain (`wallet_addEthereumChain`, chain id `0x1237`);
- **reads** go through a public RPC (`config.js → rpc`), **writes** are signed by the user's wallet; the site never sees a private key;
- the agent key generator on `/app` creates the key in the browser (`ethers.Wallet.createRandom`) and shows it once; it is never sent anywhere.

`public/config.js` is the single place for the bank address, RPC, links and the charter token address.

## 3. The server (`server.mjs`, `server/`)

A small Node server with one dependency (`ethers`):

- serves `public/` with gzip and caching, and security headers (`X-Content-Type-Options`, `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `Permissions-Policy`); with `PUBLIC=1` any path starting with `/_` returns 404;
- **indexer** (`server/bank.mjs`): reads `eth_getLogs` for the bank address from the deploy block forward, in adaptive block ranges, decodes every event, keeps derived state (accounts, handles, agents, requests, totals) and stores it in `data/index-<bank>.json`; it polls every `SYNC_MS` (default 4 s);
- **API** (`server/api.mjs`), read-only, rate-limited to 120 requests per minute per IP (`server/ratelimit.mjs`):

| Route | Returns |
|---|---|
| `GET /api/health` | `{ ok, bank, lastBlock, events }` |
| `GET /api/stats` | totals: accounts, handles, agents, deposits, payments, fees, settled / queued / refused agent payments, requests |
| `GET /api/activity?limit=&account=&agent=` | decoded events, newest first |
| `GET /api/proof` | the facts behind each claim on `/verify` (eth_call results, bytecode size, Sourcify status, first transaction per feature) |
| `GET /api/account/<0x…>` | an account's handle, agents, requests and activity |
| `GET /api/request/<id>` | one request to pay |
| `GET /api/handle/<name>` | `{ handle, address }` |
| `GET /api/handles?q=` | handle search |

The API is a convenience for the pages. Everything it returns can be recomputed from the chain.

- **RPC** (`server/rpc.mjs`): reads go to a public RPC (`RPC_URL`, default publicnode); wide log scans go to the official RPC. On networks that block the official hostname at DNS level the client connects to its Cloudflare IP (`RH_RPC_IP`) with SNI and `Host` set explicitly. `LOCAL_RPC` sends everything to a local node instead (used with a fork).

## Trust boundaries

| If this is compromised… | …the effect is |
|---|---|
| the web server | wrong information on pages; a malicious page could ask a user to sign something, which the wallet shows before signing. Funds in the contract stay governed by the contract. |
| the API / indexer | wrong numbers on pages. The chain is unaffected. |
| an agent key | the attacker can spend from that one vault, only inside the mandate (per payment, per day, allowlist), and anything above the review line waits for the owner. Pause, rotate or revoke stops it. |
| the owner key | the attacker can change the fee recipient and the charter threshold (and set the charter token if not set yet). They cannot move any account, vault or queued funds. |
| a user's wallet key | that user's account. As with any self-custodial wallet. |
