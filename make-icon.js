const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(height * rowSize);
  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0;
    rgba.copy(raw, y * rowSize + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Форма скругленного квадрата для подложки (SDF)
function roundedBoxSdf(x, y, b, r) {
  const qx = Math.abs(x) - b + r;
  const qy = Math.abs(y) - b + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Форма шестеренки с 8 зубцами (SDF)
function gearSdf(x, y) {
  const r = Math.hypot(x, y);
  const teeth = 8;
  const step = (Math.PI * 2) / teeth;
  const angle = Math.atan2(y, x);
  const sector = (((angle % step) + step) % step) - step / 2;
  const absSector = Math.abs(sector);

  const t = Math.max(0, Math.min(1, (absSector - step * 0.14) / (step * 0.11)));
  const outerR = 0.68 * (1 - t) + 0.50 * t;
  const holeR = 0.20;

  const dOuter = r - outerR;
  const dHole = holeR - r;
  return Math.max(dOuter, dHole);
}

// Рендер 3D-шестеренки на черном скругленном фоне
function render3DGear(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cosA = Math.cos(-0.32);
  const sinA = Math.sin(-0.32);
  const tiltY = 0.78;
  const layers = 26;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = (px / size) * 2 - 1;
      const ny = (py / size) * 2 - 1;

      let r = 0, g = 0, b = 0, a = 0;

      // 1. Черная подложка со скругленными углами и тонкой рамкой
      const dBg = roundedBoxSdf(nx, ny, 0.94, 0.24);
      const bgAlpha = Math.max(0, Math.min(1, 0.5 - dBg * (size * 0.5)));

      if (bgAlpha > 0) {
        // Глубокий черный фон (#121214)
        let bgR = 18, bgG = 18, bgB = 20;

        // Легкое синее свечение в центре под шестеренкой для объема
        const glow = Math.max(0, 1 - Math.hypot(nx, ny) * 1.15);
        bgR += glow * 10;
        bgG += glow * 22;
        bgB += glow * 45;

        // Тонкая серая рамка по краю, чтобы иконка не терялась на черном фоне
        if (dBg > -0.025) {
          bgR = 55;
          bgG = 60;
          bgB = 72;
        }

        r = bgR;
        g = bgG;
        b = bgB;
        a = bgAlpha;
      }

      // 2. Послойная 3D-экструзия шестеренки (снизу вверх)
      const gearNy = ny + 0.05;
      for (let l = layers; l >= 0; l--) {
        const progress = l / layers;
        const ox = nx - progress * 0.055;
        const oy = (gearNy - progress * 0.17) / tiltY;

        const rx = ox * cosA - oy * sinA;
        const ry = ox * sinA + oy * cosA;
        const d = gearSdf(rx, ry);
        const aa = Math.max(0, Math.min(1, 0.5 - d * (size * 0.42)));

        if (aa > 0) {
          let lr, lg, lb;
          if (l === 0) {
            // Лицевая поверхность с ярким синим металликом
            const grad = Math.max(0, Math.min(1, (rx + ry + 1.0) / 2.0));
            lr = 110 * (1 - grad) + 37 * grad;
            lg = 175 * (1 - grad) + 99 * grad;
            lb = 255 * (1 - grad) + 235 * grad;

            // Внутренняя фаска вокруг отверстия
            const distCenter = Math.hypot(rx, ry);
            if (distCenter > 0.20 && distCenter < 0.30) {
              const bevel = 1 - Math.abs(distCenter - 0.25) / 0.05;
              lr = lr * (1 - bevel * 0.4) + 210 * (bevel * 0.4);
              lg = lg * (1 - bevel * 0.4) + 230 * (bevel * 0.4);
              lb = lb * (1 - bevel * 0.4) + 255 * (bevel * 0.4);
            }

            // Светлая кромка (фаска)
            if (d > -0.022) {
              lr = Math.min(255, lr + 60);
              lg = Math.min(255, lg + 60);
              lb = Math.min(255, lb + 50);
            }
          } else {
            // Боковая 3D-грань
            const shade = 1 - progress * 0.55;
            lr = 32 * shade;
            lg = 75 * shade;
            lb = 180 * shade;
          }

          r = lr * aa + r * (1 - aa);
          g = lg * aa + g * (1 - aa);
          b = lb * aa + b * (1 - aa);
          a = aa + a * (1 - aa);
        }
      }

      const idx = (py * size + px) * 4;
      rgba[idx] = Math.round(r);
      rgba[idx + 1] = Math.round(g);
      rgba[idx + 2] = Math.round(b);
      rgba[idx + 3] = Math.round(a * 255);
    }
  }
  return rgba;
}

function buildIco() {
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = sizes.map((s) => encodePng(s, s, render3DGear(s)));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);

  const dirEntries = [];
  let offset = 6 + sizes.length * 16;

  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i];
    const png = pngBuffers[i];
    const entry = Buffer.alloc(16);
    entry[0] = s === 256 ? 0 : s;
    entry[1] = s === 256 ? 0 : s;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += png.length;
  }

  const outPath = path.join(__dirname, 'assets', 'icon.ico');
  fs.writeFileSync(outPath, Buffer.concat([header, ...dirEntries, ...pngBuffers]));
  console.log('Готово! 3D-иконка на черном фоне записана в assets/icon.ico');
}

buildIco();
