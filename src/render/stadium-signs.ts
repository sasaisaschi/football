import * as THREE from 'three';

/**
 * Lettering of the stadium in the reference picture: navy LED boards with white and light blue words, white club
 * banners with blue lettering, blue flags with a white stripe, and the slanted "THE 12TH MAN" carpets. Canvas textures,
 * drawn once (the boards redraw as their messages pass).
 */
const NAVY = '#0c1b3d', WHITE = '#f2f5f9', LIGHT_BLUE = '#8fc3ff', CLUB_BLUE = '#1f4fb4';
const FONT = (px: number) => `800 ${px}px Bahnschrift, 'Segoe UI', sans-serif`;

function canvasTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A small round crest: the club's blue disc with a white ring. */
function crest(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.fillStyle = CLUB_BLUE; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.strokeStyle = WHITE; c.lineWidth = r * 0.16; c.beginPath(); c.arc(x, y, r * 0.78, 0, Math.PI * 2); c.stroke();
  c.fillStyle = WHITE; c.font = FONT(r * 0.9); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('R', x, y + r * 0.06);
  c.textAlign = 'left';
}

/** The perimeter boards' strip; `draw(offset)` scrolls the messages. */
export function advertTexture(messages: readonly string[]): { texture: THREE.CanvasTexture; draw(offset: number): void } {
  const canvas = document.createElement('canvas');
  canvas.width = 2048; canvas.height = 64;
  const c = canvas.getContext('2d')!;
  const draw = (offset: number) => {
    c.fillStyle = NAVY; c.fillRect(0, 0, 2048, 64);
    c.font = FONT(38); c.textBaseline = 'middle';
    let x = -offset;
    while (x < 2048) {
      for (const [i, m] of messages.entries()) {
        crest(c, x + 22, 32, 20);
        c.fillStyle = i % 2 ? LIGHT_BLUE : WHITE;
        c.fillText(m, x + 54, 34);
        x += c.measureText(m).width + 140;
      }
    }
  };
  draw(0);
  return { texture: canvasTexture(canvas), draw };
}

/** A banner on a stand front: white with the club's name in blue (or a plain blue-white flag). */
export function bannerTexture(text: string, flag = false): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 164;
  const c = canvas.getContext('2d')!;
  if (flag) {
    c.fillStyle = CLUB_BLUE; c.fillRect(0, 0, 512, 164);
    c.fillStyle = WHITE; c.fillRect(0, 62, 512, 40);
    crest(c, 256, 82, 46);
  } else {
    c.fillStyle = WHITE; c.fillRect(0, 0, 512, 164);
    c.fillStyle = CLUB_BLUE; c.fillRect(0, 0, 512, 14); c.fillRect(0, 150, 512, 14);
    c.font = FONT(92); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 256, 88, 470);
  }
  return canvasTexture(canvas);
}

/** The slanted sign beside the goals: white lettering on navy with the crest. */
export function carpetTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 180;
  const c = canvas.getContext('2d')!;
  c.fillStyle = NAVY; c.fillRect(0, 0, 1024, 180);
  c.font = FONT(120); c.textBaseline = 'middle'; c.fillStyle = WHITE;
  c.fillText(text, 40, 96, 800);
  crest(c, 940, 90, 62);
  return canvasTexture(canvas);
}
