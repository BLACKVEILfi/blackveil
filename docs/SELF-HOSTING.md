# Self-hosting the website and API

The site is a single Node process serving static files and a read-only API. It holds no keys and no funds.

## Requirements

- Node.js 20+ (uses `--env-file-if-exists`, built-in `fetch`)
- Outbound HTTPS to a Robinhood Chain RPC
- ~50 MB disk for the event index in `data/`

## Run

```bash
npm ci --omit=dev
PUBLIC=1 PORT=9150 HOST=127.0.0.1 node server.mjs
```

Or copy `.env.example` to `.env` and run `npm run serve`.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `9150` | listen port |
| `HOST` | `127.0.0.1` | listen address (keep it local and put a reverse proxy in front) |
| `PUBLIC` | unset | `1` on a public server: paths starting with `/_` return 404 |
| `RPC_URL` | `https://robinhood-rpc.publicnode.com` | RPC for reads |
| `RH_RPC_IP` | `104.20.46.209` | IP used to reach the official RPC when its hostname cannot be resolved locally |
| `RPC_GAP_MS` | `220` | minimum gap between RPC requests from the indexer |
| `SYNC_MS` | `4000` | indexer poll interval |
| `LOCAL_RPC` | unset | send every RPC call to a local node (for a fork) |
| `BANK`, `DEPLOY_BLOCK` | from `public/config.js` | override the bank address / first block to index (used with `LOCAL_RPC`) |

## systemd

```ini
# /etc/systemd/system/blackveil.service
[Unit]
Description=BLACKVEIL web + API
After=network-online.target
Wants=network-online.target

[Service]
User=blackveil
WorkingDirectory=/srv/blackveil
Environment=PORT=9150
Environment=HOST=127.0.0.1
Environment=PUBLIC=1
ExecStart=/usr/bin/node --env-file-if-exists=/srv/blackveil/.env server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/srv/blackveil/data

[Install]
WantedBy=multi-user.target
```

## Caddy (automatic HTTPS)

```caddy
example.com {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}
	reverse_proxy 127.0.0.1:9150
}
www.example.com {
	redir https://example.com{uri} permanent
}
```

The Node server itself adds `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'` and a restrictive `Permissions-Policy` to every file it serves.

## Pointing at another deployment

Edit `public/config.js` (`bank`, `deployBlock`, `deployTx`, `ca`, links) and restart. The indexer starts a new index file for the new bank address.

## Local fork for development

```bash
node tools/rpc-proxy.mjs &      # optional: plain-HTTP proxy to the official RPC on :8546
tools/local-fresh.sh            # anvil fork → deploy → seed sample activity → site on :9150
node tools/e2e.mjs 0x<bank>     # 51 browser checks against the fork (needs Google Chrome)
```

Public RPCs keep only recent state (roughly the last 10,000 blocks), so start the end-to-end run right after creating the fork.
