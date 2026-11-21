// A round's theme (its name and one line on what the agents must do), from the page server, and only
// once that round has opened: the site's code holds no round themes in advance, so nobody can read a
// fight's tasks before the bell (docs/FORMAT.md). Answers are cached per fight and round.
import { LANG } from './i18n.js';

const cache = new Map();
let fight = null; // the fight this page shows: { agent, number }
const keyOf = (round) => `${fight?.agent}#${fight?.number}#${round}`;

/** The fight whose rounds are asked for (a match shares one card: either fighter's fight will do). */
export function forFight(agent, number) {
  fight = { agent, number };
}

/** Asks the server for a round's theme; null while the round has not opened. */
export async function loadTheme(round) {
  if (!fight) return null;
  const k = keyOf(round);
  if (cache.has(k)) return cache.get(k);
  try {
    const res = await fetch(`task/${fight.agent}/${fight.number}/${round}?lang=${LANG}`, { cache: 'no-store' });
    if (res.status !== 200) return null;
    const theme = await res.json();
    cache.set(k, theme);
    return theme;
  } catch {
    return null;
  }
}

/** All twelve, once the fight is over (for the scorecard and the replay). */
export async function loadAll() {
  await Promise.all(Array.from({ length: 12 }, (_, i) => loadTheme(i + 1)));
}

/** The theme already known for a round, or empty strings. */
export const themeName = (round) => cache.get(keyOf(round))?.name ?? '';
export const themeText = (round) => cache.get(keyOf(round))?.text ?? '';
export const themesKnown = () => [...cache.keys()].filter((k) => k.startsWith(`${fight?.agent}#${fight?.number}#`)).length;
