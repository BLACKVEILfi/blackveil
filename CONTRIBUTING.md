# Contributing

Thanks for taking a look. Issues and pull requests are welcome.

## Ground rules

- **Security issues go through [SECURITY.md](SECURITY.md)**, never a public issue.
- The deployed contract is immutable. Changes to `contracts/src/` describe a future deployment and must keep every existing test passing; `public/src/BlackveilBank.sol` must stay identical to the deployed source.
- No new runtime dependencies for the website or server without a clear reason. The site has no build step and no third-party scripts, on purpose.
- Never commit keys, `.env` files or the `data/` index.
- Do not run `forge fmt` on `contracts/src/BlackveilBank.sol`: any change, even whitespace, changes the metadata hash, and the file would no longer match the verified deployment.

## Before opening a pull request

```bash
cd contracts && forge test -vv --no-match-contract Fork && cd ..
npm run check          # node --check on every server, site and tool script
```

If you change anything in `public/` or `server/`, run the local fork and the end-to-end test:

```bash
tools/local-fresh.sh
node tools/e2e.mjs 0x<bank printed by local-fresh>
```

Describe what changed, why, and how you tested it.
