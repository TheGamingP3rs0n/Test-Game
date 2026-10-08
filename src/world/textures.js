// Canvas-drawn textures: floor tiles, posters, the live quota TV, monitor screens,
// the city outside the windows. Drawn at runtime so they can update live.
import * as THREE from 'three';
import { drawIcon, stripEmoji } from '../ui/icons.js';

export function canvasTexture(w, h, draw, { repeat = null, srgb = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.userData.redraw = (fn) => {
    fn(ctx, w, h);
    tex.needsUpdate = true;
  };
  return tex;
}

function noise(ctx, w, h, alpha = 0.05, n = 2500) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

export function floorTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const tiles = 4;
    const s = w / tiles;
    for (let y = 0; y < tiles; y++) {
      for (let x = 0; x < tiles; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#b9b3a2' : '#a9a493';
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
    noise(ctx, w, h, 0.06, 6000);
    ctx.strokeStyle = 'rgba(60,55,45,0.35)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s, 0);
      ctx.lineTo(i * s, h);
      ctx.moveTo(0, i * s);
      ctx.lineTo(w, i * s);
      ctx.stroke();
    }
    // stains
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = 'rgba(90,70,40,0.08)';
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 40, 10 + Math.random() * 25, Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { repeat: [9, 6] });
}

export function ceilingTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e8e4d8';
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 0.05, 3000);
    ctx.strokeStyle = '#b8b2a2';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(150,120,60,0.15)';
    ctx.beginPath();
    ctx.arc(w * 0.7, h * 0.3, 30, 0, Math.PI * 2);
    ctx.fill();
  }, { repeat: [9, 6] });
}

export function wallTexture(color = '#d9cfa8') {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 0.04, 4000);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, h - 22, w, 22);
  }, { repeat: [4, 1] });
}

export function posterTexture({ title, sub = '', bg = '#1f9d4c', fg = '#ffe14d', icon = '' }) {
  return canvasTexture(256, 360, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.textAlign = 'center';
    if (icon) drawIcon(ctx, icon, w / 2 - 48, 52, 96, fg, 2.2);
    ctx.fillStyle = fg;
    ctx.font = 'bold 34px "Bungee", Impact, sans-serif';
    wrapText(ctx, title, w / 2, icon ? 205 : 120, w - 40, 38);
    ctx.font = 'bold 18px Inter, Arial, sans-serif';
    ctx.fillStyle = '#fff';
    wrapText(ctx, sub, w / 2, h - 60, w - 40, 22);
    noise(ctx, w, h, 0.05, 1500);
  });
}

export function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = String(text).split(' ');
  let line = '';
  const lines = [];
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineH));
  return lines.length;
}

/** The big TV over the call floor: live quota + clock. */
export function quotaBoardTexture() {
  return canvasTexture(1024, 576, (ctx, w, h) => drawQuotaBoard(ctx, w, h, {}));
}

export function drawQuotaBoard(ctx, w, h, { day = 1, time = '9:00 AM', earned = 0, quota = 1500, calls = 0, alert = '' }) {
  ctx.fillStyle = '#0b1a12';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1f9d4c';
  ctx.fillRect(0, 0, w, 90);
  ctx.fillStyle = '#ffe14d';
  ctx.font = 'bold 54px "Bungee", Impact, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`DAY ${day}`, 30, 66);
  ctx.textAlign = 'right';
  ctx.fillText(time, w - 30, 66);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#9fe8b9';
  ctx.font = 'bold 40px Inter, Arial, sans-serif';
  ctx.fillText('TODAY\'S QUOTA', w / 2, 160);
  const pct = Math.min(1, earned / Math.max(1, quota));
  ctx.fillStyle = '#163524';
  ctx.fillRect(60, 200, w - 120, 90);
  ctx.fillStyle = pct >= 1 ? '#ffe14d' : '#2fd36b';
  ctx.fillRect(60, 200, (w - 120) * pct, 90);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 60px "Bungee", Impact, sans-serif';
  ctx.fillText(`$${Math.round(earned).toLocaleString()} / $${quota.toLocaleString()}`, w / 2, 268);
  ctx.font = 'bold 34px Inter, Arial, sans-serif';
  ctx.fillStyle = '#9fe8b9';
  ctx.fillText(`CALLS: ${calls}   •   NO EXCUSES   •   NO SLEEP`, w / 2, 360);
  if (alert) {
    ctx.fillStyle = '#d7263d';
    ctx.fillRect(0, h - 140, w, 140);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 56px "Bungee", Impact, sans-serif';
    ctx.fillText(alert, w / 2, h - 50);
  } else {
    ctx.fillStyle = '#ffe14d';
    ctx.font = 'bold 30px Inter, Arial, sans-serif';
    ctx.fillText('"A HAPPY CUSTOMER IS A PAYING CUSTOMER" — MR. CHATTERJEE', w / 2, h - 60);
  }
}

/** Monitor screen for the player's PC (and coworker monitors). Matches the panel's 1.64:1 shape. */
export function screenTexture(kind = 'desktop') {
  return canvasTexture(512, 312, (ctx, w, h) => drawScreen(ctx, w, h, { kind }));
}

export function drawScreen(ctx, w, h, { kind = 'desktop', text = '', trust = null, ringing = false }) {
  ctx.textAlign = 'left';
  if (kind === 'off') {
    ctx.fillStyle = '#040505';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (kind === 'virus') {
    ctx.fillStyle = '#2a0000';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    drawIcon(ctx, 'skull', w / 2 - h * 0.2, h * 0.1, h * 0.4, '#ff3b3b', 2);
    ctx.fillStyle = '#ff4545';
    ctx.font = `bold ${Math.round(h * 0.11)}px "VT323", monospace`;
    ctx.fillText('YOUR FILES ARE ENCRYPTED', w / 2, h * 0.72);
    ctx.font = `${Math.round(h * 0.07)}px "VT323", monospace`;
    ctx.fillText('send 0.5 BTC to unlock', w / 2, h * 0.84);
    return;
  }
  const coworker = kind === 'coworker';
  // wallpaper (same look as the in-game Windoze XD desktop)
  const grd = ctx.createRadialGradient(w * 0.7, h * 0.3, 10, w * 0.6, h * 0.5, w * 0.8);
  grd.addColorStop(0, coworker ? '#3a7bd5' : '#39b26b');
  grd.addColorStop(0.5, coworker ? '#1e4f8f' : '#137a43');
  grd.addColorStop(1, coworker ? '#0f2c52' : '#0b4d2b');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  // desktop icons
  const s = h / 312;
  const icons = ['phone', 'monitor', 'notes', 'globe', 'money'];
  icons.forEach((name, i) => {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(12 * s, (12 + i * 50) * s, 38 * s, 38 * s);
    drawIcon(ctx, name, 19 * s, (19 + i * 50) * s, 24 * s, '#ffffff', 2);
  });
  // a window or two
  if (coworker) {
    ctx.fillStyle = '#ece9d8';
    ctx.fillRect(110 * s, 40 * s, 300 * s, 170 * s);
    ctx.fillStyle = '#3d82f5';
    ctx.fillRect(110 * s, 40 * s, 300 * s, 20 * s);
    ctx.fillStyle = '#cfcfcf';
    for (let i = 0; i < 6; i++) ctx.fillRect(122 * s, (74 + i * 20) * s, (120 + ((i * 53) % 150)) * s, 9 * s);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.font = `${Math.round(40 * s)}px "Bungee", Impact, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText('GLOBAL', w - 18 * s, h - 110 * s);
    ctx.fillText('SOLUTIONS', w - 18 * s, h - 66 * s);
    ctx.textAlign = 'left';
  }
  // taskbar
  ctx.fillStyle = coworker ? '#26292d' : '#1d46b0';
  ctx.fillRect(0, h - 26 * s, w, 26 * s);
  ctx.fillStyle = '#2c9a38';
  ctx.fillRect(0, h - 24 * s, 70 * s, 22 * s);
  ctx.fillStyle = '#fff';
  ctx.font = `italic bold ${Math.round(14 * s)}px Inter, Arial`;
  ctx.fillText('start', 16 * s, h - 8 * s);
  if (text) {
    // call card
    const cx = 110 * s;
    const cy = 64 * s;
    const cw = w - 140 * s;
    const ch = 132 * s;
    ctx.fillStyle = 'rgba(8,20,14,0.92)';
    ctx.fillRect(cx, cy, cw, ch);
    ctx.fillStyle = ringing ? '#ffe14d' : '#2fd36b';
    ctx.fillRect(cx, cy, cw, 6 * s);
    drawIcon(ctx, 'phone', cx + 16 * s, cy + 24 * s, 34 * s, ringing ? '#ffe14d' : '#2fd36b', 2.4);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(26 * s)}px Inter, Arial`;
    ctx.fillText(stripEmoji(text).slice(0, 22), cx + 64 * s, cy + 50 * s);
    if (trust !== null) {
      ctx.fillStyle = '#26332c';
      ctx.fillRect(cx + 18 * s, cy + 82 * s, cw - 36 * s, 20 * s);
      ctx.fillStyle = trust > 66 ? '#2fd36b' : trust > 33 ? '#ffc93c' : '#ff4d4d';
      ctx.fillRect(cx + 18 * s, cy + 82 * s, ((cw - 36 * s) * trust) / 100, 20 * s);
      ctx.fillStyle = '#9fb8a8';
      ctx.font = `bold ${Math.round(14 * s)}px Inter, Arial`;
      ctx.fillText(`TRUST ${Math.round(trust)}`, cx + 18 * s, cy + 122 * s);
    }
  }
}

export function skyTexture() {
  return canvasTexture(16, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#5aa7e0');
    g.addColorStop(0.6, '#f6c48a');
    g.addColorStop(1, '#f39a5b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

export function buildingTexture(seed = 1) {
  return canvasTexture(256, 512, (ctx, w, h) => {
    const colors = ['#c9a27a', '#b9805a', '#d8c3a5', '#9d7b63', '#c4b49a', '#a3b18a'];
    ctx.fillStyle = colors[seed % colors.length];
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 0.08, 4000);
    for (let y = 30; y < h - 40; y += 70) {
      for (let x = 20; x < w - 30; x += 60) {
        ctx.fillStyle = Math.random() < 0.3 ? '#ffe9a8' : '#3b4a5a';
        ctx.fillRect(x, y, 34, 42);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x - 3, y + 42, 40, 5);
      }
    }
    // laundry lines and AC units for flavor
    ctx.fillStyle = '#ddd';
    for (let i = 0; i < 4; i++) ctx.fillRect(Math.random() * (w - 40), 60 + Math.random() * (h - 150), 30, 18);
    ctx.strokeStyle = 'rgba(30,30,30,0.6)';
    ctx.beginPath();
    ctx.moveTo(0, 140);
    ctx.quadraticCurveTo(w / 2, 170, w, 140);
    ctx.stroke();
  });
}

export function signTexture(text, sub) {
  return canvasTexture(1024, 200, (ctx, w, h) => {
    ctx.fillStyle = '#123524';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#ffe14d';
    ctx.textAlign = 'center';
    ctx.font = 'bold 74px "Bungee", Impact, sans-serif';
    ctx.fillText(text, w / 2, 105);
    ctx.fillStyle = '#9fe8b9';
    ctx.font = 'bold 34px Inter, Arial';
    ctx.fillText(sub, w / 2, 160);
  });
}

export function textSprite(text, { bg = 'rgba(255,255,255,0.95)', fg = '#111', font = 'bold 30px Inter, Arial', maxW = 420 } = {}) {
  const pad = 18;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const t = line ? `${line} ${word}` : word;
    if (measure.measureText(t).width > maxW && line) {
      lines.push(line);
      line = word;
    } else line = t;
  }
  lines.push(line);
  const lw = Math.max(...lines.map((l) => measure.measureText(l).width));
  const w = Math.ceil(lw + pad * 2);
  const h = Math.ceil(lines.length * 36 + pad * 2 + 14);
  const tex = canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, w, h - 14, 16);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w / 2 - 12, h - 15);
    ctx.lineTo(w / 2, h);
    ctx.lineTo(w / 2 + 12, h - 15);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.font = font;
    ctx.textAlign = 'center';
    lines.forEach((l, i) => ctx.fillText(l, w / 2, pad + 28 + i * 36));
  });
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(w / 380, h / 380, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function fireTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,200,1)');
    g.addColorStop(0.3, 'rgba(255,170,40,0.9)');
    g.addColorStop(0.7, 'rgba(220,60,10,0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

export function smokeTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(220,220,220,0.7)');
    g.addColorStop(1, 'rgba(120,120,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/**
 * Polished terrazzo floor: color, roughness (grout rough, tiles glossy with smudges)
 * and a normal map for the grout grooves. 4×4 tiles of 60cm per texture repeat.
 */
export function terrazzoMaps(repeat) {
  const N = 1024;
  const tiles = 4;
  const s = N / tiles;
  const grout = 6;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    return c;
  };
  // color
  const col = mk();
  const cc = col.getContext('2d');
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      const v = Math.random() * 10 - 5;
      cc.fillStyle = `rgb(${206 + v},${196 + v},${176 + v})`;
      cc.fillRect(x * s, y * s, s, s);
    }
  }
  const chips = ['#7a6a55', '#a8473a', '#3f5e4f', '#e9e2d0', '#5a5047', '#c08a4a', '#8c8c86', '#2e3a33'];
  for (let i = 0; i < 20000; i++) {
    cc.fillStyle = chips[(Math.random() * chips.length) | 0];
    cc.globalAlpha = 0.35 + Math.random() * 0.6;
    const r = Math.random() < 0.92 ? 1 + Math.random() * 2.2 : 3 + Math.random() * 4;
    cc.beginPath();
    cc.ellipse(Math.random() * N, Math.random() * N, r, r * (0.5 + Math.random() * 0.5), Math.random() * 3, 0, Math.PI * 2);
    cc.fill();
  }
  cc.globalAlpha = 1;
  // wear: darker traffic paths and faint stains
  for (let i = 0; i < 18; i++) {
    const g = cc.createRadialGradient(Math.random() * N, Math.random() * N, 5, Math.random() * N, Math.random() * N, 120 + Math.random() * 200);
    g.addColorStop(0, 'rgba(90,70,45,0.10)');
    g.addColorStop(1, 'rgba(90,70,45,0)');
    cc.fillStyle = g;
    cc.fillRect(0, 0, N, N);
  }
  cc.fillStyle = '#6d6252';
  for (let i = 0; i <= tiles; i++) {
    cc.fillRect(i * s - grout / 2, 0, grout, N);
    cc.fillRect(0, i * s - grout / 2, N, grout);
  }
  // roughness (green channel is what three.js reads)
  const rough = mk();
  const rc = rough.getContext('2d');
  rc.fillStyle = 'rgb(70,70,70)';
  rc.fillRect(0, 0, N, N);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * N;
    const y = Math.random() * N;
    const r = 30 + Math.random() * 160;
    const v = 90 + Math.random() * 90;
    const grd = rc.createRadialGradient(x, y, 2, x, y, r);
    grd.addColorStop(0, `rgba(${v},${v},${v},0.55)`);
    grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
    rc.fillStyle = grd;
    rc.fillRect(x - r, y - r, r * 2, r * 2);
  }
  rc.fillStyle = 'rgb(235,235,235)';
  for (let i = 0; i <= tiles; i++) {
    rc.fillRect(i * s - grout, 0, grout * 2, N);
    rc.fillRect(0, i * s - grout, N, grout * 2);
  }
  // normal map from a grout height field
  const nrm = mk();
  const nc = nrm.getContext('2d');
  const img = nc.createImageData(N, N);
  // flat normal everywhere, then only the pixels near grout lines get real normals
  const u32 = new Uint32Array(img.data.buffer);
  u32.fill((255 << 24) | (255 << 16) | (128 << 8) | 128);
  const height = (x, y) => {
    const gx = Math.min(x % s, s - (x % s));
    const gy = Math.min(y % s, s - (y % s));
    const d = Math.min(gx, gy);
    return d < grout / 2 ? 0 : d < grout ? (d - grout / 2) / (grout / 2) : 1;
  };
  const nearGrout = (v) => {
    const m = v % s;
    return m <= grout + 1 || s - m <= grout + 1;
  };
  for (let y = 0; y < N; y++) {
    const rowNear = nearGrout(y);
    for (let x = 0; x < N; x++) {
      if (!rowNear && !nearGrout(x)) continue;
      const dx = height(x + 1, y) - height(x - 1 + N, y);
      const dy = height(x, y + 1) - height(x, y - 1 + N);
      const nx = -dx * 2.5;
      const ny = -dy * 2.5;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * N + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  nc.putImageData(img, 0, 0);
  const toTex = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = 8;
    return t;
  };
  return { map: toTex(col, true), roughnessMap: toTex(rough, false), normalMap: toTex(nrm, false) };
}

/** Drop ceiling: 60cm acoustic tiles with a metal grid. */
export function dropCeilingTexture(repeat) {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#ebe7dc';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    // a couple of water stains (monsoon season!)
    for (let i = 0; i < 2; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const g = ctx.createRadialGradient(x, y, 4, x, y, 40 + Math.random() * 30);
      g.addColorStop(0, 'rgba(150,115,60,0.0)');
      g.addColorStop(0.7, 'rgba(150,115,60,0.18)');
      g.addColorStop(1, 'rgba(150,115,60,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = '#b9b4a8';
    for (let i = 0; i <= 4; i++) {
      ctx.fillRect(i * (w / 4) - 3, 0, 6, h);
      ctx.fillRect(0, i * (h / 4) - 3, w, 6);
    }
  }, { repeat });
}

export function clockTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => drawClock(ctx, w, h, 9 * 60));
}

export function drawClock(ctx, w, h, minutes) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fbfbf6';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#1d1d1d';
  ctx.stroke();
  ctx.fillStyle = '#222';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.fillRect(w / 2 + Math.sin(a) * 95 - 3, h / 2 - Math.cos(a) * 95 - 8, 6, 16);
  }
  ctx.font = 'bold 16px Inter, Arial';
  ctx.textAlign = 'center';
  ctx.fillText('GLOBAL SOLUTIONS', w / 2, h / 2 + 50);
  const hr = ((minutes / 60) % 12) / 12;
  const mn = (minutes % 60) / 60;
  const hand = (frac, len, width, color) => {
    const a = frac * Math.PI * 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 + Math.sin(a) * len, h / 2 - Math.cos(a) * len);
    ctx.stroke();
  };
  hand(hr, 55, 9, '#111');
  hand(mn, 85, 6, '#111');
  ctx.fillStyle = '#c62828';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 8, 0, Math.PI * 2);
  ctx.fill();
}

export function founderPortraitTexture() {
  return canvasTexture(256, 320, (ctx, w, h) => {
    ctx.fillStyle = '#5a3a1e';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d9c9a3';
    ctx.fillRect(18, 18, w - 36, h - 36);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#9c8c70');
    g.addColorStop(1, '#6e624d');
    ctx.fillStyle = g;
    ctx.fillRect(28, 28, w - 56, h - 90);
    // sepia gentleman with a magnificent moustache
    ctx.fillStyle = '#c9a27a';
    ctx.beginPath();
    ctx.ellipse(w / 2, 130, 52, 64, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b2a1c';
    ctx.beginPath();
    ctx.ellipse(w / 2, 82, 54, 26, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b1d12';
    ctx.beginPath();
    ctx.ellipse(w / 2 - 22, 160, 26, 9, -0.25, 0, Math.PI * 2);
    ctx.ellipse(w / 2 + 22, 160, 26, 9, 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(w / 2 - 26, 118, 14, 5);
    ctx.fillRect(w / 2 + 12, 118, 14, 5);
    ctx.fillStyle = '#efe7d6';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 70, h - 62);
    ctx.lineTo(w / 2, 200);
    ctx.lineTo(w / 2 + 70, h - 62);
    ctx.fill();
    ctx.fillStyle = '#2b1d12';
    ctx.font = 'bold 15px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sri B. Chatterjee (Founder)', w / 2, h - 36);
    ctx.font = '12px Georgia, serif';
    ctx.fillText('1941 – 2009 • "Quota First"', w / 2, h - 20);
  });
}

export function exitSignTexture() {
  return canvasTexture(256, 96, (ctx, w, h) => {
    ctx.fillStyle = '#0a7a35';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#eafff0';
    ctx.font = 'bold 54px Inter, Arial';
    ctx.textAlign = 'center';
    ctx.fillText('EXIT', w / 2, 68);
  });
}
