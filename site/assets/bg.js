// The living background: a neon arena floor that slowly moves, and sparks drifting up through the
// red and blue spotlights. Light on the CPU; still when the reader asks for reduced motion.
const canvas = document.getElementById('bg');
const ctx = canvas.getContext('2d');
const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let w = 0;
let h = 0;
let dpr = 1;
const sparks = [];

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  w = canvas.clientWidth;
  h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sparks.length = 0;
  const n = Math.round((w * h) / 16000);
  for (let i = 0; i < n; i++) sparks.push(spark(true));
}

function spark(anywhere) {
  const red = Math.random() < 0.5;
  return { x: red ? Math.random() * w * 0.55 : w * 0.45 + Math.random() * w * 0.55, y: anywhere ? Math.random() * h : h + 10, v: 0.15 + Math.random() * 0.5, r: 0.6 + Math.random() * 1.6, red, a: 0.2 + Math.random() * 0.6 };
}

function floor(t) {
  // a perspective grid: the ring floor running toward the horizon
  const horizon = h * 0.58;
  ctx.strokeStyle = 'rgba(59,130,246,0.10)';
  ctx.lineWidth = 1;
  for (let i = -14; i <= 14; i++) {
    ctx.beginPath();
    ctx.moveTo(w / 2 + i * 26, horizon);
    ctx.lineTo(w / 2 + i * w * 0.18, h);
    ctx.stroke();
  }
  const shift = (t * 0.02) % 1;
  for (let k = 0; k < 14; k++) {
    const p = (k + shift) / 14;
    const y = horizon + (h - horizon) * p * p;
    ctx.strokeStyle = `rgba(239,68,68,${0.03 + p * 0.09})`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function frame(t) {
  ctx.clearRect(0, 0, w, h);
  const g1 = ctx.createRadialGradient(w * 0.15, h * 0.1, 0, w * 0.15, h * 0.1, w * 0.55);
  g1.addColorStop(0, 'rgba(239,68,68,0.16)');
  g1.addColorStop(1, 'rgba(239,68,68,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, w, h);
  const g2 = ctx.createRadialGradient(w * 0.85, h * 0.1, 0, w * 0.85, h * 0.1, w * 0.55);
  g2.addColorStop(0, 'rgba(59,130,246,0.18)');
  g2.addColorStop(1, 'rgba(59,130,246,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, w, h);
  floor(t);
  for (const s of sparks) {
    if (!still) s.y -= s.v;
    if (s.y < -10) Object.assign(s, spark(false));
    ctx.fillStyle = s.red ? `rgba(248,113,113,${s.a})` : `rgba(96,165,250,${s.a})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!still) requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
