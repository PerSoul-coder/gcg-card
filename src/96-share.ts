/* 96-share.ts —— 牌组分享图（PNG 导出）。
   两层拆分：shareImageLayout 是纯函数（可单测：网格数学 / 边界 / 不重叠），
   exportShareImage 是薄 canvas 层（loadImages 等全部卡面 → 逐 cell 绘制 →
   toBlob → 复用 download）。单图 404 / 断网时画「卡壳」占位，不拖垮整次导出。
   配色与深色主题同源（独立成图不依赖 CSS 变量），固定写死在这里。 */
import { state } from "./data/state";
import { imgFull } from "./core/resources";
import { loadImages } from "./core/image";
import type { ParsedDeck } from "./types";

/* ---------- 画布配色（独立成图，不读 CSS 变量） ---------- */
const C = {
  bg: "#12161d", panel: "#1f2733", line: "#2e3949", gold: "#d3bc8e",
  text: "#e8e2d0", dim: "#8b95a5", shell: "#1a2029",
};

export interface ShareCell { id: number; count: number; x: number; y: number; w: number; h: number }
export interface ShareLayout {
  width: number;
  height: number;
  title: string;
  name: string | null;
  note: string | null;
  code: string;
  curve: number[];                      /* 费用桶 0~5+，按张数计重 */
  charCells: ShareCell[];
  cardCells: ShareCell[];
}

/* ---------- 布局（纯函数）：全部坐标在这里算好，canvas 层只管画 ---------- */
export function shareImageLayout(
  cur: ParsedDeck,
  opts: { name?: string | null; note?: string | null } = {},
): ShareLayout {
  const W = 1080, M = 48, GAP = 16;
  const cards = cur.order.flatMap(t => cur.groups[t]);
  /* 角色行：3 张竖版卡（420:720） */
  const charH = 210, charW = charH * 420 / 720;
  const charRowH = charH + 18;
  /* 费用曲线带 */
  const curveH = 96;
  const buckets = [0, 0, 0, 0, 0, 0];
  for (const x of cards) buckets[Math.min(x.dice, 5)] += x.count;
  /* 行动牌网格：8 列 */
  const tw = 100, th = tw * 720 / 420;
  const perRow = Math.max(1, Math.floor((W - M * 2 + GAP) / (tw + GAP)));
  const rows = Math.max(1, Math.ceil(cards.length / perRow));
  const gridH = rows * (th + GAP) - GAP + 30;   /* +30 给「行动牌 N 张」小标题 */
  const headH = 84 + (opts.note ? 30 : 0);
  const footH = 96;
  const H = Math.round(M + headH + charRowH + 14 + curveH + 16 + gridH + footH);
  const centerRow = (n: number, cw: number) => M + (W - M * 2 - (n * cw + (n - 1) * GAP)) / 2;
  const charCells: ShareCell[] = cur.chars.slice(0, 3).map((c, i) => ({
    id: c.id, count: 1, w: charW, h: charH,
    x: Math.round(centerRow(Math.min(cur.chars.length, 3), charW) + i * (charW + GAP)),
    y: M + headH,
  }));
  const gridTop = M + headH + charRowH + 14 + curveH + 16;
  const cardCells: ShareCell[] = cards.map((x, i) => {
    const r = Math.floor(i / perRow), col = i % perRow;
    const rowN = Math.min(perRow, cards.length - r * perRow);
    return { id: x.id, count: x.count, w: tw, h: th, x: Math.round(centerRow(rowN, tw) + col * (tw + GAP)), y: Math.round(gridTop + 30 + r * (th + GAP)) };
  });
  return {
    width: W, height: H,
    title: "七圣召唤 · 牌组分享",
    name: opts.name || null,
    note: opts.note || null,
    code: cur.code,
    curve: buckets,
    charCells, cardCells,
  };
}

/* ---------- 绘制（薄层）：布局说了算，这里只做画笔操作 ---------- */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
/* 无图卡壳：类型底色 + ◈，与界面 noart 同语义的极简版 */
function drawShell(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = C.shell;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.stroke();
  ctx.fillStyle = C.dim;
  ctx.font = `${Math.round(w * 0.3)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("◈", x + w / 2, y + h / 2);
}
function drawCellImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, c: ShareCell) {
  if (!img) return drawShell(ctx, c.x, c.y, c.w, c.h);
  ctx.save();
  roundRect(ctx, c.x, c.y, c.w, c.h, 8);
  ctx.clip();
  ctx.drawImage(img, c.x, c.y, c.w, c.h);
  ctx.restore();
  ctx.strokeStyle = C.line;
  roundRect(ctx, c.x, c.y, c.w, c.h, 8);
  ctx.stroke();
}
function drawBadge(ctx: CanvasRenderingContext2D, c: ShareCell) {
  if (c.count <= 1) return;
  const t = `×${c.count}`;
  ctx.font = "bold 15px sans-serif";
  const w = ctx.measureText(t).width + 14;
  const x = c.x, y = c.y + c.h - 26;
  ctx.fillStyle = "rgba(10,12,16,.92)";
  roundRect(ctx, x + 5, y, w, 21, 9);
  ctx.fill();
  ctx.strokeStyle = C.gold;
  ctx.stroke();
  ctx.fillStyle = C.gold;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(t, x + 12, y + 11);
}
function drawCurve(ctx: CanvasRenderingContext2D, buckets: number[], x: number, y: number, w: number, h: number) {
  const max = Math.max(...buckets, 1);
  const bw = 34, gap = (w - 6 * bw) / 5;
  ctx.textBaseline = "alphabetic";
  for (let i = 0; i < 6; i++) {
    const bx = x + i * (bw + gap);
    const bh = Math.round(buckets[i] / max * (h - 34));
    ctx.fillStyle = "rgba(211,188,142,.22)";
    ctx.fillRect(bx, y + h - 18 - bh, bw, Math.max(bh, buckets[i] ? 3 : 0));
    ctx.fillStyle = C.dim;
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    if (buckets[i]) ctx.fillText(String(buckets[i]), bx + bw / 2, y + h - 24 - bh);
    ctx.fillText(i === 5 ? "5+" : String(i), bx + bw / 2, y + h);
  }
}
export async function renderShareCanvas(cur: ParsedDeck, opts: { name?: string | null; note?: string | null } = {}): Promise<HTMLCanvasElement> {
  const L = shareImageLayout(cur, opts);
  const SCALE = 2;
  const canvas = document.createElement("canvas");
  canvas.width = L.width * SCALE;
  canvas.height = L.height * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  /* 背景 */
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, L.width, L.height);
  /* 头部：标题 + 牌组名 + 备注 */
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = C.gold;
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(L.title, 48, 46);
  ctx.fillStyle = C.text;
  ctx.font = "16px sans-serif";
  ctx.fillText(cur.chars.map(c => c.name).join(" / "), 48, 70);
  if (L.name) {
    ctx.textAlign = "right";
    ctx.fillStyle = C.text;
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(L.name, L.width - 48, 46);
  }
  if (L.note) {
    ctx.fillStyle = C.dim;
    ctx.font = "13px sans-serif";
    ctx.textAlign = "right";
    const lines = L.note.length > 46 ? L.note.slice(0, 46) + "…" : L.note;
    ctx.fillText(lines, L.width - 48, 70);
  }
  /* 角色与行动牌 */
  const charImgs = await loadImages(L.charCells.map(c => imgFull(c.id)));
  L.charCells.forEach((c, i) => drawCellImage(ctx, charImgs[i], c));
  /* 费用曲线 */
  const curveTop = L.charCells[0] ? L.charCells[0].y + L.charCells[0].h + 14 : 0;
  ctx.fillStyle = C.dim;
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("元素骰费用分布", 48, curveTop + 14);
  drawCurve(ctx, L.curve, 180, curveTop, L.width - 228, 82);
  const cardImgs = await loadImages(L.cardCells.map(c => imgFull(c.id)));
  ctx.fillStyle = C.dim;
  ctx.font = "12px sans-serif";
  ctx.fillText(`行动牌 ${L.cardCells.reduce((a, c) => a + c.count, 0)} 张（${L.cardCells.length} 种）`, 48, curveTop + 96 + 16);
  L.cardCells.forEach((c, i) => { drawCellImage(ctx, cardImgs[i], c); drawBadge(ctx, c); });
  /* 页脚：分享码 + 水印 */
  const fy = L.height - 60;
  ctx.fillStyle = C.line;
  ctx.fillRect(48, fy - 26, L.width - 96, 1);
  ctx.fillStyle = C.dim;
  ctx.font = "12px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`分享码 ${L.code}`, 48, fy);
  ctx.textAlign = "right";
  ctx.fillText("七圣召唤 · 卡牌与牌组浏览器", L.width - 48, fy);
  return canvas;
}
