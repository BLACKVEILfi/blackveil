#!/usr/bin/env bash
# LOCAL ONLY: fresh Robinhood Chain fork → deploy BlackveilBank → seed sample activity → serve the site on :9150.
# RPCs only keep ~10k blocks (~15 min) of state, so a fork goes stale fast: run this right before testing.
# Uses the official RPC through tools/rpc-proxy.mjs on :8546 when it is running, else dRPC.
#   tools/local-fresh.sh            then: node tools/e2e.mjs <bank printed below>
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${TMPDIR:-/tmp}/blackveil-local"; mkdir -p "$LOG"
for port in 8545 9150; do pid=$(lsof -ti tcp:$port -sTCP:LISTEN || true); [ -n "$pid" ] && kill $pid || true; done
sleep 1
FORK_URL="${FORK_URL:-$(curl -sf -m 3 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8546 >/dev/null && echo http://127.0.0.1:8546 || echo https://robinhood.drpc.org)}"
echo "fork from $FORK_URL"
anvil --fork-url "$FORK_URL" --no-storage-caching --retries 12 --port 8545 --chain-id 4663 > "$LOG/anvil.log" 2>&1 &
for i in $(seq 1 60); do cast chain-id --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1 && break; sleep 1; done
cd "$HERE"
D=$(node -e "const {ethers}=require('ethers');console.log(new ethers.Wallet(ethers.id('blackveil.local.deployer')).address)")
cast rpc anvil_setBalance "$D" 0x8AC7230489E80000 --rpc-url http://127.0.0.1:8545 >/dev/null
OUT=$(node tools/deploy.mjs --local --go)
BANK=$(echo "$OUT" | grep -oE 'BlackveilBank 0x[0-9a-fA-F]{40}' | awk '{print $2}')
BLOCK=$(echo "$OUT" | grep -oE 'block [0-9]+' | head -1 | awk '{print $2}')
rm -f data/index-local-*.json
node tools/seed-local.mjs "$BANK" > "$LOG/seed.log"
LOCAL_RPC=http://127.0.0.1:8545 BANK="$BANK" DEPLOY_BLOCK="$BLOCK" nohup node server.mjs > "$LOG/server.log" 2>&1 &
for i in $(seq 1 30); do curl -sf localhost:9150/api/health >/dev/null && break; sleep 1; done
sleep 5
echo "bank $BANK · block $BLOCK · site http://127.0.0.1:9150"
