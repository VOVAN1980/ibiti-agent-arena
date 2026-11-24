// The arena itself, edge to edge: stands packed with fans (red on the left, blue on the right), a
// neon ring, and the two robot fighters. Before the bell they bounce and pump their gloves at the
// crowd; when a round opens each one steps up to its console and types; whoever answers throws
// both arms up; whoever runs out of time hangs its head. The page tells the scene what happens;
// the scene only draws it.
//
// Everything is drawn in one 1600x900 picture that is cut to the screen ("slice"), so the ring
// stays at the bottom centre on any screen; the crowd is a canvas behind, the ring and the robots
// an SVG in front.

const NS = 'http://www.w3.org/2000/svg';
const W = 1600;
const H = 900;
const SIDE = {
  red: { x: 590, color: '#ef4444', deep: '#7f1d1d', glow: 'rgba(239,68,68,' },
  blue: { x: 1010, color: '#22c55e', deep: '#14532d', glow: 'rgba(34,197,94,' },
};
const FEET = 762;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ the ring and the robots (SVG)

function defs() {
  return `<defs>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef2fb"/><stop offset=".55" stop-color="#9aa4b8"/><stop offset="1" stop-color="#4b5468"/></linearGradient>
    <linearGradient id="metalDark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b7489"/><stop offset="1" stop-color="#262d3d"/></linearGradient>
    <linearGradient id="visor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a2236"/><stop offset="1" stop-color="#05070d"/></linearGradient>
    ${['red', 'blue'].map((s) => `<radialGradient id="glove-${s}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".25" stop-color="${SIDE[s].color}"/><stop offset="1" stop-color="${SIDE[s].deep}"/></radialGradient>
      <radialGradient id="pool-${s}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${SIDE[s].color}" stop-opacity=".55"/><stop offset="1" stop-color="${SIDE[s].color}" stop-opacity="0"/></radialGradient>
      <linearGradient id="holo-${s}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SIDE[s].color}" stop-opacity=".55"/><stop offset="1" stop-color="${SIDE[s].color}" stop-opacity=".12"/></linearGradient>`).join('')}
    <linearGradient id="rope" gradientUnits="userSpaceOnUse" x1="180" y1="0" x2="1420" y2="0"><stop offset="0" stop-color="#ef4444"/><stop offset=".5" stop-color="#e6ebf5"/><stop offset="1" stop-color="#22c55e"/></linearGradient>
    <linearGradient id="matShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1222" stop-opacity=".2"/><stop offset="1" stop-color="#03060c" stop-opacity=".75"/></linearGradient>
    <pattern id="hexes" width="56" height="48.5" patternUnits="userSpaceOnUse" patternTransform="scale(1 .42)"><path d="M14 0h28l14 24.25L42 48.5H14L0 24.25Z" fill="none" stroke="rgba(120,150,230,.22)" stroke-width="2"/></pattern>
    <filter id="neon" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="soft"><feGaussianBlur stdDeviation="10"/></filter>
  </defs>`;
}

function ringBack() {
  const post = (x, top, bottom, color) => `<rect x="${x - 9}" y="${top}" width="18" height="${bottom - top}" rx="6" fill="url(#metalDark)"/><rect x="${x - 11}" y="${top - 6}" width="22" height="22" rx="7" fill="${color}" filter="url(#neon)"/>`;
  return `<g class="ringback">
    <polygon points="360,560 1240,560 1420,860 180,860" fill="#0c1426"/>
    <polygon points="360,560 1240,560 1420,860 180,860" fill="url(#hexes)"/>
    <polygon points="360,560 1240,560 1420,860 180,860" fill="url(#matShade)"/>
    <g transform="translate(800 705) scale(1 .42)" opacity=".55"><path d="M0-120 104-60V60L0 120-104 60V-60Z" fill="none" stroke="url(#rope)" stroke-width="6" filter="url(#neon)"/><path d="M-50-30h100M-50 0h100M-50 30h100" stroke="#e6ebf5" stroke-width="7" opacity=".5"/></g>
    <ellipse class="pool red" cx="${SIDE.red.x}" cy="${FEET}" rx="150" ry="34" fill="url(#pool-red)"/>
    <ellipse class="pool blue" cx="${SIDE.blue.x}" cy="${FEET}" rx="150" ry="34" fill="url(#pool-blue)"/>
    ${post(360, 430, 572, SIDE.red.color)}${post(1240, 430, 572, SIDE.blue.color)}
    ${[458, 492, 526].map((y, i) => `<line x1="360" y1="${y}" x2="1240" y2="${y}" stroke="url(#rope)" stroke-width="${4 - i * 0.6}" opacity=".85"/>
      <line x1="360" y1="${y}" x2="180" y2="${y + 268}" stroke="${SIDE.red.color}" stroke-width="${5 - i * 0.6}" opacity=".85"/>
      <line x1="1240" y1="${y}" x2="1420" y2="${y + 268}" stroke="${SIDE.blue.color}" stroke-width="${5 - i * 0.6}" opacity=".85"/>`).join('')}
  </g>`;
}

function ringFront() {
  const post = (x, color) => `<rect x="${x - 12}" y="690" width="24" height="190" rx="8" fill="url(#metalDark)"/><rect x="${x - 15}" y="682" width="30" height="28" rx="9" fill="${color}" filter="url(#neon)"/>`;
  return `<g class="ringfront">
    <g filter="url(#neon)" opacity=".8">${[726, 768, 810].map((y, i) => `<line x1="180" y1="${y}" x2="1420" y2="${y}" stroke="url(#rope)" stroke-width="${6 - i}"/>`).join('')}</g>
    ${post(180, SIDE.red.color)}${post(1420, SIDE.blue.color)}
    <polygon points="180,860 1420,860 1440,900 160,900" fill="#070b15"/>
    <text x="800" y="890" text-anchor="middle" class="apron">IBITI AGENT ARENA</text>
  </g>`;
}

/** One robot boxer in its own coordinates: feet at 0, +x towards the centre of the ring. */
function robot(side) {
  const c = SIDE[side];
  const arm = (cls, x) => `<g transform="translate(${x} -248)"><g class="${cls}-sh">
      <rect x="-15" y="-6" width="30" height="78" rx="14" fill="url(#metal)" stroke="#2a3142" stroke-width="2"/>
      <circle cx="0" cy="0" r="17" fill="url(#metalDark)"/>
      <g transform="translate(0 70)"><g class="${cls}-el">
        <rect x="-12" y="-4" width="24" height="64" rx="12" fill="url(#metal)" stroke="#2a3142" stroke-width="2"/>
        <g transform="translate(0 70)"><ellipse rx="27" ry="30" fill="url(#glove-${side})" stroke="${c.deep}" stroke-width="3"/><rect x="-21" y="-34" width="42" height="12" rx="6" fill="#e6ebf5" opacity=".85"/></g>
      </g></g>
    </g></g>`;
  return `<g class="bot ${side}">
    <ellipse cx="0" cy="2" rx="80" ry="16" fill="#000" opacity=".45" filter="url(#soft)"/>
    <g class="body">
      <g class="legs">
        <rect x="-44" y="-122" width="32" height="118" rx="13" fill="url(#metal)" stroke="#2a3142" stroke-width="2"/>
        <rect x="12" y="-122" width="32" height="118" rx="13" fill="url(#metal)" stroke="#2a3142" stroke-width="2"/>
        <rect x="-52" y="-16" width="46" height="18" rx="8" fill="#2a3142"/><rect x="6" y="-16" width="46" height="18" rx="8" fill="#2a3142"/>
      </g>
      <path d="M-60-150h120l8 42H-68Z" fill="${c.color}" stroke="${c.deep}" stroke-width="3"/>
      <rect x="-62" y="-158" width="124" height="16" rx="6" fill="#f5b301"/>
      <path d="M-80-262h160l-22 108h-116Z" fill="url(#metal)" stroke="#2a3142" stroke-width="3"/>
      <path d="M0-236l26 15v30L0-176l-26-15v-30Z" fill="${c.color}" filter="url(#neon)" class="core"/>
      <rect x="-14" y="-282" width="28" height="24" rx="6" fill="url(#metalDark)"/>
      ${arm('al', -84)}
      <g class="head"><g transform="translate(0 -282)">
        <line x1="0" y1="-74" x2="0" y2="-96" stroke="#9aa4b8" stroke-width="5"/><circle class="beacon" cx="0" cy="-100" r="9" fill="${c.color}" filter="url(#neon)"/>
        <rect x="-60" y="-78" width="120" height="80" rx="26" fill="url(#metal)" stroke="#2a3142" stroke-width="3"/>
        <circle cx="-62" cy="-38" r="11" fill="url(#metalDark)"/><circle cx="62" cy="-38" r="11" fill="url(#metalDark)"/>
        <rect x="-46" y="-62" width="92" height="44" rx="16" fill="url(#visor)"/>
        <g class="eyes open on" fill="${c.color}" filter="url(#neon)"><rect x="-32" y="-50" width="20" height="18" rx="6"/><rect x="12" y="-50" width="20" height="18" rx="6"/></g>
        <g class="eyes happy" fill="none" stroke="${c.color}" stroke-width="6" stroke-linecap="round" filter="url(#neon)"><path d="M-32-34q10-16 20 0M12-34q10-16 20 0"/></g>
        <g class="eyes sad" stroke="${c.color}" stroke-width="6" stroke-linecap="round" filter="url(#neon)"><path d="M-32-46l20 8M32-46l-20 8"/></g>
      </g></g>
      ${arm('ar', 84)}
    </g>
  </g>`;
}

/** A console with a hologram screen, on the inner side of each robot. */
function consoleOf(side) {
  const c = SIDE[side];
  const lines = Array.from({ length: 9 }, (_, i) => `<rect x="${-58 + (i % 3) * 6}" y="${-196 + i * 14}" width="${40 + ((i * 37) % 60)}" height="5" rx="2" fill="#fff" opacity=".7"/>`).join('');
  return `<g class="desk ${side}">
    <path d="M-34-118h68l12 118h-92Z" fill="url(#metalDark)" stroke="#2a3142" stroke-width="2"/>
    <rect x="-52" y="-128" width="104" height="16" rx="5" fill="#1a2236" stroke="${c.color}" stroke-width="2"/>
    <g class="holo"><path d="M-74-218 74-232v92l-148 6Z" fill="url(#holo-${side})" stroke="${c.color}" stroke-width="2" filter="url(#neon)"/>
      <clipPath id="clip-${side}"><path d="M-70-214 70-228v84l-140 6Z"/></clipPath>
      <g clip-path="url(#clip-${side})"><g class="code">${lines}${lines.replace(/y="(-?\d+)"/g, (_, y) => `y="${Number(y) + 126}"`)}</g></g>
    </g>
  </g>`;
}

// ------------------------------------------------------------------ robot motion

const POSES = {
  idle: (t) => ({ x: 0, y: Math.sin(t * 2) * 2, lean: 0, head: Math.sin(t * 0.7) * 3, sl: 10, el: -6, sr: -10, er: 6 }),
  hype: (t) => {
    const pump = (Math.sin(t * 2.6) + 1) / 2;
    return { x: Math.sin(t * 0.8) * 30 - 8, y: -Math.abs(Math.sin(t * 5.2)) * 14, lean: Math.sin(t * 0.8) * 4, head: Math.sin(t * 1.3) * 6, sl: 30 + 125 * pump, el: -25 * pump, sr: -(30 + 125 * (1 - pump)), er: 25 * (1 - pump) };
  },
  guard: (t) => ({ x: Math.sin(t * 1.7) * 10, y: -Math.abs(Math.sin(t * 4.6)) * 7, lean: 2, head: 0, sl: 22, el: -148 + Math.sin(t * 9) * 6, sr: -14, er: 150 - Math.sin(t * 9 + 1) * 6 }),
  work: (t) => ({ x: 8, y: Math.sin(t * 3) * 1.5, lean: 7, head: 9 + Math.sin(t * 1.9) * 3, sl: -38 + Math.sin(t * 21) * 5, el: -52 + Math.sin(t * 25 + 1) * 8, sr: -66 + Math.sin(t * 19 + 2) * 5, er: -18 + Math.sin(t * 23) * 8 }),
  done: (t) => ({ x: 0, y: -Math.abs(Math.sin(t * 5)) * 22, lean: 0, head: Math.sin(t * 3) * 4, sl: 158 + Math.sin(t * 10) * 7, el: -12, sr: -158 - Math.sin(t * 10) * 7, er: 12 }),
  fail: (t) => ({ x: -6, y: 8, lean: -3, head: -14 + Math.sin(t * 1.6) * 9, sl: 4, el: -4, sr: -4, er: 4 }),
  win: (t) => ({ x: Math.sin(t * 1.2) * 30, y: -Math.abs(Math.sin(t * 6)) * 34, lean: 0, head: Math.sin(t * 4) * 5, sl: 150 + Math.sin(t * 12) * 12, el: -20 + Math.sin(t * 12) * 10, sr: -150 - Math.sin(t * 12 + 1) * 12, er: 20 - Math.sin(t * 12 + 1) * 10 }),
  lose: (t) => ({ x: -10, y: 16, lean: -5, head: -18 + Math.sin(t * 1.2) * 6, sl: 2, el: 0, sr: -2, er: 0 }),
};
const EYES = { idle: 'open', hype: 'open', guard: 'open', work: 'open', done: 'happy', win: 'happy', fail: 'sad', lose: 'sad' };

// ------------------------------------------------------------------ the crowd (canvas)

function makeCrowd() {
  const rows = [];
  const N = 13;
  for (let r = 0; r < N; r++) {
    const k = r / (N - 1);
    const s = 6 + 13 * k;
    const gap = s * 2.25;
    const people = [];
    for (let x = -20 + (r % 2) * gap * 0.5; x < W + 20; x += gap * (0.85 + Math.random() * 0.3)) {
      const side = x < 700 ? 'red' : x > 900 ? 'blue' : Math.random() < 0.5 ? 'red' : 'blue';
      people.push({ x, side, phase: Math.random() * 6.28, speed: 0.8 + Math.random() * 0.6, flag: Math.random() < 0.05, shade: Math.random(), flash: 0 });
    }
    rows.push({ y: 70 + 440 * Math.pow(k, 1.1), s, k, people });
  }
  return rows;
}

/** The far stands, too small to move: drawn once, from the top of tall screens down to the live rows. */
function farStands() {
  const top = -620;
  const bottom = 80;
  const res = 0.7;
  const off = document.createElement('canvas');
  off.width = Math.round(W * res);
  off.height = Math.round((bottom - top) * res);
  const c = off.getContext('2d');
  c.scale(res, res);
  c.translate(0, -top);
  for (let y = top; y < bottom;) {
    const k = (y - top) / (bottom - top);
    const s = 2.6 + 3.6 * k;
    const lit = 0.18 + 0.4 * k;
    for (let x = Math.random() * s; x < W; x += s * (2 + Math.random() * 0.6)) {
      const red = x < 760 || (x < 840 && Math.random() < 0.5);
      c.fillStyle = red ? `rgba(${90 * lit + 20},${30 * lit + 12},${50 * lit + 22},1)` : `rgba(${30 * lit + 12},${50 * lit + 20},${110 * lit + 28},1)`;
      c.beginPath();
      c.arc(x, y, s * 0.6, 0, Math.PI * 2);
      c.ellipse(x, y + s * 1.2, s * 1.1, s * 0.8, 0, Math.PI, 0);
      c.fill();
      if (Math.random() < 0.012) {
        c.fillStyle = 'rgba(255,255,235,.85)';
        c.fillRect(x - 0.8, y - s * 0.4, 1.6, 1.6);
      }
    }
    y += s * 2.3;
    if (Math.random() < 0.08) {
      c.fillStyle = 'rgba(120,150,230,.18)';
      c.fillRect(0, y - 1, W, 2); // a railing between two tiers
    }
  }
  return { img: off, top, bottom };
}

// ------------------------------------------------------------------ the scene

export function createScene(root) {
  root.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.className = 'crowd';
  canvas.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMax slice');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('stage');
  svg.innerHTML = `${defs()}${ringBack()}
    <g class="fighter-red" transform="translate(${SIDE.red.x} ${FEET})">${consoleOf('red').replace('<g class="desk red">', '<g class="desk red" transform="translate(112 0)">')}${robot('red')}</g>
    <g class="fighter-blue" transform="translate(${SIDE.blue.x} ${FEET}) scale(-1 1)">${consoleOf('blue').replace('<g class="desk blue">', '<g class="desk blue" transform="translate(112 0)">')}${robot('blue')}</g>
    ${ringFront()}`;
  root.append(canvas, svg);
  const ctx = canvas.getContext('2d');
  const crowd = makeCrowd();
  const far = farStands();

  const bots = {};
  for (const side of ['red', 'blue']) {
    const g = svg.querySelector(`.bot.${side}`);
    bots[side] = {
      g,
      wrap: svg.querySelector(`.fighter-${side}`),
      body: g.querySelector('.body'),
      head: g.querySelector('.head'),
      sl: g.querySelector('.al-sh'), el: g.querySelector('.al-el'), sr: g.querySelector('.ar-sh'), er: g.querySelector('.ar-el'),
      desk: svg.querySelector(`.desk.${side}`),
      code: svg.querySelector(`.desk.${side} .code`),
      pose: 'hype', since: performance.now() / 1000,
      cur: { x: 0, y: 0, lean: 0, head: 0, sl: 10, el: 0, sr: -10, er: 0 },
      present: true,
    };
  }
  const state = {
    exc: { red: 0.35, blue: 0.35 }, // how loud each half of the crowd is
    lights: 'sweep',
    winner: null,
    ticker: 'IBITI AGENT ARENA',
    tickerX: 0,
  };

  let view = { scale: 1, ox: 0, oy: 0, w: 1, h: 1, dpr: 1 };
  function resize() {
    const r = root.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    // always the whole ring and both corners; wider screens see more of the hall, taller ones more stands
    const aspect = Math.max(0.2, r.width / Math.max(1, r.height));
    const span = Math.max(780, Math.min(W, aspect * H));
    const vx = W / 2 - span / 2;
    const vy = H - span / aspect;
    svg.setAttribute('viewBox', `${vx.toFixed(1)} ${vy.toFixed(1)} ${span.toFixed(1)} ${(span / aspect).toFixed(1)}`);
    const scale = r.width / span;
    view = { scale, ox: -vx * scale, oy: -vy * scale, w: r.width, h: r.height, dpr, top: vy };
  }
  resize();
  new ResizeObserver(resize).observe(root);

  function drawCrowd(t) {
    const { scale, ox, oy, dpr } = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
    const x0 = -ox / scale - 40;
    const x1 = (view.w - ox) / scale + 40;
    // the hall
    const sky = ctx.createLinearGradient(0, -600, 0, 560);
    sky.addColorStop(0, '#05070d');
    sky.addColorStop(1, '#0d1526');
    ctx.fillStyle = sky;
    ctx.fillRect(x0, -700, x1 - x0, 1300);
    if (view.top < far.bottom) ctx.drawImage(far.img, 0, far.top, W, far.bottom - far.top);
    for (const [side, cx] of [['red', 250], ['blue', 1350]]) {
      const g = ctx.createRadialGradient(cx, 380, 20, cx, 380, 700);
      g.addColorStop(0, `${SIDE[side].glow}${0.16 + state.exc[side] * 0.18})`);
      g.addColorStop(1, `${SIDE[side].glow}0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x0, -700, x1 - x0, 1300);
    }
    // the fans, row by row from the back
    for (const row of crowd) {
      const heads = { red: new Path2D(), blue: new Path2D() };
      const arms = new Path2D();
      const flags = { red: new Path2D(), blue: new Path2D() };
      const poles = new Path2D();
      const flashes = new Path2D();
      for (const p of row.people) {
        if (p.x < x0 || p.x > x1) continue;
        const e = state.exc[p.side];
        const u = (p.x - 800) / 800;
        const by = row.y + 22 * (1 - u * u) * row.k;
        const jump = reduced ? 0 : Math.max(0, Math.sin(t * 3.2 * p.speed + p.phase)) * row.s * (0.15 + e * 0.9);
        const y = by - jump;
        heads[p.side].ellipse(p.x, y + row.s * 1.25, row.s * 1.25, row.s * 0.85, 0, Math.PI, 0);
        heads[p.side].moveTo(p.x + row.s * 0.62, y);
        heads[p.side].arc(p.x, y, row.s * 0.62, 0, Math.PI * 2);
        if (e > 0.55 && Math.sin(t * 2.1 * p.speed + p.phase * 3) > 1.35 - e) {
          arms.moveTo(p.x - row.s * 0.9, y + row.s * 0.6);
          arms.lineTo(p.x - row.s * 1.3, y - row.s * 1.2);
          arms.moveTo(p.x + row.s * 0.9, y + row.s * 0.6);
          arms.lineTo(p.x + row.s * 1.3, y - row.s * 1.2);
        }
        if (p.flag) {
          const sway = reduced ? 0 : Math.sin(t * 4 + p.phase) * row.s * (0.4 + e);
          poles.moveTo(p.x + row.s * 0.5, y + row.s * 0.2);
          poles.lineTo(p.x + row.s * 0.5 + sway * 0.4, y - row.s * 2.4);
          flags[p.side].rect(p.x + row.s * 0.5 + sway * 0.4, y - row.s * 2.4, row.s * 1.3, row.s * 0.75);
        }
        if (!reduced && e > 0.45 && Math.random() < 0.0016 * e) p.flash = 1;
        if (p.flash > 0) {
          flashes.moveTo(p.x + row.s * 0.4, y - row.s * 0.3);
          flashes.arc(p.x, y - row.s * 0.3, row.s * 0.4 * p.flash + 0.5, 0, Math.PI * 2);
          p.flash -= 0.06;
        }
      }
      const lit = 0.25 + row.k * 0.55;
      ctx.fillStyle = `rgba(${70 * lit + 20}, ${24 * lit + 14}, ${40 * lit + 24}, 1)`;
      ctx.fill(heads.red);
      ctx.fillStyle = `rgba(${26 * lit + 14}, ${40 * lit + 22}, ${90 * lit + 30}, 1)`;
      ctx.fill(heads.blue);
      ctx.strokeStyle = `rgba(200,210,235,${0.25 + row.k * 0.35})`;
      ctx.lineWidth = Math.max(1.2, row.s * 0.28);
      ctx.lineCap = 'round';
      ctx.stroke(arms);
      ctx.strokeStyle = 'rgba(200,210,235,.5)';
      ctx.lineWidth = Math.max(0.8, row.s * 0.12);
      ctx.stroke(poles);
      ctx.fillStyle = SIDE.red.color;
      ctx.fill(flags.red);
      ctx.fillStyle = SIDE.blue.color;
      ctx.fill(flags.blue);
      ctx.fillStyle = 'rgba(255,255,240,.95)';
      ctx.fill(flashes);
    }
    // the LED band between the stands and the ring
    ctx.fillStyle = '#060a14';
    ctx.fillRect(x0, 528, x1 - x0, 30);
    const band = ctx.createLinearGradient(x0, 0, x1, 0);
    band.addColorStop(0, 'rgba(239,68,68,.9)');
    band.addColorStop(0.5, 'rgba(245,179,1,.9)');
    band.addColorStop(1, 'rgba(34,197,94,.9)');
    ctx.fillStyle = band;
    ctx.fillRect(x0, 528, x1 - x0, 2);
    ctx.fillRect(x0, 556, x1 - x0, 2);
    ctx.font = '700 17px Unbounded, Inter, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f5b301';
    const text = `${state.ticker}   ◆   `;
    const tw = Math.max(1, ctx.measureText(text).width);
    if (!reduced) state.tickerX = (state.tickerX + 1.2) % tw;
    for (let x = x0 - state.tickerX; x < x1; x += tw) ctx.fillText(text, x, 543);
    // the lights
    ctx.globalCompositeOperation = 'lighter';
    const beam = (fromX, toX, toY, color, alpha, width) => {
      const g = ctx.createLinearGradient(fromX, -120, toX, toY);
      g.addColorStop(0, `${color}${alpha})`);
      g.addColorStop(1, `${color}0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(fromX - 10, -120);
      ctx.lineTo(fromX + 10, -120);
      ctx.lineTo(toX + width, toY);
      ctx.lineTo(toX - width, toY);
      ctx.closePath();
      ctx.fill();
    };
    if (state.lights === 'sweep') {
      for (let i = 0; i < 4; i++) {
        const sx = 250 + i * 370;
        const tx = 800 + Math.sin(t * (0.5 + i * 0.13) + i * 1.7) * 520;
        beam(sx, tx, 800, i % 2 ? 'rgba(59,130,246,' : 'rgba(239,68,68,', 0.22, 120);
      }
    } else if (state.lights === 'focus') {
      beam(SIDE.red.x - 200, SIDE.red.x, FEET, 'rgba(255,170,170,', 0.2 + state.exc.red * 0.12, 110);
      beam(SIDE.blue.x + 200, SIDE.blue.x, FEET, 'rgba(170,200,255,', 0.2 + state.exc.blue * 0.12, 110);
    } else if (state.lights === 'winner' && state.winner) {
      const x = SIDE[state.winner].x;
      beam(x, x, FEET, 'rgba(255,214,102,', 0.34, 150);
      beam(x - 500, x, FEET, 'rgba(255,214,102,', 0.16, 90);
      beam(x + 500, x, FEET, 'rgba(255,214,102,', 0.16, 90);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function moveBots(t, dt) {
    for (const side of ['red', 'blue']) {
      const b = bots[side];
      if (!b.present) continue;
      const pose = POSES[b.pose] ?? POSES.idle;
      const tgt = reduced ? POSES.idle(0) : pose(t - b.since + (side === 'blue' ? 0.7 : 0));
      const k = Math.min(1, dt * 9);
      for (const key of Object.keys(tgt)) b.cur[key] += (tgt[key] - b.cur[key]) * k;
      const c = b.cur;
      b.body.setAttribute('transform', `translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) rotate(${c.lean.toFixed(1)})`);
      b.head.setAttribute('transform', `rotate(${c.head.toFixed(1)} 0 -282)`);
      b.sl.setAttribute('transform', `rotate(${c.sl.toFixed(1)})`);
      b.el.setAttribute('transform', `rotate(${c.el.toFixed(1)})`);
      b.sr.setAttribute('transform', `rotate(${c.sr.toFixed(1)})`);
      b.er.setAttribute('transform', `rotate(${c.er.toFixed(1)})`);
      if (b.pose === 'work' && !reduced) b.code.setAttribute('transform', `translate(0 ${-((t * 60) % 126).toFixed(1)})`);
    }
  }

  let last = performance.now() / 1000;
  function frame() {
    const t = performance.now() / 1000;
    const dt = Math.min(0.1, t - last);
    last = t;
    for (const side of ['red', 'blue']) state.exc[side] += (0.32 - state.exc[side]) * Math.min(1, dt * 0.35);
    drawCrowd(t);
    moveBots(t, dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    /** Who stands in the ring; a solo fight leaves the blue corner empty. */
    setFighters({ red = true, blue }) {
      bots.red.present = !!red;
      bots.red.wrap.style.display = red ? '' : 'none';
      bots.blue.present = !!blue;
      bots.blue.wrap.style.display = blue ? '' : 'none';
    },
    setPose(side, pose) {
      const b = bots[side];
      if (!b || b.pose === pose) return;
      b.pose = pose;
      b.since = performance.now() / 1000;
      b.g.querySelectorAll('.eyes').forEach((e) => e.classList.toggle('on', e.classList.contains(EYES[pose] ?? 'open')));
      b.desk.classList.toggle('on', pose === 'work' || pose === 'done' || pose === 'fail');
    },
    poseOf: (side) => bots[side]?.pose,
    /** The fans of one corner (or both) get loud. */
    excite(side, amount) {
      for (const s of side ? [side] : ['red', 'blue']) state.exc[s] = Math.min(1, Math.max(state.exc[s], amount));
    },
    setLights(mode, winner = null) {
      state.lights = mode;
      state.winner = winner;
    },
    setTicker(text) {
      state.ticker = text;
    },
    // the 3D scene has these too; the flat one has nothing to show for them
    signal() {},
    pyro() {},
    setBoard() {},
    bump() {},
    kind: '2d',
  };
}
