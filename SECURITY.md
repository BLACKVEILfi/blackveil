# Security policy

## Reporting a vulnerability

Please report security issues **privately**. Do not open a public issue for anything that could put funds at risk.

- GitHub: use **Security → Report a vulnerability** on this repository (private advisory), or
- X: send a direct message to [@blackveilfi](https://x.com/blackveilfi) asking for a private channel.

Include the affected component (contract, website, API, SDK), steps to reproduce, and the impact you expect. We will acknowledge within 72 hours and keep you informed until it is resolved. We will credit reporters who wish to be credited.

BLACKVEIL will never ask you for a seed phrase or a private key, and will never send you a contract address in a direct message before it is posted publicly on [@blackveilfi](https://x.com/blackveilfi) and [blackveil.fi](https://blackveil.fi).

## Scope

| In scope | Notes |
|---|---|
| `contracts/src/BlackveilBank.sol` at `0xA47c92A006C3d8565310aB669ccde65AF229F78A` | loss or lock of funds, bypassing a mandate, an agent key acting outside its mandate, the owner key moving user funds, accounting errors |
| `public/` (blackveil.fi) | anything that could make a user sign something they did not intend |
| `public/sdk/blackveil-agent.mjs` | anything that could make an agent pay outside what its caller asked |
| `server/` | anything beyond showing wrong information (the API is read-only) |

Out of scope: issues in third-party wallets, the USDG token, Robinhood Chain itself, rate limits of public RPCs, and denial of service by spamming the public API.

## Known properties and limitations

These are by design and documented; please do not report them as vulnerabilities.

- **No third-party audit yet.** The contract is small and covered by unit, fuzz and fork tests, but it has not been audited by an external firm.
- **Amounts are public.** Encrypted balances are planned and not live. Every amount is visible on chain.
- **Single-key owner.** The owner is currently one externally owned account. Its powers are limited to the charter token (once), the charter minimum, the fee recipient and ownership transfer. It cannot move user funds.
- **USDG issuer controls.** USDG is issued by Paxos. The bank contract cannot freeze funds, but the token itself is subject to its issuer's terms and controls.
- **Agent keys are hot keys.** Whoever holds an agent key can spend inside that agent's mandate. Keep the mandate tight; pause, rotate or revoke as soon as a key is suspected to be exposed.
- **Approved queue payments are not counted against the daily limit.** Approving is the account owner's own decision.
- **Lowering the charter minimum does not remove existing agents or handles.** It only affects new `createAgent` and `setHandle` calls.

## Safe use

- Check that you are on `https://blackveil.fi` before connecting a wallet.
- Check the bank address `0xA47c92A006C3d8565310aB669ccde65AF229F78A` in your wallet's transaction preview.
- Use one agent key per agent; never reuse your own wallet key as an agent key.
