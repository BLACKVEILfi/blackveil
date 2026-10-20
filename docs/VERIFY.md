# Verify BLACKVEIL yourself

Every claim on [blackveil.fi](https://blackveil.fi) can be checked without trusting us. This page lists how.

Bank: `0xA47c92A006C3d8565310aB669ccde65AF229F78A` on Robinhood Chain (`4663`).
Public RPC used below: `https://robinhood-rpc.publicnode.com`.

## 1. The deployed code is this repository

**Third-party verification**

- Sourcify: [exact match](https://repo.sourcify.dev/4663/0xA47c92A006C3d8565310aB669ccde65AF229F78A) (creation and runtime bytecode, including the metadata hash).
- Blockscout: [full match](https://robinhoodchain.blockscout.com/address/0xA47c92A006C3d8565310aB669ccde65AF229F78A?tab=contract), with the constructor arguments decoded (USDG, owner, fee recipient).

**Rebuild it yourself**

```bash
cd contracts
forge build                       # solc 0.8.28, via_ir, optimizer 2000 runs, evm cancun (foundry.toml)
cd ..
node tools/compare-bytecode.mjs   # fetches the on-chain code and compares
```

Expected output:

```
on-chain code 12524 bytes · local build 12524 bytes · 3 immutable slot(s) filled (usdg = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168)
✓ runtime bytecode matches this repository byte for byte
```

The only immutable is the settlement token; the script checks that each immutable slot holds exactly `usdg()` before comparing the rest.

`public/src/BlackveilBank.sol` (served at [blackveil.fi/src/BlackveilBank.sol](https://blackveil.fi/src/BlackveilBank.sol)) is the same file as `contracts/src/BlackveilBank.sol`.

## 2. The facts on the site

```bash
BANK=0xA47c92A006C3d8565310aB669ccde65AF229F78A
RPC=https://robinhood-rpc.publicnode.com

cast call $BANK "usdg()(address)"          --rpc-url $RPC   # 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
cast call $BANK "FEE_BPS()(uint256)"       --rpc-url $RPC   # 10   → 0.10 %
cast call $BANK "FEE_CAP()(uint256)"       --rpc-url $RPC   # 2000000 → 2 USDG
cast call $BANK "owner()(address)"         --rpc-url $RPC
cast call $BANK "feeRecipient()(address)"  --rpc-url $RPC
cast call $BANK "charterToken()(address)"  --rpc-url $RPC   # 0xC51b827315efb953BD53643d3BC6db08fe67C724 ($BLVE)
```

`FEE_BPS` and `FEE_CAP` are `constant` in the source: there is no setter for them.

## 3. The owner's powers are narrow

In the source, search for `onlyOwner`: it appears on exactly four functions (`setCharterToken`, `setCharterMin`, `setFeeRecipient`, `transferOwnership`). There is no `pause`, no `upgrade`, no `delegatecall`, no `selfdestruct`, and no function that lets the owner move balances, vaults or queued payments. `tools/verify.mjs` scans the source for exactly this list, and the test `test_ownerPowersAreNarrow` checks that a non-owner is rejected, that the charter token can be set only once, and that `transferOwnership` removes the old owner's powers.

## 4. Every feature has run on mainnet

| Feature | Transaction | What to look for |
|---|---|---|
| Deployment | [`0x0d1a6c54…63f1`](https://robinhoodchain.blockscout.com/tx/0x0d1a6c54b39d8e7c930d21c6bddbbca1b15da2fbc2930b1827825cb7608563f1) | constructor args: USDG, owner, fee recipient |
| Handle | [`0x02280ed6…509a`](https://robinhoodchain.blockscout.com/tx/0x02280ed63fc43caa6f9325e9cae5da10093e8c59f93add3baa987f1b6a9e509a?tab=logs) | `HandleSet` → `blackveil` |
| Request to pay | [`0xd4dfd6d5…f188`](https://robinhoodchain.blockscout.com/tx/0xd4dfd6d52edb4a69e012d7633b917dabd29734e6098027359595900328b7f188?tab=logs) | `RequestCreated` #1, 25 USDG, memo "first request" |
| Agent under a mandate | [`0x7fb7c811…da0b`](https://robinhoodchain.blockscout.com/tx/0x7fb7c8110e7ecf995acbe2efb838bebfb75e9530824a828457444d21ba36da0b?tab=logs) | `AgentCreated` #1; `MandateSet` 50 per payment, 200 per day, review above 20 |
| Gas to the agent key | [`0xe055f066…aada`](https://robinhoodchain.blockscout.com/tx/0xe055f066e5bb9dfc5ce9f2dc8bfa8fbce615518f1450392fb1adfed62171aada) | ETH transfer to the agent key |
| A refusal, logged | [`0x93ced50d…58f7`](https://robinhoodchain.blockscout.com/tx/0x93ced50d64c03b4323d8fc29fc90493bfb0cd94051ebaf08effd9ba451f258f7?tab=logs) | `AgentRefused`: 15 USDG, reason `7` (`InsufficientVault`); the transaction succeeded and nothing moved |

## 5. All checks in one command

```bash
npm ci
node tools/verify.mjs
```

It checks the Sourcify match, the settlement token, the fee constants, the owner functions in the source, the handle, request #1, agent #1's mandate, the logged refusal and the size of the test suite, and writes the results to `media/proof/verify.json`.

## 6. The website matches the chain

The [Verify page](https://blackveil.fi/verify) reads the same facts live with `eth_call`, and every activity row on the site links to its transaction. The numbers on the home page come from the contract's own event log (`GET /api/stats`, recomputable with `eth_getLogs`).
