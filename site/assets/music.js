// The arena's theme. It plays on the pages where nothing else sounds (the main page, the rating, the
// rules, the agents' profiles) and never in the ring: a fight has its own sound. It is on unless the
// visitor turns it off in the gear menu; the choice and the volume are remembered in this browser,
// and the track goes on from where the previous page left it. Browsers let a page start sound only
// after the visitor has touched it, so when the first try is refused it starts at the first touch.
const SRC = 'assets/audio/overdriven-mandate.mp3';
const ON = 'arenaMusic';
const VOL = 'arenaMusicVol';
const AT = 'arenaMusicAt';

const read = (store, k) => {
  try {
    return store.getItem(k);
  } catch {
    return null;
  }
};
const write = (store, k, v) => {
  try {
    store.setItem(k, v);
  } catch {
    // storage blocked: the choice lasts for this page only
  }
};
const local = () => globalThis.localStorage;
const session = () => globalThis.sessionStorage;

export const musicOn = () => read(local(), ON) !== 'off';
export function musicVolume() {
  const v = Number(read(local(), VOL) ?? 0.35);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.35;
}

let audio = null;
let allowed = false; // this page may play music (not the ring)
let waiting = false;

function track() {
  if (audio) return audio;
  audio = new Audio(SRC);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = musicVolume();
  const at = Number(read(session(), AT));
  if (at > 0) audio.addEventListener('loadedmetadata', () => (audio.currentTime = at % (audio.duration || Infinity)), { once: true });
  const keep = () => write(session(), AT, String(audio.currentTime));
  addEventListener('pagehide', keep);
  document.addEventListener('visibilitychange', keep);
  return audio;
}

/** Wait for the visitor's first touch, then start (a touch on the gear itself decides on its own). */
function atFirstTouch() {
  if (waiting) return;
  waiting = true;
  const kinds = ['pointerdown', 'keydown', 'touchstart'];
  const go = (e) => {
    if (e.target?.closest?.('.gear')) return;
    kinds.forEach((k) => removeEventListener(k, go, true));
    waiting = false;
    if (allowed && musicOn()) track().play().catch(() => {});
  };
  kinds.forEach((k) => addEventListener(k, go, true));
}

function play() {
  track()
    .play()
    .catch(() => atFirstTouch());
}

/** Called once per page: `ring` is true on the fight page, where the music never plays. */
export function music(ring) {
  allowed = !ring;
  if (allowed && musicOn()) play();
}

export function setMusic(on) {
  write(local(), ON, on ? 'on' : 'off');
  if (!allowed) return;
  if (on) play();
  else audio?.pause();
}

/** Whether the theme is sounding now (for checks). */
export const musicPlaying = () => !!audio && !audio.paused;

export function setVolume(v) {
  write(local(), VOL, String(v));
  if (audio) audio.volume = v;
}
