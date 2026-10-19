// Edit and redeploy this file only (./deploy.sh config) to change links, the token and the bank address.
window.BLACKVEIL_CONFIG = {
  ticker: 'BLVE',
  ca: null,                 // $BLVE contract address once launched (full 0x… address) — node tools/set-ca.mjs 0x…
  caPlaceholder: 'UNDER THE VEIL',
  bank: '0xA47c92A006C3d8565310aB669ccde65AF229F78A',               // BlackveilBank contract on Robinhood Chain — written by tools/deploy.mjs
  deployBlock: 91409330,
  deployTx: '0x0d1a6c54b39d8e7c930d21c6bddbbca1b15da2fbc2930b1827825cb7608563f1',
  usdg: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  chainId: 4663,
  rpc: 'https://robinhood-rpc.publicnode.com',
  explorer: 'https://robinhoodchain.blockscout.com',
  sourcify: 'https://repo.sourcify.dev/4663/',
  domain: 'blackveil.fi',
  x: 'https://x.com/blackveilfi',
  telegram: 'https://t.me/blackveilfi',
  github: 'https://github.com/BLACKVEILfi/blackveil',
  pons: 'https://pons.trade/token/',
};
