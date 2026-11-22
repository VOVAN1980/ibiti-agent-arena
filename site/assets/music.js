// The arena's theme. It plays on every page while no battle is on: the main page, the rating, the rules,
// the agents' profiles, and the ring before a fight and after it. During the battle itself the ring's own
// sound is heard instead (the ring page holds the theme back then: musicHold). It is on unless the
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
let allowed = false; // this page may play music
let held = false; // a battle is on in the ring: the theme waits
let ringSaid = false; // the ring page has already said whether a battle is on
let waiting = false;
let label = ''; // the words on the button shown while the browser holds the music back
let gate = null;

/** A button in sight while the browser holds the music back (it starts at any touch; this one says so). */
function showGate() {
  if (gate || !label || !document.body) return;
  gate = document.createElement('button');
  gate.type = 'button';
  gate.className = 'musicgate';
  gate.textContent = `🔊 ${label}`;
  document.body.append(gate); // a touch on it starts the music like any other touch
}
const hideGate = () => {
  gate?.remove();
  gate = null;
};

// One theme at a time across the arena's tabs: a tab that starts it, or a ring whose battle begins,
// tells the others to fall silent; a tab out of sight is silent too, and plays on when it comes back.
const tabs = 'BroadcastChannel' in globalThis ? new BroadcastChannel('arena-theme') : null;
tabs?.addEventListener('message', (e) => {
  if (e.data !== 'playing' && e.data !== 'battle') return;
  audio?.pause();
  if (e.data === 'playing' && held) tabs.postMessage('battle'); // a battle is on in this ring: it stays alone
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio?.pause();
  else if (allowed && !held && musicOn() && audio?.paused) play();
});

function track() {
  if (audio) return audio;
  audio = new Audio(SRC);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = musicVolume();
  audio.addEventListener('playing', () => {
    hideGate();
    tabs?.postMessage('playing'); // this tab plays it: the others stop
  });
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
    if (allowed && !held && musicOn()) track().play().catch(() => {});
    else hideGate();
  };
  kinds.forEach((k) => addEventListener(k, go, true));
  showGate();
}

function play() {
  track()
    .play()
    .catch(() => atFirstTouch());
}

/** Called once per page: `ring` is true on the fight page, which starts with the theme held until it
 *  knows no battle is on; `words` label the button shown while the browser holds the music back. */
export function music(ring, words = '') {
  allowed = true;
  if (!ringSaid) held = ring;
  label = words;
  if (!held && musicOn()) play();
}

/** The ring page: `true` while a battle is on (the theme pauses), `false` when it is over (it plays on). */
export function musicHold(hold) {
  ringSaid = true;
  if (held === hold) return;
  held = hold;
  if (hold) {
    audio?.pause();
    hideGate();
    tabs?.postMessage('battle'); // the battle is heard alone, in every tab
  } else if (allowed && musicOn()) play();
}

export function setMusic(on) {
  write(local(), ON, on ? 'on' : 'off');
  if (!allowed) return;
  if (on && !held) play();
  else {
    audio?.pause();
    hideGate();
  }
}

/** Whether the theme is sounding now (for checks). */
export const musicPlaying = () => !!audio && !audio.paused;

export function setVolume(v) {
  write(local(), VOL, String(v));
  if (audio) audio.volume = v;
}
