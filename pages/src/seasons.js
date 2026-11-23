// What this server knows of each season, shared by the page server and the judge.
//
//   SEASONS (var)      { "<n>": { "plan": <task set>, "certificate": "<address>" } }: every season this
//                      server serves. The task set must be given for each one: a season's pages are rebuilt
//                      only by a server of that season's set, so an old season never shows newer tasks.
//                      Without SEASONS at all (a local run, the tests) every season is this code's set.
//   SECRET_<n>         a season's secret (a Worker secret). SECRET counts for season 1 only: a secret
//                      serves one season, since it is published after it.

import { PLAN_VERSION } from './plan.js';
import { arenaKeys } from './keys.js';

/** SEASONS, parsed ({} when unset or broken). */
export function seasonsConf(env) {
  let s = env.SEASONS ?? {};
  if (typeof s === 'string') {
    try {
      s = JSON.parse(s);
    } catch {
      s = {};
    }
  }
  return s && typeof s === 'object' ? s : {};
}

/** The task set season `n` runs with: from SEASONS (NaN when SEASONS is set but does not give it, so
 *  no page of that season is built), or this code's own set when SEASONS is not set at all. */
export function planSetOf(env, n) {
  if (env.SEASONS == null) return Number(env.PLAN_VERSION ?? PLAN_VERSION);
  const p = seasonsConf(env)[n]?.plan;
  return p == null ? NaN : Number(p);
}

/** Whether this server builds season `n`'s pages (its task set is this code's). */
export const servesSeason = (env, n) => planSetOf(env, n) === PLAN_VERSION;

/** Season `n`'s secret: SECRET_<n>, or SECRET for season 1. */
export const secretOf = (env, n) => env[`SECRET_${n}`] ?? (n === 1 ? env.SECRET : undefined);

/** Season `n`'s keys, checked against the secret's hash in the calendar (`season` is chain.season(n));
 *  null when this server does not hold that season's secret. */
export function keysFor(env, n, season) {
  const secret = n ? secretOf(env, n) : undefined;
  if (!secret) return null;
  try {
    const keys = arenaKeys(secret);
    return season.secretCommit.toLowerCase() === keys.commit.toLowerCase() ? keys : null;
  } catch {
    return null;
  }
}
