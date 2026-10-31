/* 96-share.ts —— 牌组分享图（PNG 导出）。
   两层拆分：shareImageLayout 是纯函数（可单测：网格数学 / 边界 / 不重叠），
   renderShareCanvas 是薄 canvas 层（loadImages 等全部卡面 → 逐 cell 绘制 →
   toBlob 由调用方接管）。单图 404 / 断网时画「卡壳」占位，不拖垮整次导出。
   配色与深色主题同源（独立成图不依赖 CSS 变量），固定写死在这里。
   构图：左对齐单栏——页头（标题 + 牌名/备注同行右置）→ 分隔线 →
   角色行（左）与费用分布（右）同一横带 → 行动牌网格 → 页脚（分享码 + 水印）。 */
import { imgFull } from "./core/resources";
import { loadImages } from "./core/image";
import type { ParsedDeck } from "./types";

/* ---------- 画布配色（独立成图，不读 CSS 变量） ---------- */
const C = {
  bg: "#12161d", line: "#2e3949", gold: "#d3bc8e",
  text: "#e8e2d0", dim: "#8b95a5", shell: "#1a2029",
};

export interface ShareCell { id: number; count: number; x: number; y: number; w: number; h: number; core?: boolean }
export interface ShareBox { x: number; y: number; w: number; h: number }
export interface ShareLayout {
  width: number;
  height: number;
  title: string;
  name: string | null;
  note: string | null;
  code: string;
  curve: number[];                      /* 费用桶 0~5+，按张数计重 */
  headLineY: number;                    /* 页头分隔线 */
  curveBox: ShareBox;                   /* 费用分布块（含块标签，与角色行同带） */
  gridLabelY: number;                   /* 「行动牌 N 张」基线 */
  footLineY: number;                    /* 页脚分隔线 */
  charCells: ShareCell[];
  cardCells: ShareCell[];
}

/* ---------- 布局（纯函数）：全部坐标在这里算好，canvas 层只管画 ---------- */
export function shareImageLayout(
  cur: ParsedDeck,
  opts: { name?: string | null; note?: string | null; core?: number[] } = {},
): ShareLayout {
  const W = 1080, M = 48, GAP = 16;
  const cards = cur.order.flatMap(t => cur.groups[t]);
  const chars = cur.chars.slice(0, 3);
  const coreSet = new Set(opts.core || []);
  const charH = 240, charW = charH * 420 / 720;         /* 竖版卡 420:720 */
  const headLineY = 88;
  const bandY = 104;
  const tw = 100, th = tw * 720 / 420;
  const perRow = Math.max(1, Math.floor((W - M * 2 + GAP) / (tw + GAP)));
  const rows = Math.max(1, Math.ceil(cards.length / perRow));
  const gridLabelY = bandY + charH + 28;
  const gridTop = bandY + charH + 42;
  const gridH = rows * (th + GAP) - GAP;
  const footLineY = gridTop + gridH + 30;
  const H = Math.round(footLineY + 52);
  const charsEnd = M + chars.length * charW + Math.max(0, chars.length - 1) * GAP;
  const curveBox: ShareBox = { x: charsEnd + 40, y: bandY, w: W - M - (charsEnd + 40), h: charH };
  const buckets = [0, 0, 0, 0, 0, 0];
  for (const x of cards) buckets[Math.min(x.dice, 5)] += x.count;
  const charCells: ShareCell[] = chars.map((c, i) => ({
    id: c.id, count: 1, w: charW, h: charH,
    x: Math.round(M + i * (charW + GAP)), y: bandY,
  }));
  const cardCells: ShareCell[] = cards.map((x, i) => {
    const r = Math.floor(i / perRow), col = i % perRow;
    return { id: x.id, count: x.count, w: tw, h: th, x: Math.round(M + col * (tw + GAP)), y: Math.round(gridTop + r * (th + GAP)), core: coreSet.has(x.id) || undefined };
  });
  return {
    width: W, height: H,
    title: "七圣召唤 · 牌组分享",
    name: opts.name || null,
    note: opts.note || null,
    code: cur.code,
    curve: buckets,
    headLineY, curveBox, gridLabelY, footLineY,
    charCells, cardCells,
  };
}

/* ---------- 绘制（薄层）：布局说了算，这里只做画笔操作 ----------
   每个文字绘制点都显式设 textAlign/textBaseline：帮助函数会改写画笔状态，
   泄漏会把后续文字甩出画布（「行动牌 N 张」被裁成「动牌…」就是这么来的）。 */
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
  /* 核心牌描金（B3 的分享图收尾）：边框加粗换金色，×n 徽标之外的第二层信息 */
  ctx.strokeStyle = c.core ? C.gold : C.line;
  ctx.lineWidth = c.core ? 2.5 : 1;
  roundRect(ctx, c.x, c.y, c.w, c.h, 8);
  ctx.stroke();
  ctx.lineWidth = 1;
}
function drawBadge(ctx: CanvasRenderingContext2D, c: ShareCell) {
  if (c.count <= 1) return;
  const t = `×${c.count}`;
  ctx.font = "bold 15px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(t).width + 14;
  const x = c.x, y = c.y + c.h - 26;
  ctx.fillStyle = "rgba(10,12,16,.92)";
  roundRect(ctx, x + 5, y, w, 21, 9);
  ctx.fill();
  ctx.strokeStyle = C.gold;
  ctx.stroke();
  ctx.fillStyle = C.gold;
  ctx.fillText(t, x + 12, y + 11);
}
/* 费用分布块：块标签 + 6 桶直方（贴满块宽）+ 桶下标号；空桶不画柱与计数 */
function drawCurve(ctx: CanvasRenderingContext2D, buckets: number[], box: ShareBox) {
  const max = Math.max(...buckets, 1);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.dim;
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("元素骰费用分布", box.x, box.y + 14);
  const barTop = box.y + 30, barBot = box.y + box.h - 22;
  const gap = 28, bw = (box.w - 5 * gap) / 6;
  ctx.textAlign = "center";
  for (let i = 0; i < 6; i++) {
    const cx = box.x + i * (bw + gap) + bw / 2;
    if (buckets[i]) {
      const bh = Math.max(3, Math.round(buckets[i] / max * (barBot - barTop)));
      ctx.fillStyle = "rgba(211,188,142,.22)";
      ctx.fillRect(cx - bw / 2, barBot - bh, bw, bh);
      ctx.fillStyle = C.dim;
      ctx.fillText(String(buckets[i]), cx, barBot - bh - 6);
    }
    ctx.fillStyle = C.dim;
    ctx.fillText(i === 5 ? "5+" : String(i), cx, box.y + box.h - 6);
  }
}
export async function renderShareCanvas(cur: ParsedDeck, opts: { name?: string | null; note?: string | null; core?: number[] } = {}): Promise<HTMLCanvasElement> {
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
  /* 页头：标题左 + 牌名右；角色行左 + 备注右 */
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = C.gold;
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(L.title, 48, 48);
  ctx.fillStyle = C.text;
  ctx.font = "16px sans-serif";
  ctx.fillText(cur.chars.map(c => c.name).join(" / "), 48, 72);
  if (L.name) {
    ctx.textAlign = "right";
    ctx.fillStyle = C.text;
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(L.name, L.width - 48, 48);
  }
  if (L.note) {
    ctx.textAlign = "right";
    ctx.fillStyle = C.dim;
    ctx.font = "13px sans-serif";
    ctx.fillText(L.note.length > 46 ? L.note.slice(0, 46) + "…" : L.note, L.width - 48, 72);
  }
  ctx.fillStyle = C.line;
  ctx.fillRect(48, L.headLineY, L.width - 96, 1);
  /* 角色行（左）与费用分布（右）同一横带 */
  const charImgs = await loadImages(L.charCells.map(c => imgFull(c.id)));
  L.charCells.forEach((c, i) => drawCellImage(ctx, charImgs[i], c));
  drawCurve(ctx, L.curve, L.curveBox);
  /* 行动牌网格 */
  const cardImgs = await loadImages(L.cardCells.map(c => imgFull(c.id)));
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.dim;
  ctx.font = "12px sans-serif";
  ctx.fillText(`行动牌 ${L.cardCells.reduce((a, c) => a + c.count, 0)} 张（${L.cardCells.length} 种）`, 48, L.gridLabelY);
  L.cardCells.forEach((c, i) => { drawCellImage(ctx, cardImgs[i], c); drawBadge(ctx, c); });
  /* 页脚：分享码 + 水印 */
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.line;
  ctx.fillRect(48, L.footLineY, L.width - 96, 1);
  ctx.fillStyle = C.dim;
  ctx.font = "12px monospace";
  ctx.fillText(`分享码 ${L.code}`, 48, L.footLineY + 26);
  ctx.textAlign = "right";
  ctx.font = "12px sans-serif";
  ctx.fillText("七圣召唤 · 卡牌与牌组浏览器", L.width - 48, L.footLineY + 26);
  return canvas;
}
