#!/usr/bin/env node
/* 生成 PWA 图标（pwa/icon-192.png / icon-512.png）。
 *
 * 设计复刻站内 favicon（deck-viewer.html 的内联 SVG）：深底 + 金菱 + 中心孔。
 * 差异：底色满幅不圆角——maskable 图标（Android 自适应图标）要求可被任意裁形，
 * 菱形整体落在中心 0.4S 半径的安全区内（最高顶点 0.328S < 0.4S），purpose 用
 * "any maskable" 一份图标两用。
 *
 * 零依赖：自绘 RGBA 缓冲 + 手写 PNG 编码（zlib deflate + CRC32），产物入库，
 * 改动图标时重跑本脚本即可。 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "pwa");
const BG = [0x12, 0x16, 0x1d];    /* #12161d 与站内 --bg 一致 */
const GOLD = [0xd3, 0xbc, 0x8e];  /* #d3bc8e 与 favicon 菱形一致 */

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const crcInput = Buffer.concat([Buffer.from(type, "ascii"), data]);
  out.writeUInt32BE(crc32(crcInput), 8 + data.length);
  return out;
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  /* 位深 */
  ihdr[9] = 6;  /* 颜色类型：RGBA */
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size); /* 每行前置过滤字节 0（None） */
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- 画面 ---------- */
function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const rx = (19 / 64) * size;   /* 菱形横向半径（favicon M13,32 L51,32） */
  const ry = (21 / 64) * size;   /* 纵向（M32,11 L32,53）——略高，照抄原形 */
  const rHole = (7 / 64) * size; /* 中心孔半径 */
  const SS = 3;                  /* 3×3 超采样抗锯齿 */
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let gold = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const dx = x + (sx + 0.5) / SS - c;
          const dy = y + (sy + 0.5) / SS - c;
          const inDiamond = Math.abs(dx) / rx + Math.abs(dy) / ry <= 1;
          const inHole = dx * dx + dy * dy < rHole * rHole;
          if (inDiamond && !inHole) gold++;
        }
      }
      const t = gold / (SS * SS);
      const o = (y * size + x) * 4;
      px[o] = Math.round(BG[0] + (GOLD[0] - BG[0]) * t);
      px[o + 1] = Math.round(BG[1] + (GOLD[1] - BG[1]) * t);
      px[o + 2] = Math.round(BG[2] + (GOLD[2] - BG[2]) * t);
      px[o + 3] = 255;
    }
  }
  return px;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const file = resolve(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, draw(size)));
  console.log(`生成 ${file}`);
}
