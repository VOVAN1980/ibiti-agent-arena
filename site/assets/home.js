// The front door: both rings, the season, how it works. Scrolling moves the camera to the ring.
import { CFG, emptyState, refresh, nameOf, seasonState, podiumSeason, pollDelay, pollAgain } from './arena.js';
import { t } from './i18n.js';
import { seasonLine, esc, keep, gear } from './ui.js';
import { music, musicOn, setMusic } from './music.js';

const $ = (s) => document.querySelector(s);
/** A text in the page's language; the English written in the page when the language has none. */
const tr = (key, fallback) => (t(key) === key ? fallback : t(key));
document.querySelectorAll('[data-t]').forEach((el) => {
  el.textContent = tr(el.dataset.t, el.textContent);
});

// ---- where the two showcases lead: this site's own arena, the other ring's site when known
const rings = CFG?.rings ?? null;
const here = CFG?.ring === 'green' ? 'green' : 'red';
const hall = (ring) => (ring === here ? 'index.html' : rings?.[ring] ? `${rings[ring]}/index.html` : null);
$('#toRed').href = hall('red') ?? 'index.html';
const street = hall('green');
if (street) $('#toStreet').href = street;
else $('#toStreet').classList.add('soon');
$('#connect').href = `${hall('red') ?? 'index.html'}#enter`;

// ---- the camera: --p runs 0..1 over the first screen of scrolling
const stage = $('#stage');
let ticking = false;
function camera() {
  ticking = false;
  const travel = Math.max(1, stage.offsetHeight - innerHeight);
  const p = Math.min(1, Math.max(0, scrollY / travel));
  const q = Math.min(1, Math.max(0, (scrollY - travel) / (innerHeight * .6)));
  document.documentElement.style.setProperty('--p', p.toFixed(4));
  document.documentElement.style.setProperty('--q', q.toFixed(4));
}
addEventListener('scroll', () => {
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(camera);
  }
}, { passive: true });
addEventListener('resize', camera);
camera();

// ---- sound: the arena's theme, on or off
const btn = $('#sound');
const showSound = () => {
  const on = musicOn();
  btn.setAttribute('aria-pressed', String(on));
  btn.querySelector('span').textContent = on ? tr('homeSoundOn', 'Sound on') : tr('homeSoundOff', 'Sound off');
};
btn.addEventListener('click', () => {
  setMusic(!musicOn());
  showSound();
});
music(false, t('musicStart'));
showSound();
// the gear, as on every other page; its music switch and the sound button show the same state
$('#homeGear').outerHTML = gear();
document.addEventListener('click', () => setTimeout(() => {
  showSound();
  $('.gearmenu [data-music]')?.setAttribute('aria-checked', String(musicOn()));
}, 0));

// ---- the season: its line and its podium (the last closed season's winners, or the leaders so far)
const s = emptyState();
async function season() {
  try {
    const [, st] = await Promise.all([refresh(s), seasonState()]);
    $('#seasonLine').innerHTML = seasonLine(st, (a) => nameOf(s, a)) || esc(tr('homeNoSeason', 'The first season opens soon.'));
    const p = await podiumSeason();
    $('#podium').innerHTML = p?.top.length
      ? p.top.map((r, i) => `<div class="place"><span class="medal">${String(i + 1).padStart(2, '0')}</span><div><b>${keep(r.name || nameOf(s, r.agent))}</b><span>${r.timeUsed}s</span></div><div class="pts">${r.points}</div></div>`).join('')
      : '';
  } catch (e) {
    console.error(e);
  }
}
// every 30 s; while the names of earlier fights are still on their way, the next part at once (later
// after a failed poll); nothing while the tab is hidden
const again = async () => {
  await season();
  pollAgain(again, pollDelay(s, 1, 30000));
};
again();
