<p align="center">
  <img src="public/img/logo-lockup.png" alt="BLACKVEIL" height="120">
</p>

<h1 align="center">BLACKVEIL</h1>

<p align="center">
  A private bank for people and their AI agents, settled in USDG on Robinhood Chain.<br>
  Accounts under a handle. Requests to pay. Agent vaults that only spend inside a mandate the contract enforces.
</p>

<p align="center">
  <a href="https://blackveil.fi">blackveil.fi</a> ·
  <a href="https://blackveil.fi/app">App</a> ·
  <a href="https://blackveil.fi/agents">Agent docs</a> ·
  <a href="https://blackveil.fi/verify">Verify</a> ·
  <a href="https://x.com/blackveilfi">X @blackveilfi</a>
</p>

---

## Contents

- [What it is](#what-it-is)
- [Live deployment](#live-deployment)
- [How it works](#how-it-works)
- [The mandate](#the-mandate)
- [Fees](#fees)
- [What the owner key can and cannot do](#what-the-owner-key-can-and-cannot-do)
- [$BLVE, the charter](#blve-the-charter)
- [What is live and what is planned](#what-is-live-and-what-is-planned)
- [Repository layout](#repository-layout)
- [Run it locally](#run-it-locally)
- [Tests](#tests)
- [Verify the deployment yourself](#verify-the-deployment-yourself)
- [For agent builders](#for-agent-builders)
- [Security](#security)
- [License](#license)

## What it is

AI agents are starting to pay for things: compute, data, APIs, each other. Most do it with a hot key and a funded wallet, which means a bug, a prompt injection or a leaked key can spend everything in it.

BLACKVEIL gives agents a bank account with rules instead. A person opens an account under a handle (for example `atlas.veil`), keeps a USDG balance, pays names and wallets, and sends requests to pay. For each agent they open a **vault** with its own key and sign a **mandate**: a limit per payment, a limit per rolling 24 hours, a review line, and an optional allowlist. The agent's key can spend from its vault inside that mandate and do nothing else. Every decision the contract makes, including every refusal, is written on chain.

Everything that holds or moves money is one immutable contract, `BlackveilBank`. The website and the small indexer in this repository only read the chain and help you sign transactions; they never hold funds or keys.

## Live deployment

| | |
|---|---|
| Network | Robinhood Chain mainnet (chain id `4663`) |
| BlackveilBank | [`0xA47c92A006C3d8565310aB669ccde65AF229F78A`](https://robinhoodchain.blockscout.com/address/0xA47c92A006C3d8565310aB669ccde65AF229F78A?tab=contract) |
| Deployed | block `91409330`, tx [`0x0d1a6c54…63f1`](https://robinhoodchain.blockscout.com/tx/0x0d1a6c54b39d8e7c930d21c6bddbbca1b15da2fbc2930b1827825cb7608563f1) |
| Settlement token | USDG [`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`](https://robinhoodchain.blockscout.com/token/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) (6 decimals) |
| Source verification | [Sourcify: exact match](https://repo.sourcify.dev/4663/0xA47c92A006C3d8565310aB669ccde65AF229F78A) · [Blockscout: full match](https://robinhoodchain.blockscout.com/address/0xA47c92A006C3d8565310aB669ccde65AF229F78A?tab=contract) |
| Owner | `0x199e809f1c562336e0Ea87B8ec0dD71d26f24B40` |
| Fee recipient | `0xe3cc4B8FDd939366B9D156f162D0d97E967c16E9` |
| $BLVE (charter token) | announced at launch on [@blackveilfi](https://x.com/blackveilfi) and on [blackveil.fi](https://blackveil.fi) first |

More detail, including the mainnet transactions that exercise every feature, is in [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md).

## How it works

```
 person ──(wallet)──▶ BlackveilBank ◀──(agent key)── AI agent
                        │   accounts · handles · requests
                        │   agent vaults · mandates · review queue
                        ▼
                      USDG (held by the contract, owed to accounts)

 browser ──▶ blackveil.fi (static pages + read-only API) ──▶ Robinhood Chain RPC
```

1. **Account.** Your account is your address. Deposit USDG (one approval the first time) and it is credited to your balance in the contract. Withdraw any time, to any address.
2. **Handle.** Claim a name of 3–20 characters (`a–z`, `0–9`, inner hyphens). Five characters or more is free; three and four characters need the charter. Handles are unique and can be changed or released.
3. **Pay.** Pay a handle or an address, from your bank balance or straight from your wallet, into their account or straight into their wallet. The receiver always gets the full amount; the fee is added on the payer.
4. **Request to pay.** Ask for an amount with an optional memo and expiry. Share the link (`/pay?r=<id>`); anyone can settle it once.
5. **Agent vault.** Open a vault for an agent key, sign its mandate, fund it from your balance, and send the key a little ETH for gas. The agent calls `agentPay`; the contract settles, queues or refuses.
6. **Review queue.** Payments above your review line wait, reserved from the vault, until you approve or reject them.

The full function, event and error reference is in [docs/CONTRACT.md](docs/CONTRACT.md); the system design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## The mandate

Before an agent spends, it can ask `routeFor(agentId, recipient, amount)`. `agentPay` applies exactly the same checks, in this order:

| # | Check | Result |
|---|---|---|
| 1 | Agent revoked | **Refuses** (`Revoked`) |
| 2 | Agent paused | **Refuses** (`Paused`) |
| 3 | Amount is zero | **Refuses** (`ZeroAmount`) |
| 4 | Allowlist on and recipient not allowed | **Refuses** (`NotAllowlisted`) |
| 5 | Amount above the per-payment limit | **Refuses** (`OverPerPayment`) |
| 6 | Vault holds less than amount + fee | **Refuses** (`InsufficientVault`) |
| 7 | Amount above the review line | **Queues** for the account owner |
| 8 | Spent in the current 24-hour window + amount above the daily limit | **Refuses** (`OverDaily`) |
| 9 | Otherwise | **Settles** now |

A refusal does not revert: nothing moves, and an `AgentRefused` event records the reason on chain. A queued payment reserves `amount + fee` from the vault; rejecting it returns the reserve. If an agent key leaks, the owner can pause the agent, rotate its key (keeping the vault, mandate and history) or revoke it (the vault returns to the owner's balance in the same transaction). The agent key itself cannot withdraw, change its limits, or rotate its own key.

## Fees

`fee = min(amount × 0.10 %, 2 USDG)`, added on top of the amount and paid by the payer (or taken from the agent vault for agent payments). Deposits, withdrawals, handles, requests and agent set-up are free apart from gas. `FEE_BPS = 10` and `FEE_CAP = 2e6` are compile-time constants: they cannot be changed. Accrued fees are pushed to the fee recipient by `sweepFees()`, which anyone may call.

## What the owner key can and cannot do

The contract has exactly four `onlyOwner` functions:

| Function | Effect |
|---|---|
| `setCharterToken(token)` | Sets the charter token. **Once only**; reverts with `AlreadySet` after that. |
| `setCharterMin(amount)` | Sets how many charter tokens count as holding the charter. |
| `setFeeRecipient(address)` | Chooses where swept fees go. |
| `transferOwnership(address)` | Hands over these four powers. |

There is no pause, no upgrade path, no proxy, no `delegatecall`, no `selfdestruct`, and no function that lets the owner move an account balance, an agent vault or a queued payment. `test_ownerPowersAreNarrow` in the test suite and `tools/verify.mjs` both check this.

## $BLVE, the charter

$BLVE is the charter token of BLACKVEIL, launched on Pons on Robinhood Chain. The contract reads it with `balanceOf`: an account holding at least `charterMin` (planned: 1,000,000 $BLVE) gets **ten** agent vaults instead of one and may claim three- and four-letter handles. It is a key, not a dividend: it pays no yield, and fees go to the fee recipient. Until the token is launched and `setCharterToken` is called, `hasCharter` returns `false` for everyone and every account works with one agent vault and handles of five characters or more.

## What is live and what is planned

| Feature | Status |
|---|---|
| Handles | Live |
| USDG accounts: deposit, pay, withdraw | Live |
| Requests to pay | Live |
| Agent vaults with mandates | Live |
| Review queue (approve / reject) | Live |
| Charter ($BLVE): ten vaults, short handles | Live in the contract; switched on when the token launches |
| Encrypted balances | **Planned, not live.** Today every amount is public on chain, like any token transfer. It will be marked live only when the circuits and verifier are deployed and can be checked. |

## Repository layout

```
contracts/          Foundry project
  src/              BlackveilBank.sol (the deployed source, byte for byte)
  test/             unit + fuzz tests, and a fork test against the real USDG
  lib/forge-std/    vendored forge-std (MIT / Apache-2.0)
server.mjs          static file server + read-only JSON API
server/             RPC client, event indexer, API routes, rate limit
public/             the website: pages, CSS, browser JS, ABI, agent SDK, media
  sdk/              blackveil-agent.mjs, the drop-in module for agents
  src/              a copy of the verified contract source, served at /src/
tools/              deploy, verification, local fork and end-to-end test scripts
docs/               architecture, contract reference, agent guide, verification, deployments, self-hosting
```

## Run it locally

Requirements: Node.js 20 or newer, and [Foundry](https://book.getfoundry.sh/) for the contracts.

```bash
git clone https://github.com/blackveilfi/blackveil.git
cd blackveil
npm ci
npm run serve            # http://127.0.0.1:9150, reading Robinhood Chain mainnet
```

The site reads `public/config.js` for the bank address, RPC and links. The server builds its event index in `data/` on first start (this can take a minute while it scans from the deploy block).

To try every feature without real funds, run a local fork:

```bash
anvil --version                # Foundry installed
npm run fork                   # fresh fork → deploy → seed sample activity → site on :9150
npm run e2e -- 0x<bank printed above>
```

See [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) for a production setup (systemd + Caddy) and every environment variable.

## Tests

```bash
cd contracts
forge test -vv --no-match-contract Fork                                   # unit + fuzz
forge test -vv --match-contract Fork --fork-url https://robinhood-rpc.publicnode.com   # against the real USDG
```

The suite covers deposits and withdrawals, the fee and its cap, wallet-to-wallet payments, handles (including invalid and short handles), every mandate route and refusal reason, the review queue, signer-only spending, revocation, charter slots, requests, the narrow owner powers, and a fuzz test that the USDG held by the contract always equals what it owes (balances + vaults + reserves + accrued fees).

`tools/e2e.mjs` drives the real website in headless Chrome against a local fork with a test wallet: 51 checks, each confirmed on chain.

## Verify the deployment yourself

You do not need to trust this README. [docs/VERIFY.md](docs/VERIFY.md) walks through:

- rebuilding the contract from this repository and comparing it with the bytecode on chain,
- reading the fee constants, the settlement token and the owner from the chain,
- the mainnet transactions that claimed a handle, opened a request, created an agent under a mandate, and logged a refusal,
- `node tools/verify.mjs`, which runs all of these checks in one go.

## For agent builders

```js
import { BlackveilAgent } from './public/sdk/blackveil-agent.mjs'

const agent = new BlackveilAgent({ privateKey: process.env.AGENT_KEY, agentId: 1 })
const check = await agent.route('atlas', '15.00')        // { route: 'Settles' | 'Queues' | 'Refuses', reason }
const paid  = await agent.pay('atlas', '15.00', { ref: 'api credits' })
```

The module needs only `ethers` v6 and works in Node 18+ and in the browser. See [docs/AGENTS.md](docs/AGENTS.md) for set-up, the CLI, error handling and calling the contract directly.

## Security

- The contract has **not** been audited by a third party. It is small, has no external dependencies besides the USDG token, and is covered by the tests above, but use it with amounts you are comfortable with.
- The contract cannot freeze or move your funds. USDG itself is issued by Paxos and is subject to the issuer's own controls and terms.
- Never share an agent private key. Generate one key per agent and keep the mandate tight.

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

The code in this repository is released under the [MIT License](LICENSE). The BLACKVEIL name, logo and artwork are not covered by the license and may not be used to imply endorsement. Third-party components and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

BLACKVEIL is software on a public blockchain, not a licensed bank, and is not affiliated with Robinhood, Paxos or Pons. Nothing here is financial advice.
