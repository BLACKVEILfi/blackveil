// LOCAL ONLY: plain-HTTP proxy on 127.0.0.1:8546 → the official Robinhood Chain RPC.
// Some networks block the RPC hostname at the DNS level, so we connect to the Cloudflare IP and set SNI + Host by hand
// (same trick as server/rpc.mjs). Lets anvil fork from the official node instead of a flaky public mirror.
//   node tools/rpc-proxy.mjs
import http from 'node:http';
import https from 'node:https';

const HOST = 'rpc.mainnet.chain.robinhood.com', IP = process.env.RH_RPC_IP || '104.20.46.209', PORT = Number(process.env.PROXY_PORT || 8546);
http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const up = https.request({ host: IP, servername: HOST, port: 443, method: 'POST', path: '/',
      headers: { host: HOST, 'content-type': 'application/json', 'content-length': body.length }, timeout: 60000 }, r => {
      res.writeHead(r.statusCode, { 'content-type': 'application/json' });
      r.pipe(res);
    });
    up.on('timeout', () => up.destroy(new Error('timeout')));
    up.on('error', e => { if (!res.headersSent) res.writeHead(502); res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'proxy: ' + e.message } })); });
    up.end(body);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`rpc proxy → ${HOST} on http://127.0.0.1:${PORT}`));
