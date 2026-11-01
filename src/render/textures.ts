/** Procedural canvas textures (no external assets). Browser-only. */
import { CanvasTexture, ClampToEdgeWrapping, LinearMipmapLinearFilter, NearestFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { Rng } from '../core/rng';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, opts: { repeat?: boolean; nearest?: boolean; srgb?: boolean; aniso?: number } = {}): CanvasTexture {
  const t = new CanvasTexture(c);
  const wrap = opts.repeat === false ? ClampToEdgeWrapping : RepeatWrapping;
  t.wrapS = wrap;
  t.wrapT = wrap;
  if (opts.nearest) {
    t.magFilter = NearestFilter;
  }
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = opts.aniso ?? 8;
  if (opts.srgb !== false) t.colorSpace = SRGBColorSpace;
  return t;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amp: number, seed: string, speckle = 0): void {
  const rng = new Rng(seed);
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    let n = (rng.next() - 0.5) * amp;
    if (speckle && rng.next() < speckle) n += (rng.next() - 0.3) * amp * 3;
    img.data[i * 4] = Math.max(0, Math.min(255, base[0] + n));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, base[1] + n));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, base[2] + n));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export function asphaltTexture(aniso: number): CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  noise(ctx, 512, 512, [70, 71, 74], 26, 'asphalt', 0.02);
  // subtle darker racing-line rubber band and tyre marks across v (lateral) is handled by the shader colour;
  // here: faint patching/cracks
  const rng = new Rng('asphalt-cracks');
  ctx.strokeStyle = 'rgba(30,30,32,0.25)';
  for (let k = 0; k < 14; k++) {
    ctx.lineWidth = rng.range(0.6, 1.6);
    ctx.beginPath();
    let x = rng.range(0, 512);
    let y = rng.range(0, 512);
    ctx.moveTo(x, y);
    for (let j = 0; j < 8; j++) {
      x += rng.range(-18, 18);
      y += rng.range(-18, 18);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return toTexture(c, { aniso });
}

export function grassTexture(aniso: number): CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  noise(ctx, 256, 256, [78, 118, 52], 30, 'grass', 0.05);
  return toTexture(c, { aniso });
}

export function gravelTexture(aniso: number): CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  noise(ctx, 256, 256, [176, 160, 132], 60, 'gravel', 0.15);
  return toTexture(c, { aniso });
}

export function runoffTarmacTexture(aniso: number): CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  noise(ctx, 256, 256, [92, 94, 98], 20, 'runoff');
  return toTexture(c, { aniso });
}

/** Red/white kerb stripes along u. */
export function kerbTexture(): CanvasTexture {
  const [c, ctx] = canvas(64, 8);
  ctx.fillStyle = '#c8141b';
  ctx.fillRect(0, 0, 32, 8);
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(32, 0, 32, 8);
  return toTexture(c, { nearest: true });
}

export function sausageTexture(): CanvasTexture {
  const [c, ctx] = canvas(64, 8);
  ctx.fillStyle = '#e8c21a';
  ctx.fillRect(0, 0, 40, 8);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(40, 0, 24, 8);
  return toTexture(c, { nearest: true });
}

export function tecproTexture(): CanvasTexture {
  const [c, ctx] = canvas(64, 32);
  ctx.fillStyle = '#1d4fa8';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = '#c42222';
  ctx.fillRect(32, 0, 32, 32);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(31, 0, 2, 32);
  ctx.fillRect(63, 0, 1, 32);
  return toTexture(c);
}

export function tyreWallTexture(): CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  ctx.fillStyle = '#1b1b1b';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = '#2d2d2d';
  ctx.lineWidth = 3;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 2; x++) {
      ctx.beginPath();
      ctx.ellipse(16 + x * 32, 8 + y * 16, 14, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // conveyor belt facing strip
  ctx.fillStyle = 'rgba(240,240,240,0.9)';
  ctx.fillRect(0, 26, 64, 4);
  return toTexture(c);
}

export function armcoTexture(): CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  ctx.fillStyle = '#5c6366';
  ctx.fillRect(0, 0, 64, 64);
  const grd = ctx.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#9aa2a6');
  grd.addColorStop(0.2, '#c9d0d3');
  grd.addColorStop(0.35, '#7b8387');
  grd.addColorStop(0.5, '#4a5154');
  grd.addColorStop(0.65, '#9aa2a6');
  grd.addColorStop(0.8, '#c9d0d3');
  grd.addColorStop(1, '#6b7377');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#2f3436';
  ctx.fillRect(0, 0, 3, 64);
  return toTexture(c);
}

export function concreteTexture(painted: boolean): CanvasTexture {
  const [c, ctx] = canvas(128, 64);
  noise(ctx, 128, 64, painted ? [222, 224, 226] : [168, 168, 164], 14, 'concrete');
  if (painted) {
    ctx.fillStyle = '#1f6fd1';
    ctx.fillRect(0, 50, 128, 14);
  }
  return toTexture(c);
}

/** Wire-mesh catch fence (alpha). */
export function fenceTexture(): CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(200,205,210,0.9)';
  ctx.lineWidth = 1.2;
  for (let k = -64; k < 128; k += 8) {
    ctx.beginPath();
    ctx.moveTo(k, 0);
    ctx.lineTo(k + 64, 64);
    ctx.moveTo(k + 64, 0);
    ctx.lineTo(k, 64);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(90,95,100,1)';
  ctx.fillRect(0, 0, 3, 64); // post every 4 m (u = s/4)
  ctx.fillRect(0, 0, 64, 2);
  return toTexture(c);
}

/** Invented sponsor board. All brand names are fictional. */
export function signTexture(text: string, bg: string, fg: string, accent: string): CanvasTexture {
  const [c, ctx] = canvas(512, 96);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(0, 96);
  ctx.lineTo(70, 0);
  ctx.lineTo(110, 0);
  ctx.lineTo(40, 96);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = 'bold 58px "Arial Black", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 290, 50, 380);
  return toTexture(c, { repeat: false });
}

export function crowdTexture(): CanvasTexture {
  const [c, ctx] = canvas(256, 128);
  const rng = new Rng('crowd');
  ctx.fillStyle = '#3a3f46';
  ctx.fillRect(0, 0, 256, 128);
  const palette = ['#d8d8d8', '#c43030', '#2e5fb8', '#e8c040', '#3a8a4a', '#f08030', '#222222', '#f4e0c8'];
  for (let y = 2; y < 128; y += 8) {
    for (let x = 1; x < 256; x += 4) {
      if (rng.next() < 0.18) continue;
      ctx.fillStyle = rng.pick(palette);
      ctx.fillRect(x, y + rng.int(0, 2), 3, 4);
      ctx.fillStyle = '#e9c7a6';
      ctx.fillRect(x + 0.5, y - 2 + rng.int(0, 2), 2, 2);
    }
  }
  return toTexture(c);
}

export function gridBoxTexture(): CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(245,245,245,0.95)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(2, 2);
  ctx.lineTo(62, 2);
  ctx.moveTo(2, 2);
  ctx.lineTo(2, 30);
  ctx.moveTo(62, 2);
  ctx.lineTo(62, 30);
  ctx.stroke();
  return toTexture(c, { repeat: false });
}

/** Chequered timing line. */
export function chequerTexture(): CanvasTexture {
  const [c, ctx] = canvas(64, 16);
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 4; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
      ctx.fillRect(x * 4, y * 4, 4, 4);
    }
  }
  return toTexture(c, { nearest: true });
}
