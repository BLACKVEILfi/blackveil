// Renders BlackveilBank events (from /api/activity) as readable ledger rows. Every row links its transaction.
import { esc, usd, ago, txUrl, who, short } from './common.js';

const REASON = {
  OverPerPayment: 'over the per-payment limit', OverDaily: 'over the 24-hour limit', InsufficientVault: 'vault too low',
  NotAllowlisted: 'recipient not on the allowlist', Paused: 'agent paused', Revoked: 'agent revoked', ZeroAmount: 'zero amount',
};

export function describe(r) {
  const amt = r.amount != null ? `${usd(r.amount)} <span class="dim">USDG</span>` : '';
  const ref = r.ref ? ` · “${esc(r.ref)}”` : '';
  switch (r.name) {
    case 'Payment': {
      const how = { direct: 'paid', request: 'settled a request from', agent: 'agent paid', approved: 'approved a queued payment to' }[r.kind] || 'paid';
      const route = r.kind === 'agent' || r.kind === 'approved' ? '<span class="route Settles">Settles</span>' : '';
      return { t: `${who(r.who, r.whoHandle)} ${how} ${who(r.to, r.toHandle)}`, s: `${r.kind === 'agent' ? 'agent #' + r.refId + ' · ' : ''}fee ${usd(r.fee, 4)}${ref}${r.toWallet ? ' · to wallet' : ''}`, route, amt };
    }
    case 'Deposited': return { t: `${who(r.who, r.whoHandle)} deposited`, s: 'USDG into the account', amt };
    case 'Withdrawn': return { t: `${who(r.who, r.whoHandle)} withdrew`, s: `to ${esc(short(r.to))}`, amt };
    case 'HandleSet': return r.handle
      ? { t: `<b>${esc(r.handle)}</b><span class="dim">.veil</span> was claimed`, s: r.previous ? `was ${esc(r.previous)}.veil` : esc(short(r.who)), amt: '' }
      : { t: `<b>${esc(r.previous)}</b><span class="dim">.veil</span> was released`, s: esc(short(r.who)), amt: '' };
    case 'AgentCreated': return { t: `${who(r.who, r.whoHandle)} opened agent #${r.agentId}`, s: `signer ${esc(short(r.signer))}`, amt: '' };
    case 'MandateSet': return { t: `Mandate set for agent #${r.agentId}`, s: `${usd(r.perPayment, 0)} per payment · ${usd(r.perDay, 0)} per day · review above ${usd(r.reviewAbove, 0)}${r.allowlistOnly ? ' · allowlist only' : ''}`, amt: '' };
    case 'AgentFunded': return { t: `Agent #${r.agentId} vault funded`, s: 'from the owner balance', amt };
    case 'AgentDefunded': return { t: `Agent #${r.agentId} vault returned`, s: 'to the owner balance', amt };
    case 'AgentRefused': return { t: `Agent #${r.agentId} asked to pay ${who(r.to, r.toHandle)}`, s: `${REASON[r.reason] || r.reason}${ref}`, route: '<span class="route Refuses">Refuses</span>', amt };
    case 'Queued': return { t: `Agent #${r.agentId} asked to pay ${who(r.to, r.toHandle)}`, s: `waiting for review · #${r.pendingId}${ref}`, route: '<span class="route Queues">Queues</span>', amt };
    case 'Approved': return { t: `Queued payment #${r.pendingId} approved`, s: 'by the account owner', amt: '' };
    case 'Rejected': return { t: `Queued payment #${r.pendingId} rejected`, s: 'reserve returned to the vault', route: '<span class="route Refuses">Rejected</span>', amt: '' };
    case 'AgentStatus': return { t: `Agent #${r.agentId} ${esc(r.status)}`, s: r.status === 'revoked' ? 'vault returned, slot freed' : '', amt: '' };
    case 'SignerRotated': return { t: `Agent #${r.agentId} key rotated`, s: `new signer ${esc(short(r.signer))}`, amt: '' };
    case 'AllowSet': return { t: `Agent #${r.agentId} allowlist`, s: `${r.allowed ? 'added' : 'removed'} ${esc(short(r.to))}`, amt: '' };
    case 'RequestCreated': return { t: `${who(r.who, r.whoHandle)} requested a payment`, s: `request #${r.requestId}${r.memo ? ' · “' + esc(r.memo) + '”' : ''}`, amt };
    case 'RequestCancelled': return { t: `Request #${r.requestId} cancelled`, s: '', amt: '' };
    case 'FeesSwept': return { t: 'Fees swept to the house', s: '', amt: '' };
    default: return { t: esc(r.name), s: '', amt: '' };
  }
}

export function rowHtml(r, cls = '') {
  const d = describe(r);
  return `<div class="it ${cls}">
    <div class="what">${d.t}<span class="sub">${d.s ? d.s + ' · ' : ''}<a href="${txUrl(r.tx)}" target="_blank" rel="noopener">${ago(r.ts) || 'block ' + r.block}</a></span></div>
    ${d.route || '<span></span>'}
    <span class="amt">${d.amt}</span>
  </div>`;
}
