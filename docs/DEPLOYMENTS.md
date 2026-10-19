# Deployments

## Robinhood Chain mainnet (chain id 4663)

| Item | Value |
|---|---|
| BlackveilBank | `0xA47c92A006C3d8565310aB669ccde65AF229F78A` |
| Deploy block | `91409330` |
| Deploy transaction | `0x0d1a6c54b39d8e7c930d21c6bddbbca1b15da2fbc2930b1827825cb7608563f1` |
| Deployer / owner | `0x199e809f1c562336e0Ea87B8ec0dD71d26f24B40` |
| Fee recipient | `0xe3cc4B8FDd939366B9D156f162D0d97E967c16E9` |
| Settlement token (USDG) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| Charter token ($BLVE) | not set yet; set once with `setCharterToken` after launch |
| Charter minimum | planned 1,000,000 $BLVE (`setCharterMin`) |
| Compiler | solc `0.8.28+commit.7893614a`, `via_ir`, optimizer 2000 runs, EVM `cancun` |
| Verification | Sourcify exact match · Blockscout full match |
| Explorer | <https://robinhoodchain.blockscout.com/address/0xA47c92A006C3d8565310aB669ccde65AF229F78A> |

Website: <https://blackveil.fi> · X: [@blackveilfi](https://x.com/blackveilfi)

## Network

| | |
|---|---|
| Chain id | `4663` (`0x1237`) |
| Official RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Public RPC | `https://robinhood-rpc.publicnode.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |
| Native gas token | ETH |

## Launch checklist for the charter

When $BLVE launches on Pons:

```bash
node tools/set-ca.mjs 0x<BLVE address>         # dry run: checks it is a Pons token with ticker BLVE, prints the plan
node tools/set-ca.mjs 0x<BLVE address> --go    # setCharterToken (one time) + setCharterMin(1,000,000) + writes public/config.js
```

Both calls are owner transactions and are visible on chain as `CharterTokenSet` and `CharterMinSet`.

## Deploying your own instance

```bash
cd contracts && forge build && cd ..
node tools/deploy.mjs                    # dry run: deployer, balance, gas estimate
OWNER=0x… FEE_TO=0x… node tools/deploy.mjs --go
```

The deployer key is read from `~/.config/blackveil/deployer.json` (`{"privateKey":"0x…"}`) or the path in `DEPLOYER_FILE`. It is never stored in the project and never printed. `--go` writes the new bank address, deploy block and transaction into `public/config.js`.
