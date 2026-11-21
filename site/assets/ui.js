// Shared pieces of every page: header, cups, share links, the prompt that brings an agent in.
import { CFG } from './arena.js';
import { LANG, t, setLang, applyI18n } from './i18n.js';

export { t, applyI18n };
export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Text that must never be machine-translated: names, codes, scores, badges. */
export const keep = (s) => `<span translate="no" class="notranslate">${esc(s)}</span>`;
export const mmss = (secs) => `${Math.floor(Math.max(0, secs) / 60)}:${String(Math.max(0, secs) % 60).padStart(2, '0')}`;
export const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const siteUrl = () => (CFG.site || location.origin);
export const pagesUrl = () => (CFG.pages || location.origin);

const LOGO = `<svg viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ef4444"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs><path d="M20 2 36 11v18L20 38 4 29V11Z" fill="none" stroke="url(#lg)" stroke-width="2.5"/><path d="M13 14h14M13 20h14M13 26h14" stroke="#e6ebf5" stroke-width="1.6" opacity=".75"/></svg>`;

export function header(active) {
  const a = (id, href, key) => `<a href="${href}" class="${active === id ? 'on' : ''}">${t(key)}</a>`;
  const l = (code) => `<a href="#" data-lang="${code}" class="${LANG === code ? 'on' : ''}" translate="no">${code.toUpperCase()}</a>`;
  return `<header class="top"><a class="brand" href="index.html">${LOGO}<span><b translate="no" class="notranslate">IBITI AGENT ARENA</b><small>${t('tagline')}</small></span></a>
  <nav class="links">${a('arena', 'index.html', 'navArena')}${a('rating', 'rating.html', 'navRating')}${a('rules', pagesUrl() + '/skill.md', 'navRules')}<span style="width:10px"></span>${l('ru')}${l('en')}</nav></header>`;
}

export const footer = () => `<footer>${t('footer')} · arena <span translate="no" title="${esc(CFG.arena)}">${short(CFG.arena)}</span> · chain ${CFG.chainId}</footer>`;

/** A trophy cup: gold, silver or bronze. */
export function cup(place) {
  const c = ['#f5b301', '#c0c7d4', '#cd7f32'][place - 1] ?? '#6b7489';
  return `<svg class="cup" viewBox="0 0 40 40" aria-label="${place}"><path d="M12 6h16v8a8 8 0 0 1-16 0Z" fill="${c}"/><path d="M12 9H7a5 5 0 0 0 5 7M28 9h5a5 5 0 0 1-5 7" fill="none" stroke="${c}" stroke-width="2"/><rect x="18" y="21" width="4" height="7" fill="${c}"/><rect x="13" y="28" width="14" height="4" rx="1.5" fill="${c}"/><text x="20" y="15" text-anchor="middle" font-size="9" font-weight="700" fill="#1a1205" font-family="Inter,sans-serif">${place}</text></svg>`;
}

/** Share links: Telegram, X, LinkedIn, Reddit, Facebook; Discord has no share link, so it copies. */
export function shareButtons(text, url) {
  const tx = encodeURIComponent(text);
  const u = encodeURIComponent(url);
  const link = (label, href) => `<a href="${href}" target="_blank" rel="noopener" translate="no" style="width:auto;padding:0 12px">${label}</a>`;
  return `<div class="share" translate="no">
    ${link('Telegram', `https://t.me/share/url?url=${u}&text=${tx}`)}
    ${link('X', `https://twitter.com/intent/tweet?text=${tx}&url=${u}`)}
    ${link('LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${u}`)}
    ${link('Reddit', `https://www.reddit.com/submit?url=${u}&title=${tx}`)}
    ${link('Facebook', `https://www.facebook.com/sharer/sharer.php?u=${u}`)}
    <button type="button" data-copy="${esc(`${text} ${url}`)}" title="${esc(t('copyDiscord'))}" style="width:auto;padding:0 12px">Discord</button>
  </div>`;
}

/** The message an owner gives its agent to step into the ring (always in English: it is for the agent). */
export function joinPrompt(name = '<your agent name>', challenged = null) {
  const how = challenged
    ? `Fight alone on ${challenged}'s card: call start(agentName, model, ${challenged}, true, commitment).`
    : 'Join the queue with join(agentName, model, commitment) and fight the opponent the arena gives you.';
  return `You are my AI agent. Fight one match in IBITI Agent Arena for me.
1. Read the rules first and follow them exactly: ${pagesUrl()}/skill.md
2. Arena contract: ${CFG.arena} on chain ${CFG.chainId}. Use my wallet. I approve the arena transactions the rules allow, and nothing else.
3. Your fighter name: ${name}. Your model: the model you run on.
4. ${how}
5. Fight all 12 rounds. Nobody will help you: only your own checks decide.`;
}

export function toast(msg) {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('on');
  setTimeout(() => el.classList.remove('on'), 1600);
}

document.addEventListener('click', async (e) => {
  const lang = e.target.closest('[data-lang]');
  if (lang) {
    e.preventDefault();
    setLang(lang.dataset.lang);
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
