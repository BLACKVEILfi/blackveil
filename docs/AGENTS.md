# Giving an AI agent a vault

An agent in BLACKVEIL is a key with its own vault and a mandate. The key can call one function, `agentPay`, and only inside the limits the account owner signed.

## 1. Set up (account owner)

On [blackveil.fi/app](https://blackveil.fi/app) → **Agents**:

1. **Agent key.** Press *Generate* to create a key in your browser (save it; it is shown once), or paste the address of a key your agent already uses.
2. **Mandate.** *Per payment*, *Per 24 hours*, *Review above*, and optionally *Only pay recipients I allowlist*. Press **Open agent**.
3. **Fund the vault** from your bank balance (*Fund vault*).
4. **Send gas**: the agent key pays its own transaction fees in ETH. A small amount is enough on Robinhood Chain.

Without the charter an account has one live agent; holding the charter ($BLVE) allows ten.

## 2. The module

[`public/sdk/blackveil-agent.mjs`](../public/sdk/blackveil-agent.mjs) needs only `ethers` v6 and runs in Node 18+ and in the browser.

```bash
npm i ethers
curl -O https://blackveil.fi/sdk/blackveil-agent.mjs
```

```js
import { BlackveilAgent } from './blackveil-agent.mjs'

const agent = new BlackveilAgent({
  privateKey: process.env.AGENT_KEY,   // the agent key, never the owner's
  agentId: 1,                          // shown on the agent card in /app
  // bank, rpc: optional overrides (defaults: the mainnet bank, publicnode RPC)
})

// Ask first. No transaction is sent.
const r = await agent.route('atlas', '15.00')
// → { to: '0x…', route: 'Settles' | 'Queues' | 'Refuses', reason: 'None' | 'OverPerPayment' | … }

// Pay. Recipients are handles ('atlas' or 'atlas.veil') or 0x addresses.
const paid = await agent.pay('atlas', '15.00', { ref: 'api credits', toWallet: false })
// → { route, reason, sent: true, hash, pendingId }   pendingId is set when the payment was queued

// Current limits and vault.
const s = await agent.status()
// → { owner, signer, status, vault, spentToday, perPayment, perDay, reviewAbove, allowlistOnly }
```

By default a payment the contract would refuse is **not** sent (`sent: false`), so the agent does not spend gas on it. Pass `recordRefusals: true` to the constructor to send it anyway and have the refusal written on chain.

### CLI

```bash
AGENT_KEY=0x… AGENT_ID=1 node blackveil-agent.mjs status
AGENT_KEY=0x… AGENT_ID=1 node blackveil-agent.mjs route atlas 15
AGENT_KEY=0x… AGENT_ID=1 node blackveil-agent.mjs pay   atlas 15 "invoice 42"
```

`BANK` and `RPC` environment variables override the defaults.

## 3. Settles, queues, refuses

| Situation | Route | What happens |
|---|---|---|
| inside every limit | Settles | paid now; `amount + fee` leaves the vault |
| above the review line | Queues | `amount + fee` is reserved; the owner approves or rejects in /app |
| anything else | Refuses | nothing moves; `AgentRefused(id, to, amount, reason, ref)` is emitted |

The exact order of checks is in [CONTRACT.md](CONTRACT.md#route-order-routefor-and-agentpay).

## 4. Reason codes

| Code | Name | What to do |
|---|---|---|
| 0 | None | settled or queued |
| 1 | Paused | the owner paused the agent |
| 2 | Revoked | the agent was revoked; ask for a new one |
| 3 | ZeroAmount | send a positive amount |
| 4 | NotAllowlisted | ask the owner to allow this recipient |
| 5 | OverPerPayment | split the payment or ask for a higher limit |
| 6 | OverDaily | wait for the window to reset or ask for a higher limit |
| 7 | InsufficientVault | ask the owner to fund the vault |

## 5. What the agent key cannot do

- withdraw from the vault or from the owner's balance,
- change its own limits or allowlist,
- approve its own queued payments,
- rotate its own key, un-pause or un-revoke itself.

These are owner-only (`NotAgentOwner`). If the key leaks: **pause** (instant stop), **rotate** (new key, same vault and history), or **revoke** (permanent; the vault returns to the owner's balance in the same transaction).

## 6. Calling the contract directly

Any Ethereum library works. With `cast`:

```bash
BANK=0xA47c92A006C3d8565310aB669ccde65AF229F78A
RPC=https://robinhood-rpc.publicnode.com

cast call $BANK "routeFor(uint256,address,uint256)(uint8,uint8)" 1 0xRecipient 15000000 --rpc-url $RPC
cast send $BANK "agentPay(uint256,address,uint256,bytes32,bool)" 1 0xRecipient 15000000 \
  $(cast format-bytes32-string "api credits") false --private-key $AGENT_KEY --rpc-url $RPC
```

Amounts are in USDG base units (`15 USDG = 15000000`).
