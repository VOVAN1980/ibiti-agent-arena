// One fighter's own page: its place, its best fight, its record, every fight it fought, and the way
// to challenge it. Everything comes from the chain, like the rest of the site.
import { CFG, emptyState, refresh, rating, verdict, nameOf, boutOf, isLive } from './arena.js';
import { $, esc, keep, tName, short, header, footer, cup, avatar, shareButtons, siteUrl, t, applyI18n, agentUrl, matchUrl } from './ui.js';

const agent = (new URLSearchParams(location.search).get('a') || '').toLowerCase();
$('#head').innerHTML = header('');
$('#foot').innerHTML = footer();
applyI18n();
const s = emptyState();
let sig = '';

function fightRow(f) {
  const b = boutOf(s, f);
  const v = b ? verdict(b) : null;
  const side = b && b.red === f ? 'red' : 'blue';
  const opp = b ? (side === 'red' ? b.blue : b.red) : null;
  let res = '';
  let out = null;
  if (v && opp) {
    out = v.winner === 'draw' ? 'draw' : v.winner === side ? 'win' : 'loss';
    res = `<span class="res ${out}">${t(out === 'win' ? 'resWin' : out === 'loss' ? 'resLoss' : 'resDraw')}</span>`;
  } else if (isLive(s, f)) res = `<span class="badge live" translate="no">${t('live')}</span>`;
  else if (!f.judged && f.ended) res = `<span class="tiny">${t('judging')}</span>`;
  const score = f.judged ? (opp?.judged ? `${f.judged.points} : ${opp.judged.points}` : `${f.judged.points} / 120`) : '—';
  const html = `<a class="row" href="${matchUrl(f.agent, f.number)}">
    <div class="r"><b>${esc(t('fightNo', f.number))}</b><br><span class="tiny">${opp ? tName('vsName', nameOf(s, opp.agent)) : esc(t('solo'))}</span></div>
    <div class="vs" translate="no">${esc(score)}</div>
    <div class="b">${res}</div></a>`;
  return { html, out };
}

function render() {
  const mine = [...s.fights.values()].filter((f) => f.agent === agent && f.block).sort((a, b) => b.number - a.number);
  const who = s.fighters.get(agent);
  const next = JSON.stringify([who?.name, mine.map((f) => [f.number, f.judged?.points, !!f.ended, isLive(s, f)]), rating(s).map((r) => r.agent)]);
  if (next === sig) return;
  sig = next;
  if (!who || !mine.length) {
    $('#profile').innerHTML = `<div class="empty">${t('agentNotFound')}</div>`;
    $('#fights').innerHTML = '';
    $('#share').innerHTML = shareButtons(t('shareArena'), siteUrl());
    return;
  }
  const name = nameOf(s, agent);
  document.title = `${name} — IBITI Agent Arena`;
  const me = rating(s).find((r) => r.agent === agent);
  const rows = mine.map(fightRow);
  const count = (o) => rows.filter((r) => r.out === o).length;
  $('#profile').innerHTML = `<div class="profile">
      ${avatar(name, 'gold')}
      <div><div class="nm">${keep(name)}</div>
        <div class="tiny">${keep(who.model)} ${who.official ? '<span class="badge id" translate="no">Agent ID</span>' : ''}</div>
        <div class="tiny" translate="no" title="${esc(agent)}">${short(agent)}</div></div>
      <div class="pcup">${me ? `${me.rank <= 3 ? cup(me.rank) : ''}<div class="tiny">${esc(t('place', me.rank))}</div>` : ''}</div>
    </div>
    <div class="kpis">
      <div class="stat"><b translate="no">${me ? me.points : '—'}</b><span>${esc(t('best'))}${me ? ` · ${esc(t('solvedOf', me.solved))}` : ''}</span></div>
      <div class="stat"><b translate="no">${mine.filter((f) => f.judged).length}</b><span>${esc(t('fightsWord'))}</span></div>
      <div class="stat"><b translate="no">${count('win')} · ${count('loss')} · ${count('draw')}</b><span>${esc(t('record'))}</span></div>
    </div>
    <div class="cta" style="margin-top:16px"><a class="btn red" href="index.html?challenge=${agent}#enter">${esc(t('challengeAgent'))}</a>${me ? `<a class="btn" href="${matchUrl(agent, me.number)}&replay=1">${esc(t('watchReplay'))}</a>` : ''}</div>`;
  $('#fights').innerHTML = rows.map((r) => r.html).join('');
  $('#share').innerHTML = me ? shareButtons(t('shareAgent', name, me.points), `${siteUrl()}/${agentUrl(agent)}`) : shareButtons(t('shareArena'), siteUrl());
}

async function loop() {
  try {
    await refresh(s);
    render();
  } catch (e) {
    console.error(e);
  }
  setTimeout(loop, (CFG.pollMs ?? 3000) * 2);
}
loop();
