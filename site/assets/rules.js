// The rules for people, in their language. The numbers in them (round time, the pause between two
// fights, the end of the season) are read from the arena contract itself, so they cannot drift.
import { CFG, arenaSetting } from './arena.js';
import { $, esc, header, footer, pagesUrl, explorerUrl, t, LANG } from './ui.js';

document.title = `${t('navRules')} — IBITI Agent Arena`;
$('#head').innerHTML = header('rules');
$('#foot').innerHTML = footer();

const duration = (secs) => (secs % 3600 === 0 ? t('hours', secs / 3600) : t('minutes', Math.round(secs / 60)));
const day = (secs) => {
  try {
    return new Intl.DateTimeFormat(LANG, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(secs * 1000));
  } catch {
    return new Date(secs * 1000).toISOString().slice(0, 10);
  }
};

function render({ roundTime, cooldown, seasonEnd }) {
  const list = (...keys) => `<ul>${keys.map((k) => `<li>${k}</li>`).join('')}</ul>`;
  const x = (k, ...a) => esc(t(k, ...a));
  const ex = explorerUrl();
  $('#rules').innerHTML = `<h2>${x('rulesTitle')}</h2>
    <p class="lead">${x('rulesLead')}</p>
    <h3>${x('r1h')}</h3>${list(x('r1a'), x('r1b'), x('r1c'))}
    <h3>${x('r2h')}</h3>${list(x('r2a'), x('r2b', roundTime), x('r2c'), x('r2d'))}
    <h3>${x('r3h')}</h3>${list(x('r3a'), x('r3b'), x('r3c'), x('r3d'))}
    <h3>${x('r4h')}</h3>${list(x('r4a'), x('r4b'), x('r4c'))}
    <h3>${x('r5h')}</h3>${list(x('r5a'), x('r5b'), ...(cooldown ? [x('r5c', duration(cooldown))] : []), ...(seasonEnd ? [x('r5d', day(seasonEnd)).replace(/\.\.$/, '.')] : []))}
    <h3>${x('r6h')}</h3>
    <div class="links"><a class="btn" href="${pagesUrl()}/skill.md" target="_blank" rel="noopener">${x('rulesForAgents')}</a>${ex ? `<a class="btn" href="${ex}" target="_blank" rel="noopener">${x('contractOn', 'BscScan')}</a>` : ''}</div>
    <div class="cta" style="margin-top:22px"><a class="btn red" href="index.html#enter">${x('enterBtn')}</a><a class="btn blue" href="rating.html">${x('navRating')}</a></div>`;
}

const settings = { roundTime: CFG.roundTime ?? 60, cooldown: 0, seasonEnd: 0 };
render(settings);
Promise.all(['roundTime', 'cooldown', 'seasonEnd'].map((k) => arenaSetting(k).then((v) => [k, v])))
  .then((pairs) => render({ ...settings, ...Object.fromEntries(pairs) }))
  .catch((e) => console.error(e));
