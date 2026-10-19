// Wallet picker shared by /app and /pay: detected wallets with their own logos, and — when there is no
// wallet in this browser — install links plus "open in wallet app" deep links for phones.
import { esc } from './common.js';
import { wallets } from './wallet.js';

const KNOWN = [
  { id: 'metamask', name: 'MetaMask', match: /metamask/i, flag: 'isMetaMask', install: 'https://metamask.io/download/', open: u => `https://metamask.app.link/dapp/${u.replace(/^https?:\/\//, '')}` },
  { id: 'rabby', name: 'Rabby', match: /rabby/i, flag: 'isRabby', install: 'https://rabby.io/' },
  { id: 'coinbase', name: 'Coinbase Wallet', match: /coinbase/i, flag: 'isCoinbaseWallet', install: 'https://www.coinbase.com/wallet/downloads', open: u => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(u)}` },
  { id: 'okx', name: 'OKX Wallet', match: /okx/i, flag: 'isOkxWallet', install: 'https://web3.okx.com/download', open: u => `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(u)}` },
  { id: 'phantom', name: 'Phantom', match: /phantom/i, flag: 'isPhantom', install: 'https://phantom.com/download', open: u => `https://phantom.app/ul/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(location.origin)}` },
  { id: 'rainbow', name: 'Rainbow', match: /rainbow/i, flag: 'isRainbow', install: 'https://rainbow.me/download' },
  { id: 'trust', name: 'Trust Wallet', match: /trust/i, flag: 'isTrust', install: 'https://trustwallet.com/download', open: u => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(u)}` },
  { id: 'zerion', name: 'Zerion', match: /zerion/i, flag: 'isZerion', install: 'https://zerion.io/download' },
  { id: 'backpack', name: 'Backpack', match: /backpack/i, flag: 'isBackpack', install: 'https://backpack.app/download' },
];
const logo = id => `/img/wallets/${id}.svg`;
const known = info => KNOWN.find(k => k.match.test(`${info.rdns || ''} ${info.name || ''}`));

function identify(w) {
  const k = known(w.info);
  if (k) return { name: w.info.name || k.name, icon: w.info.icon || logo(k.id) };
  // a bare window.ethereum: read the usual flags
  const p = w.provider || {};
  const f = KNOWN.find(x => p[x.flag]);
  return { name: f ? f.name : (w.info.name || 'Browser wallet'), icon: w.info.icon || (f ? logo(f.id) : '/img/wallets/generic.svg') };
}

export function renderPicker(box, onPick) {
  const list = wallets();
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (list.length) {
    box.innerHTML = `<div class="wl">${list.map((w, i) => {
      const { name, icon } = identify(w);
      return `<button class="wl-item" data-w="${i}"><img src="${esc(icon)}" alt="" width="28" height="28"><span>${esc(name)}</span><em>Detected</em></button>`;
    }).join('')}</div>`;
    box.querySelectorAll('[data-w]').forEach(b => b.onclick = () => onPick(list[+b.dataset.w].provider));
    return;
  }
  const here = location.href;
  box.innerHTML = `
    <p class="p small" style="margin:0 0 12px">${mobile ? 'Open this page inside your wallet app:' : 'No wallet found in this browser. Install one, then reload this page:'}</p>
    <div class="wl">${KNOWN.filter(k => !mobile || k.open).slice(0, mobile ? 5 : 6).map(k => mobile
      ? `<a class="wl-item" href="${esc(k.open(here))}"><img src="${logo(k.id)}" alt="" width="28" height="28"><span>${k.name}</span><em>Open</em></a>`
      : `<a class="wl-item" href="${k.install}" target="_blank" rel="noopener"><img src="${logo(k.id)}" alt="" width="28" height="28"><span>${k.name}</span><em>Install</em></a>`).join('')}</div>
    <p class="p small" style="margin:12px 0 0">Any wallet that supports Robinhood Chain (chain 4663) works — the page adds the network for you.</p>`;
}
