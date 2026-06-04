// Generates a minimal 128x128 PNG for the CodeMem extension icon
// Run: node generate-icon.js
const fs = require('fs');
const path = require('path');

// Minimal PNG encoder (no dependencies)
function createPNG(width, height, pixels) {
  function crc32(buf) {
    let crc = 0xffffffff;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c;
    }
    for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function adler32(buf) {
    let s1 = 1, s2 = 0;
    for (const b of buf) { s1 = (s1 + b) % 65521; s2 = (s2 + s1) % 65521; }
    return (s2 << 16) | s1;
  }

  function deflateStore(data) {
    const chunks = [];
    const BLOCK = 65535;
    for (let i = 0; i < data.length; i += BLOCK) {
      const block = data.slice(i, i + BLOCK);
      const last = (i + BLOCK >= data.length) ? 1 : 0;
      const len = block.length;
      chunks.push(Buffer.from([last, len & 0xff, (len >> 8) & 0xff, (~len) & 0xff, (~len >> 8) & 0xff]));
      chunks.push(Buffer.from(block));
    }
    const deflated = Buffer.concat(chunks);
    const adler = adler32(data);
    return Buffer.concat([
      Buffer.from([0x78, 0x01]),
      deflated,
      Buffer.from([(adler >> 24) & 0xff, (adler >> 16) & 0xff, (adler >> 8) & 0xff, adler & 0xff])
    ]);
  }

  function chunk(type, data) {
    const typeBytes = Buffer.from(type);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crcData = Buffer.concat([typeBytes, data]);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(crcData));
    return Buffer.concat([len, typeBytes, data, crcBuf]);
  }

  // Build raw image data (RGBA)
  const raw = [];
  for (let y = 0; y < height; y++) {
    raw.push(0); // filter type None
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      raw.push(pixels[idx], pixels[idx+1], pixels[idx+2], pixels[idx+3]);
    }
  }

  const compressed = deflateStore(Buffer.from(raw));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const W = 128, H = 128;
const pixels = new Uint8Array(W * H * 4);

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b; pixels[i+3] = a;
}

function fillRect(x, y, w, h, r, g, b, a = 255) {
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++)
      setPixel(x + dx, y + dy, r, g, b, a);
}

function circle(cx, cy, rx, ry, r, g, b, a = 255) {
  for (let y = cy - ry - 1; y <= cy + ry + 1; y++)
    for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx*dx + dy*dy <= 1) setPixel(x, y, r, g, b, a);
    }
}

function hline(x0, x1, y, r, g, b, a = 255) {
  for (let x = x0; x <= x1; x++) setPixel(x, y, r, g, b, a);
}

function vline(x, y0, y1, r, g, b, a = 255) {
  for (let y = y0; y <= y1; y++) setPixel(x, y, r, g, b, a);
}

// Background - dark gradient
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    pixels[i]   = 20;
    pixels[i+1] = 20 + Math.floor(y * 0.15);
    pixels[i+2] = 40 + Math.floor(y * 0.15);
    pixels[i+3] = 255;
  }

// Rounded rect background
for (let y = 10; y < H - 10; y++)
  for (let x = 10; x < W - 10; x++) {
    const i = (y * W + x) * 4;
    pixels[i]   = 30;
    pixels[i+1] = 35;
    pixels[i+2] = 55;
    pixels[i+3] = 255;
  }

// Database icon (3 ellipses + sides) in purple/blue
const cx = 64, topY = 38, gap = 20;
const ew = 38, eh = 9;
const C1 = [120, 80, 220], C2 = [100, 160, 255];

// Draw 3 ellipses
for (let t = 0; t < 3; t++) {
  const y0 = topY + t * gap;
  circle(cx, y0, ew, eh, C1[0], C1[1], C1[2]);
}

// Fill sides (cylinder walls)
for (let y = topY; y <= topY + 2 * gap; y++) {
  setPixel(cx - ew, y, C1[0], C1[1], C1[2]);
  setPixel(cx - ew + 1, y, C1[0], C1[1], C1[2]);
  setPixel(cx + ew - 1, y, C1[0], C1[1], C1[2]);
  setPixel(cx + ew, y, C1[0], C1[1], C1[2]);
}

// Fill cylinder body (darker)
for (let y = topY + 2; y <= topY + 2 * gap - 2; y++)
  for (let x = cx - ew + 2; x <= cx + ew - 2; x++)
    setPixel(x, y, 45, 50, 80);

// Bright top ellipse highlight
circle(cx, topY, ew, eh, C2[0], C2[1], C2[2]);

// Small glow dots suggesting "memory nodes"
const glowY = topY + 2 * gap + 18;
for (const [gx, c] of [[44, [255,120,80]], [64, [80,200,255]], [84, [120,255,120]]]) {
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++)
      if (dx*dx + dy*dy <= 16)
        setPixel(gx + dx, glowY + dy, c[0], c[1], c[2]);
}

// Connection lines between dots
for (let x = 44; x <= 64; x++) setPixel(x, glowY, 180, 180, 255);
for (let x = 64; x <= 84; x++) setPixel(x, glowY, 180, 180, 255);

const png = createPNG(W, H, pixels);
fs.writeFileSync(path.join(__dirname, 'resources', 'icon.png'), png);
console.log('icon.png created');
