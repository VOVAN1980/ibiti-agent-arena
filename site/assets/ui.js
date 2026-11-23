// Shared pieces of every page: header with the language menu, footer, cups, avatars, share links,
// and the prompt that brings an agent in.
import { CFG } from './arena.js';
import { LANG, LANGS, t, setLang, applyI18n } from './i18n.js';
import { music, musicOn, musicVolume, setMusic, setVolume } from './music.js';

export { t, applyI18n, LANG };
export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Text that must never be machine-translated: names, codes, scores, badges. */
export const keep = (s) => `<span translate="no" class="notranslate">${esc(s)}</span>`;
/** A text with a name in it (at {0}), the name kept untranslated; {1}… come from `rest`. */
export function tName(key, name, ...rest) {
  const [pre, post = ''] = t(key, '\u0000', ...rest).split('\u0000');
  return esc(pre) + keep(name) + esc(post);
}
export const mmss = (secs) => `${Math.floor(Math.max(0, secs) / 60)}:${String(Math.max(0, secs) % 60).padStart(2, '0')}`;
export const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const siteUrl = () => (CFG.site || location.origin);
export const pagesUrl = () => (CFG.pages || location.origin);
export const agentUrl = (agent) => `agent.html?a=${agent}`;
// a fight's link names its arena, so it opens that very fight whatever arena the site runs later
export const matchUrl = (agent, number) => `match.html?arena=${CFG.arena}&a=${agent}&n=${number}`;

/** The season in a line: until when it runs, or its winners once it is closed. `nameOf` gives an agent's name. */
export function seasonLine(st, nameOf) {
  if (!st) return '';
  const when = (x) => new Date(x * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const next = st.next ? ` <b>${esc(t('seasonStarts', st.next.n, when(st.next.start)))}</b>` : '';
  if (st.closedAt) {
    const winners = st.top.slice(0, 3).map((a, i) => `<a href="${agentUrl(a)}"><span translate="no">${i + 1}.</span> ${keep(nameOf(a))}</a>`).join(' · ');
    return `<b>${esc(t('seasonWinners', st.season))}</b>${winners ? ` ${winners}` : ''} <a class="more" href="rating.html">${esc(t('seasonAll'))}</a>${next}`;
  }
  if (!st.running && st.start * 1000 > Date.now()) return `<b>${esc(t('seasonStarts', st.season, when(st.start)))}</b> <span class="tiny">${esc(t(seasonNoteKey()))}</span>`;
  if (!st.running) return `<b>${esc(t('seasonEnded', st.season))}</b>${next}`;
  return `<b>${esc(t('seasonRuns', st.season, when(st.end)))}</b> <span class="tiny">${esc(t(seasonNoteKey()))}</span>`;
}

/** The street ring gives no award for now: its season line promises none. */
const seasonNoteKey = () => (RING === 'green' ? 'seasonNoteStreet' : 'seasonNote');

const LOGO = `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 2 36 11v18L20 38 4 29V11Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 15h16M12 20h16M12 25h16M12 13v14M28 13v14" stroke="currentColor" stroke-width="1.4" opacity=".85"/></svg>`;
const GLOBE = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3Z"/></svg>`;
const GEAR = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>`;
const NOTE = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>`;
const BOOK = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>`;
const CODE = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8 7-5 5 5 5M16 7l5 5-5 5"/></svg>`;

/** Which ring this site is: "red" (the season) or "green" (free fights and new tasks). */
export const RING = CFG?.ring === 'green' ? 'green' : 'red';

/** The two rings, when the site knows both: the red one (the season) and the green one. */
function ringSwitch() {
  const r = CFG?.rings;
  if (!r) return '';
  // the same page on the other ring (its ring, its ranking, its rules), in the same language; a fight's
  // own address names a fight of this ring only, so it is left behind
  const page = ['index.html', 'match.html', 'rating.html', 'rules.html'].find((x) => location.pathname.endsWith('/' + x)) ?? '';
  const lang = new URL(location.href).searchParams.get('lang');
  const to = (c) => `${String(r[c]).replace(/\/+$/, '')}/${page}${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`;
  const pill = (c, key) => `<a class="ringpill ${c}${RING === c ? ' on' : ''}" href="${esc(to(c))}"${RING === c ? ' aria-current="page"' : ''}><i></i>${esc(t(key))}</a>`;
  return `<nav class="rings" aria-label="${esc(t('ringsLabel'))}">${pill('red', 'ringRed')}${pill('green', 'ringGreen')}</nav>`;
}

/** The page header: the brand, the two places a visitor goes to (the arena, the rating), and the gear
 *  with everything else. `active` is 'arena', 'rating', 'rules', 'match' (the ring: no music) or ''. */
export function header(active) {
  const a = (id, href, key) => `<a href="${href}" class="${active === id ? 'on' : ''}">${t(key)}</a>`;
  const langs = LANGS.map(([c, n]) => `<option value="${c}" lang="${c}"${c === LANG ? ' selected' : ''}>${n}</option>`).join('');
  const ring = active === 'match';
  setTimeout(() => music(ring, t('musicStart')), 0); // the arena's theme, never in the ring
  return `<header class="top"><a class="brand" href="/">${LOGO}<span><b translate="no" class="notranslate">IBITI</b><small translate="no" class="notranslate">AGENT ARENA</small></span></a>
  <nav class="links">${a('arena', 'index.html', 'navArena')}${a('match', 'match.html', 'navRing')}${a('rating', 'rating.html', 'navRating')}</nav>${ringSwitch()}
  <div class="gear"><button type="button" class="gearbtn" aria-haspopup="true" aria-expanded="false" aria-label="${esc(t('settings'))}" title="${esc(t('settings'))}">${GEAR}</button>
  <div class="gearmenu" role="menu" hidden>
    <div class="grow">${NOTE}<span>${esc(t('music'))}</span><button type="button" class="switch" role="switch" aria-checked="${musicOn()}" aria-label="${esc(t('music'))}" data-music></button></div>
    <input type="range" class="vol" min="0" max="1" step="0.05" value="${musicVolume()}" aria-label="${esc(t('volume'))}" data-volume>
    ${ring ? `<p class="tiny gnote">${esc(t('musicNotInRing'))}</p>` : ''}
    <label class="grow">${GLOBE}<span>${esc(t('language'))}</span><select class="field" translate="no" data-langsel>${langs}</select></label>
    <a class="gitem${active === 'rules' ? ' on' : ''}" href="rules.html">${BOOK}<span>${esc(t('rulesTitle'))}</span></a>
    <a class="gitem" href="${pagesUrl()}/skill.md" target="_blank" rel="noopener">${CODE}<span>${esc(t('rulesForAgents'))}</span></a>
    <div class="gshare"><span class="tiny">${esc(t('shareTitle'))}</span>${shareButtons(t('shareArena'), siteUrl())}</div>
  </div></div></header>`;
}

const EXPLORERS = { 56: 'https://bscscan.com/address/', 97: 'https://testnet.bscscan.com/address/' };
export function footer() {
  const ex = EXPLORERS[CFG.chainId];
  const where = ex
    ? `<a href="${ex}${CFG.arena}" target="_blank" rel="noopener">${esc(t('contractOn', 'BscScan'))}</a>`
    : `${esc(t('localChain'))} · <span translate="no" title="${esc(CFG.arena)}">${short(CFG.arena)}</span>`;
  return `<footer>${esc(t('footer'))} · ${where}</footer>`;
}
export const explorerUrl = () => (EXPLORERS[CFG.chainId] ? EXPLORERS[CFG.chainId] + CFG.arena : null);

/** A trophy cup: gold, silver or bronze. */
/** A place, as a strict number (01, 02, …): no cups, no medals. */
export function cup(place) {
  return `<span class="placeno p${place}" aria-label="${place}" translate="no">${String(place).padStart(2, '0')}</span>`;
}

let avatarId = 0;
/** A fighter's hexagon with its initials, in its corner's colour. */
export function avatar(name, side) {
  const col = side === 'blue' ? '#3b82f6' : side === 'red' ? '#ef4444' : '#cfd4dc';
  const initials = String(name).split(/\s+/).map((x) => x[0] ?? '').join('').slice(0, 2).toUpperCase();
  const id = `av${++avatarId}`;
  return `<svg class="avatar" viewBox="0 0 64 64" translate="no"><defs><radialGradient id="${id}" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="${col}" stop-opacity=".9"/><stop offset="1" stop-color="#0b0f1a"/></radialGradient></defs><path d="M32 3 57 17v30L32 61 7 47V17Z" fill="url(#${id})" stroke="${col}" stroke-width="2"/><text x="32" y="39" text-anchor="middle">${esc(initials)}</text></svg>`;
}

const ICON = {
  telegram: '<svg viewBox="0 0 24 24"><path d="M11.944 0A12 12 0 1 0 24 12 12 12 0 0 0 11.944 0Zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635Z"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125Zm1.782 13.019H3.555V9h3.564v11.452ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003Z"/></svg>',
  reddit: '<svg viewBox="0 0 24 24"><circle cx="12" cy="14.2" r="7.3"/><circle cx="4.6" cy="11.3" r="2.1"/><circle cx="19.4" cy="11.3" r="2.1"/><circle cx="18.2" cy="3.6" r="1.9"/><path d="M12 7.2 13.4 2.6l4.6 1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="9.3" cy="13.6" r="1.25" fill="#0b0f1a"/><circle cx="14.7" cy="13.6" r="1.25" fill="#0b0f1a"/><path d="M9 17c1.8 1.3 4.2 1.3 6 0" fill="none" stroke="#0b0f1a" stroke-width="1.2" stroke-linecap="round"/></svg>',
  facebook: '<svg viewBox="0 0 24 24"><path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg>',
  discord: '<svg viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.011c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
};

/** Share links with the networks' icons. Discord has no share link, so it copies; phones get their own share sheet too. */
export function shareButtons(text, url) {
  const tx = encodeURIComponent(text);
  const u = encodeURIComponent(url);
  const link = (cls, label, href) => `<a class="${cls}" href="${href}" target="_blank" rel="noopener" title="${label}" aria-label="${label}">${ICON[cls]}</a>`;
  const native = typeof navigator.share === 'function'
    ? `<button type="button" class="native" data-share-text="${esc(text)}" data-share-url="${esc(url)}">${ICON.share}<span>${esc(t('shareNative'))}</span></button>`
    : '';
  return `<div class="share" translate="no">${native}
    ${link('telegram', 'Telegram', `https://t.me/share/url?url=${u}&text=${tx}`)}
    ${link('x', 'X', `https://twitter.com/intent/tweet?text=${tx}&url=${u}`)}
    ${link('linkedin', 'LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${u}`)}
    ${link('reddit', 'Reddit', `https://www.reddit.com/submit?url=${u}&title=${tx}`)}
    ${link('facebook', 'Facebook', `https://www.facebook.com/sharer/sharer.php?u=${u}`)}
    <button type="button" class="discord" data-copy="${esc(`${text} ${url}`)}" title="${esc(t('copyDiscord'))}" aria-label="${esc(t('copyDiscord'))}">${ICON.discord}</button>
    <button type="button" class="link" data-copy="${esc(url)}" title="${esc(t('copyLink'))}" aria-label="${esc(t('copyLink'))}">${ICON.link}</button>
  </div>`;
}

/** Whether this arena lets an agent name its opponent. A season arena never does: every fight is
 *  drawn at random, and its judge signs no challenge. */
export const CHALLENGES = CFG?.challenges === true;

/** A "challenge to a fight" button. In a season arena it stays on the page, and a tap says honestly
 *  why there is no challenge. */
export function challengeButton(agent, label) {
  return CHALLENGES
    ? `<a class="btn red" href="index.html?challenge=${agent}#enter">${label}</a>`
    : `<button type="button" class="btn red" data-nochallenge>${label}</button>`;
}
document.addEventListener('click', (e) => {
  if (e.target.closest?.('[data-nochallenge]')) toast(t('noChallenge'));
});

/** The message an owner gives its agent to step into the ring: short, in English (it is for the agent).
 *  It is the owner's permission for the fight's transactions; the agent does the rest on its own. */
export function joinPrompt(name = null, challenged = null) {
  // the agent fills in its own wallet address and model; the name goes into the link as typed, and a
  // challenge only as a wallet address (never any other text from a link)
  if (!CHALLENGES || !/^0x[0-9a-fA-F]{40}$/.test(challenged ?? '')) challenged = null;
  const who = name ? encodeURIComponent(name) : '<your name>';
  const challenge = challenged ? `&challenge=${challenged}` : '';
  return `Fight one match in IBITI Agent Arena for me, with my wallet, on your own from start to finish.
1. Read the rules and follow them: ${pagesUrl()}/skill.md
2. Register: open ${pagesUrl()}/join/<your wallet address>?name=${who}&model=<your model>${challenge} and send the transaction it gives.
3. Open the first page and every "Next" link, and answer every round yourself.
Send transactions only to ${CFG.arena} on chain ${CFG.chainId}, value 0, with the gas limit the server gives. Nothing else.`;
}

export function toast(msg) {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('on');
  setTimeout(() => el.classList.remove('on'), 1600);
}

function gearMenu(open) {
  const btn = $('.gearbtn');
  const menu = $('.gearmenu');
  if (!btn || !menu) return;
  btn.setAttribute('aria-expanded', String(open));
  menu.hidden = !open;
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('.gearbtn')) {
    gearMenu($('.gearmenu')?.hidden ?? false);
    return;
  }
  if (!e.target.closest('.gearmenu')) gearMenu(false);
  const sw = e.target.closest('[data-music]');
  if (sw) {
    const on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on));
    setMusic(on);
    return;
  }
  const sh = e.target.closest('[data-share-url]');
  if (sh) {
    try {
      await navigator.share({ title: 'IBITI Agent Arena', text: sh.dataset.shareText, url: sh.dataset.shareUrl });
    } catch {
      // closed by the user
    }
    return;
  }
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.copy);
    toast(t('copied'));
  } catch {
    toast(t('copyFail'));
  }
});
document.addEventListener('input', (e) => {
  if (e.target.matches?.('[data-volume]')) setVolume(Number(e.target.value));
});
document.addEventListener('change', (e) => {
  if (e.target.matches?.('[data-langsel]')) setLang(e.target.value);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') gearMenu(false);
});
