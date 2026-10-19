# Tools

Scripts for deploying, verifying and testing BLACKVEIL. None of them store or print private keys; scripts that sign read the key from a file outside the project (`~/.config/blackveil/…` or the path in an environment variable).

| Script | What it does |
|---|---|
| `compare-bytecode.mjs` | compares the runtime bytecode built from `contracts/` with the code on chain, byte for byte (`npm run verify:bytecode`) |
| `verify.mjs` | checks every public claim against the chain and Sourcify; writes `media/proof/verify.json` (`npm run verify`) |
| `verify-source.mjs` | publishes the verified source to Sourcify and Blockscout for a deployed address |
| `deploy.mjs` | deploys `BlackveilBank` (dry run by default, `--go` to send, `--local` for a fork) |
| `set-ca.mjs` | after the $BLVE launch: checks the token, sets the charter token (once) and minimum, updates `public/config.js` |
| `proof-tx.mjs` | the gas-only mainnet transactions that exercise handles, requests, agents and a logged refusal (`media/proof/proof-tx.json`) |
| `local-fresh.sh` | fresh anvil fork of Robinhood Chain → deploy → seed sample activity → site on `:9150` (`npm run fork`) |
| `seed-local.mjs` | sample accounts, handles, payments, requests and agent activity on a local fork (refuses to run against anything but localhost) |
| `rpc-proxy.mjs` | plain-HTTP proxy on `:8546` to the official RPC, for networks that block its hostname |
| `e2e.mjs` | 51 end-to-end checks of the website in headless Chrome against a local fork, each confirmed on chain (`npm run e2e -- 0x<bank>`) |
| `qa-mobile.mjs` | phone-width checks of every page (no sideways scroll, no page errors) |

Browser-based scripts use Google Chrome; set `CHROME_PATH` if it is not in the default macOS location.
