# BlackveilBank contract reference

Source: [`contracts/src/BlackveilBank.sol`](../contracts/src/BlackveilBank.sol) · Solidity `0.8.28` · `via_ir`, optimizer 2000 runs, EVM `cancun` · license MIT.

Deployed on Robinhood Chain (`4663`) at [`0xA47c92A006C3d8565310aB669ccde65AF229F78A`](https://robinhoodchain.blockscout.com/address/0xA47c92A006C3d8565310aB669ccde65AF229F78A?tab=contract).

All amounts are in USDG base units (6 decimals): `1 USDG = 1_000_000`.

## Design rules

- One immutable contract. No proxy, no upgrade, no pause, no `delegatecall`, no `selfdestruct`.
- The only external call is to the USDG token (`transfer`, `transferFrom`) and, for the charter, `balanceOf` on the charter token.
- Every state-changing function that moves tokens is guarded by a reentrancy lock.
- The owner can configure the charter and the fee recipient. The owner cannot touch account balances, agent vaults or queued payments.
- An agent refusal is a successful transaction that moves nothing and emits `AgentRefused`, so the reason is permanently on chain.

## Constants

| Name | Value | Meaning |
|---|---|---|
| `FEE_BPS` | `10` | 0.10 % fee on every payment |
| `FEE_CAP` | `2e6` | fee never exceeds 2 USDG |
| `FREE_AGENT_SLOTS` | `1` | live agent vaults per account without the charter |
| `CHARTER_AGENT_SLOTS` | `10` | live agent vaults per account with the charter |
| `SHORT_HANDLE_MAX` | `4` | handles of 3–4 characters need the charter |
| `WINDOW` | `1 days` | length of the rolling daily-limit window |
| `KIND_DIRECT` / `KIND_REQUEST` / `KIND_AGENT` / `KIND_APPROVED` | `0` / `1` / `2` / `3` | the `kind` field of a `Payment` event |

## Storage you can read

| Function | Returns |
|---|---|
| `usdg()` | the settlement token (immutable) |
| `owner()`, `feeRecipient()` | current owner and fee recipient |
| `charterToken()`, `charterMin()` | charter token (zero until set) and threshold |
| `feesAccrued()` | fees collected and not yet swept |
| `balanceOf(address)` | an account's bank balance |
| `handleOf(address)`, `handleOwner(bytes32)`, `resolve(string)` | handle lookups (`handleOwner` is keyed by `keccak256(handle)`) |
| `agent(id)` | `Agent` struct; `spent` reports the current window (0 once the window has passed) |
| `agentCount()`, `agentsOf(address)`, `liveAgents(address)`, `agentSlots(address)` | agent bookkeeping |
| `allowed(id, recipient)` | allowlist entry |
| `pending(id)`, `pendingCount()` | review queue entries |
| `request(id)`, `requestCount()` | requests to pay |
| `hasCharter(address)` | `charterToken.balanceOf(account) >= charterMin` (false while no token is set) |
| `feeFor(amount)` | `min(amount * 10 / 10000, 2e6)` |
| `routeFor(id, to, amount)` | `(Route, Reason)` the contract would apply right now |

### Structs

```solidity
struct Agent   { address owner; address signer; uint256 perPayment; uint256 perDay; uint256 reviewAbove;
                 uint256 vault; uint256 spent; uint256 windowStart; uint8 status; bool allowlistOnly; }
struct Pending { uint256 agentId; address to; uint256 amount; uint256 fee; bytes32 ref; bool toWallet; uint8 state; }
struct Request { address payee; uint256 amount; uint64 expiry; uint8 state; bytes32 memo; }
```

`Agent.status`: `1` active, `2` paused, `3` revoked. `Pending.state` and `Request.state`: `1` open, `2` done (paid / approved), `3` closed (cancelled / rejected).

### Enums

```solidity
enum Route  { Settles, Queues, Refuses }
enum Reason { None, Paused, Revoked, ZeroAmount, NotAllowlisted, OverPerPayment, OverDaily, InsufficientVault }
```

## Accounts and payments

| Function | Notes |
|---|---|
| `deposit(amount)` | pulls USDG from your wallet (approve the bank first) and credits your balance |
| `withdraw(amount, to)` | sends USDG from your balance to any address |
| `pay(to, amount, ref, fromWallet, toWallet)` | pays an address. `fromWallet` pulls `amount + fee` from your wallet instead of your balance; `toWallet` sends USDG to the receiver's wallet instead of crediting their balance. The receiver always gets `amount`. |
| `payHandle(handle, amount, ref, fromWallet, toWallet)` | same, by handle; reverts `NoHandle` if nobody holds it |
| `sweepFees()` | anyone may call; sends `feesAccrued` to `feeRecipient` |

`ref` is a `bytes32` memo (the website encodes up to 31 bytes of text).

## Handles

| Function | Notes |
|---|---|
| `setHandle(handle)` | 3–20 chars, lowercase `a–z`, `0–9`, hyphens not at the ends. 3–4 chars need the charter (`CharterRequired`). Taken handles revert `HandleTaken`. Your previous handle is released. |
| `releaseHandle()` | gives up your handle |

## Requests to pay

| Function | Notes |
|---|---|
| `createRequest(amount, expiry, memo)` | `expiry = 0` means never; otherwise it must be in the future |
| `cancelRequest(id)` | payee only, while open |
| `payRequest(id, fromWallet)` | anyone; pays the payee's account, once; reverts `Expired` / `NotOpen` |

## Agents

| Function | Caller | Notes |
|---|---|---|
| `createAgent(signer, perPayment, perDay, reviewAbove, allowlistOnly)` | account | needs a free slot (`NoSlot`) |
| `fundAgent(id, amount)` / `defundAgent(id, amount)` | agent owner | moves USDG between your balance and the vault |
| `setMandate(id, perPayment, perDay, reviewAbove, allowlistOnly)` | agent owner | |
| `setAllowed(id, recipient, ok)` | agent owner | allowlist entries |
| `pauseAgent(id, paused)` | agent owner | a paused agent's payments are refused |
| `rotateSigner(id, signer)` | agent owner | new key; vault, mandate and history stay |
| `revokeAgent(id)` | agent owner | permanent; the vault returns to the owner's balance in the same transaction and the slot frees up |
| `agentPay(id, to, amount, ref, toWallet)` | the agent's signer | settles, queues or refuses (see below); returns `(route, pendingId)` |
| `approve(pendingId)` / `reject(pendingId)` | agent owner | approve settles a queued payment; reject returns the reserve to the vault (or to the owner's balance if the agent was revoked) |

### Route order (`routeFor` and `agentPay`)

1. revoked → `Refuses / Revoked`
2. paused → `Refuses / Paused`
3. `amount == 0` → `Refuses / ZeroAmount`
4. allowlist on and `to` not allowed → `Refuses / NotAllowlisted`
5. `amount > perPayment` → `Refuses / OverPerPayment`
6. `vault < amount + fee` → `Refuses / InsufficientVault`
7. `amount > reviewAbove` → `Queues` (reserves `amount + fee` from the vault)
8. spent in the current window + `amount > perDay` → `Refuses / OverDaily`
9. otherwise → `Settles` (fee taken from the vault, window updated)

The daily window starts with the first settled payment and resets `WINDOW` later. Payments approved from the queue are not counted against the daily limit: approving them is the owner's own decision.

## Owner

| Function | Notes |
|---|---|
| `setCharterToken(token)` | once only (`AlreadySet`) |
| `setCharterMin(amount)` | threshold for `hasCharter` |
| `setFeeRecipient(recipient)` | |
| `transferOwnership(next)` | |

Lowering the charter does not revoke agents an account already has; it only affects new `createAgent` and `setHandle` calls.

## Events

```solidity
event Deposited(address indexed account, uint256 amount);
event Withdrawn(address indexed account, address indexed to, uint256 amount);
event Payment(address indexed from, address indexed to, uint256 amount, uint256 fee, bytes32 ref, uint8 kind, uint256 refId, bool toWallet);
event HandleSet(address indexed account, string handle, string previous);
event RequestCreated(uint256 indexed id, address indexed payee, uint256 amount, uint64 expiry, bytes32 memo);
event RequestCancelled(uint256 indexed id);
event AgentCreated(uint256 indexed id, address indexed owner, address indexed signer);
event AgentFunded(uint256 indexed id, uint256 amount);
event AgentDefunded(uint256 indexed id, uint256 amount);
event MandateSet(uint256 indexed id, uint256 perPayment, uint256 perDay, uint256 reviewAbove, bool allowlistOnly);
event AllowSet(uint256 indexed id, address indexed recipient, bool allowed);
event AgentStatus(uint256 indexed id, uint8 status);
event SignerRotated(uint256 indexed id, address indexed signer);
event AgentRefused(uint256 indexed id, address indexed to, uint256 amount, Reason reason, bytes32 ref);
event Queued(uint256 indexed pendingId, uint256 indexed agentId, address indexed to, uint256 amount, bytes32 ref);
event Approved(uint256 indexed pendingId);
event Rejected(uint256 indexed pendingId);
event CharterTokenSet(address token);
event CharterMinSet(uint256 amount);
event FeeRecipientSet(address recipient);
event FeesSwept(address indexed to, uint256 amount);
event OwnershipTransferred(address indexed previous, address indexed next);
```

## Errors

`AgentNotLive`, `AlreadySet`, `BadHandle`, `CharterRequired`, `Expired`, `HandleTaken`, `InsufficientBalance`, `InsufficientVault`, `NoHandle`, `NoSlot`, `NotAgentOwner`, `NotOpen`, `NotOwner`, `NotSigner`, `Reentrant`, `TransferFailed`, `UnknownAgent`, `UnknownPending`, `UnknownRequest`, `ZeroAddress`, `ZeroAmount`.

The full ABI is in [`public/abi/BlackveilBank.json`](../public/abi/BlackveilBank.json).
