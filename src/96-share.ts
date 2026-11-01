/* 96-share.ts —— 牌组分享图（PNG 导出）。
   两层拆分：shareImageLayout 是纯函数（可单测：网格数学 / 边界 / 不重叠），
   renderShareCanvas 是薄 canvas 层（loadImages 等全部卡面 → 逐 cell 绘制 →
   toBlob 由调用方接管）。单图 404 / 断网时画「卡壳」占位，不拖垮整次导出。
   配色与深色主题同源（独立成图不依赖 CSS 变量），固定写死在这里。
   构图：左对齐单栏——页头（标题 + 牌名/备注同行右置）→ 分隔线 →
   角色行（左）与费用分布（右）同一横带 → 行动牌网格 → 页脚（分享码 + 水印）。

   单卡分享图（cardShareLayout / renderCardShareCanvas）：「这张牌什么效果？」
   的 IM 直接载体——卡面 + 费用/属性 + 依赖徽标 + 效果全文（角色按技能分节）
   + #card= 深链。高度取决于文本量，因此测量函数作为参数注入布局纯函数
   （生产传 ctx.measureText，测试传伪等宽），换行在布局层算好、绘制层只画。 */
import { imgFull } from "./core/resources";
import { loadImages } from "./core/image";
import { keyIdOf, recordOfId } from "./data/records";
import { backlinks } from "./50-backlinks";
import { costText } from "./30-deps";
import { skillsOf } from "./47-skills";
import qrcode from "../vendor/qrcode/qrcode.js";
import type { GcgRecord, ParsedDeck } from "./types";

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
/* ---------- 对局实体卡壳：与详情 .noart-detail 同一套视觉 ----------
   渐变底（158deg）+ 顶部光晕 + 45° 斜纹 + 虚线内框 + 顶部色条与类型字 +
   圆盘图标（imgFull(id) 对无牌面实体返回的就是图标图）。四类配色与
   .noart[data-kind] 的 CSS 变量同源；kind 缺省（历史变体等）走中性灰。 */
const NOART_PALETTE: Record<string, { c: string; cl: string; cg: string; b: string; b2: string }> = {
  state:  { c: "#9c8cf0", cl: "rgba(156,140,240,.4)", cg: "rgba(156,140,240,.2)",  b: "#272141", b2: "#151225" },
  summon: { c: "#e0b26a", cl: "rgba(224,178,106,.4)", cg: "rgba(224,178,106,.19)", b: "#322819", b2: "#1c1710" },
  team:   { c: "#7bb0ea", cl: "rgba(123,176,234,.4)", cg: "rgba(123,176,234,.19)", b: "#1c2b40", b2: "#111a25" },
  attach: { c: "#63cdb5", cl: "rgba(99,205,181,.4)",  cg: "rgba(99,205,181,.19)",  b: "#17302c", b2: "#101e1c" },
};
const NOART_DEFAULT = { c: C.dim, cl: "rgba(139,149,165,.4)", cg: "rgba(139,149,165,.2)", b: "#1a2029", b2: "#141920" };
function drawNoArtShell(ctx: CanvasRenderingContext2D, box: ShareBox, rec: GcgRecord, icon: HTMLImageElement | null): void {
  const k = NOART_PALETTE[rec.art.kind] || NOART_DEFAULT;
  const { x, y, w, h } = box;
  ctx.save();
  roundRect(ctx, x, y, w, h, 12);
  ctx.clip();
  /* 底色渐变 + 光晕（radial 115% 55% at 50% 42%）+ 45° 斜纹 */
  const bg = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
  bg.addColorStop(0, k.b);
  bg.addColorStop(1, k.b2);
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.translate(x + w / 2, y + h * 0.42);
  ctx.scale(w * 1.15, h * 0.55);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  glow.addColorStop(0, k.cg);
  glow.addColorStop(0.72, "rgba(0,0,0,0)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "rgba(255,255,255,.025)";
  const diag = Math.sqrt(w * w + h * h);
  for (let off = -diag / 2; off < diag / 2; off += 18) ctx.fillRect(off, -diag / 2, 9, diag);
  ctx.restore();
  /* 虚线内框（模具感）+ 顶部色条 + 类型字 + ◈（无图标时） */
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = k.cl;
  ctx.lineWidth = 1;
  roundRect(ctx, x + 8, y + 8, w - 16, h - 16, 8);
  ctx.stroke();
  ctx.setLineDash([]);
  const rib = ctx.createLinearGradient(x, y, x + w, y);
  rib.addColorStop(0.06, "rgba(0,0,0,0)");
  rib.addColorStop(0.18, k.c);
  rib.addColorStop(0.82, k.c);
  rib.addColorStop(0.94, "rgba(0,0,0,0)");
  ctx.fillStyle = rib;
  ctx.fillRect(x, y, w, 4);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const lc = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  try { lc.letterSpacing = "2px"; } catch (e) { /* 旧引擎无此属性 */ }
  ctx.fillStyle = k.c;
  ctx.font = "12px sans-serif";
  ctx.fillText(rec.typeZh, x + w / 2, y + h * 0.065 + 12);
  try { lc.letterSpacing = "0px"; } catch (e) { /* 同上 */ }
  if (!icon) {
    ctx.globalAlpha = 0.38;
    ctx.font = "26px sans-serif";
    ctx.fillText("◈", x + w / 2, y + h * 0.3 + 22);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  /* 圆盘图标：64% 宽 @ 中心，图标 contain 82%（CSS .noart-detail 同参数） */
  if (icon) {
    const side = w * 0.64 * 0.82;
    const s = Math.min(side / icon.naturalWidth, side / icon.naturalHeight);
    const dw = icon.naturalWidth * s, dh = icon.naturalHeight * s;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.6)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.drawImage(icon, x + w / 2 - dw / 2, y + h / 2 - dh / 2, dw, dh);
    ctx.restore();
  }
  roundRect(ctx, x, y, w, h, 12);
  ctx.strokeStyle = "rgba(211,188,142,.45)";
  ctx.lineWidth = 1;
  ctx.stroke();
}
function drawCellImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, c: ShareCell) {
  if (!img) return drawShell(ctx, c.x, c.y, c.w, c.h);
  ctx.save();
  roundRect(ctx, c.x, c.y, c.w, c.h, 8);
  ctx.clip();
  /* object-fit: cover（与卡库瓦片同语义）：按较大的缩放比取源图中心区域，
     任何比例的源图都不会被拉伸——曾经 1:1 牌面被直拉进 420:720 框就是这么来的 */
  const cover = Math.max(c.w / img.naturalWidth, c.h / img.naturalHeight);
  const sw = c.w / cover, sh = c.h / cover;
  ctx.drawImage(
    img,
    (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh,
    c.x, c.y, c.w, c.h,
  );
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

/* ---------- 单卡分享图 ----------
   「这张牌什么效果？」的 IM 直接载体。排版 v2：整幅就是「卡面（左）+ 右栏」
   两栏，右栏分节顺序与详情弹层一致（meta → 英文名 → 实体说明 → 限制 →
   正文/特技 → 被引用），右栏内容短时深链二维码对齐卡面底边补位。
   高度取决于文本量：测量函数作为参数注入布局纯函数（生产 ctx.measureText，
   测试伪等宽），换行在布局层算好、绘制层只画。 */
export type Measure = (text: string, font: string) => number;

/** 逐字换行（CJK 主导；拉丁词被截断可接受）。空段保留为空行。 */
export function wrapText(text: string, font: string, maxWidth: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of String(text || "").split("\n")) {
    if (!para) { out.push(""); continue; }
    let cur = "";
    for (const ch of para) {
      if (cur && measure(cur + ch, font) > maxWidth) { out.push(cur); cur = ch; }
      else cur += ch;
    }
    if (cur) out.push(cur);
  }
  return out;
}
export interface CardSideBlock { label: string; lines: string[]; y: number; dim?: boolean; hint?: string }
export interface CardEffectBlock { head: string | null; lines: string[]; y: number; dim?: boolean }
/** 卡面框高度随图片天然比例（与详情 .dimg 的 height:auto 同语义——应用里所有
    「看牌」场景都不拉伸）；无图 / 尺寸异常回落 420:720 卡壳比例（.noart 同语义）。 */
export function cardArtSize(img: { naturalWidth: number; naturalHeight: number } | null, w = 260): { w: number; h: number } {
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    return { w, h: Math.max(1, Math.round(w * img.naturalHeight / img.naturalWidth)) };
  }
  return { w, h: Math.round(w * 720 / 420) };
}
export interface CardShareLayout {
  width: number;
  height: number;
  name: string;
  meta: string;                       /* typeZh · version */
  art: ShareBox;
  sideX: number;
  sideBlocks: CardSideBlock[];        /* 右栏信息块（英文卡名 = dim 无标签块） */
  effectBlocks: CardEffectBlock[];    /* 右栏续：正文与技能/特技分节、story（角色）、被引用 */
  qr: ShareBox | null;                /* 卡面深链二维码（右栏底部补位） */
  link: string | null;
  headLineY: number;
  footLineY: number;
}
export function cardShareLayout(
  rec: GcgRecord,
  opts: { measure: Measure; link?: string | null; artH?: number },
): CardShareLayout {
  const measure = opts.measure;
  const W = 720, M = 36, GAP = 20;
  const F = { body: "14px sans-serif", small: "13px sans-serif" };
  const headLineY = 64;
  /* 卡面宽固定 260（右栏位置不随图变），高随图片天然比例（详情 .dimg height:auto
     同语义，opts.artH 由绘制层传图片实测尺寸）；无图回落 420:720 卡壳比例 */
  const artW = 260, artH = opts.artH ?? Math.round(artW * 720 / 420);
  const art: ShareBox = { x: M, y: 82, w: artW, h: artH };
  const sideX = M + artW + GAP;
  const sideW = W - M - sideX;
  /* 右栏统一流，分节顺序与详情一致：费用/属性（meta）→ 英文名 → 实体说明 →
     限制（分组带提示）→ 正文/技能（角色 story 在技能前；卡牌 effect → 特技）→ 被引用 */
  let sy = art.y + 2;
  const sideBlocks: CardSideBlock[] = [];
  const pushSide = (label: string, text: string, font: string, dim = false, hint?: string) => {
    const lines = wrapText(text, font, sideW, measure);
    if (!lines.length) return;
    sideBlocks.push({ label, lines, y: sy, dim, hint });
    sy += (label ? 36 : 20) + lines.length * (dim ? 18 : 22) + 6;
  };
  const costStr = costText(rec.stats.cost);
  if (costStr) pushSide("费用", costStr, F.body);
  if (rec.stats.hp != null) pushSide("属性", `生命 ${rec.stats.hp} · 充能 ${rec.stats.maxEnergy ?? 0}`, F.body);
  if (rec.englishName && rec.englishName !== rec.name) pushSide("", rec.englishName, F.small, true);
  /* 与详情一致：field 域实体给「对局实体」说明（详情 dnote 同文） */
  if (rec.domain === "field") pushSide("", "对局实体：由技能或卡牌效果在对局中生成，不可加入牌组。", F.small, true);
  if (rec.reqs.deck.length) pushSide("牌组限制", rec.reqs.deck.map(r => r.short || r.label).join(" / "), F.body, false, "加入牌组需满足");
  if (rec.reqs.play.length) pushSide("打出限制", rec.reqs.play.map(r => r.short || r.label).join(" / "), F.body, false, "对局中生效");
  const effectBlocks: CardEffectBlock[] = [];
  sy += 4;
  const pushSkillSeks = () => {
    for (const sk of skillsOf(keyIdOf(rec.key))) {
      const head = sk.name + (costText(sk.cost) ? `　${costText(sk.cost)}` : "");
      const lines = wrapText(sk.effect || "", F.body, sideW, measure);
      effectBlocks.push({ head, lines, y: sy });
      sy += (head ? 36 : 22) + lines.length * 22 + 8;
    }
  };
  if (rec.kind === "char") {
    /* 详情：角色的 story（语音）位于技能分节之前 */
    if (rec.desc.story.trim()) {
      const lines = wrapText(`「${rec.desc.story.trim()}」`, F.small, sideW, measure);
      effectBlocks.push({ head: null, lines, y: sy, dim: true });
      sy += 20 + lines.length * 20 + 4;
    }
    pushSkillSeks();
  } else {
    /* 详情卡牌分支：效果 → 特技（装备牌；事件/支援无分节） */
    if (rec.desc.effect.trim()) {
      const lines = wrapText(rec.desc.effect, F.body, sideW, measure);
      effectBlocks.push({ head: null, lines, y: sy });
      sy += 22 + lines.length * 22 + 8;
    }
    pushSkillSeks();
    /* flavor 台词：详情卡牌分支不展示，导出按用户要求保留作风味收尾 */
    if (rec.desc.story.trim()) {
      const lines = wrapText(`「${rec.desc.story.trim()}」`, F.small, sideW, measure);
      effectBlocks.push({ head: null, lines, y: sy, dim: true });
      sy += 20 + lines.length * 20 + 4;
    }
  }
  /* 被引用（反链）：详情里排在正文最后，这里同位收尾 */
  const blNames = [...new Set(
    [...(backlinks.get(rec.name) || [])]
      .filter(id => id !== keyIdOf(rec.key))
      .map(id => recordOfId(id)?.name)
      .filter((n): n is string => !!n),
  )];
  if (blNames.length) {
    const lines = wrapText(blNames.join(" / "), F.body, sideW, measure);
    effectBlocks.push({ head: "被引用", lines, y: sy });
    sy += 36 + lines.length * 22 + 8;
  }
  /* 深链二维码：右栏短时对齐卡面底边（设计感），长则顺排 */
  let qr: ShareBox | null = null;
  if (opts.link) {
    const size = 120;
    const pinned = art.y + artH - size - 8;
    const qy = sy + 10 > pinned ? sy + 10 : pinned;
    qr = { x: sideX, y: qy, w: size, h: size };
    sy = qy + size + 22;
  }
  const bottom = Math.max(art.y + artH, sy);
  const footLineY = Math.round(bottom + 24);
  const H = Math.round(footLineY + 44);
  return {
    width: W, height: H,
    name: rec.name,
    meta: `${rec.typeZh} · ${rec.version}`,
    art, sideX, sideBlocks, effectBlocks, qr,
    link: opts.link || null,
    headLineY, footLineY,
  };
}

/* 深链二维码直接用 vendor 生成器画矩阵（不走 SVG 栅格化，确定性 + 无污染） */
function drawQr(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number): void {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), quiet = 2, cell = size / (n + quiet * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = "#12161d";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      ctx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell + 0.35, cell + 0.35);
    }
  }
}

/** 单卡分享图绘制（薄层）：测量用离屏 ctx，卡面失败画卡壳。 */
export async function renderCardShareCanvas(rec: GcgRecord, opts: { href?: string | null } = {}): Promise<HTMLCanvasElement> {
  const SCALE = 2;
  const probe = document.createElement("canvas").getContext("2d")!;
  const measure: Measure = (t, f) => { probe.font = f; return probe.measureText(t).width; };
  const id = keyIdOf(rec.key);
  const link = opts.href ? opts.href.split("#")[0] + "#card=" + id : null;
  /* 先取图再布局：有真牌面时框高随图片天然比例（详情同语义，杜绝拉伸）；
     无牌面实体 imgFull(id) 返回的是圆盘图标——框回落 420:720 卡壳比例 */
  const hasFace = rec.art.hasFace;
  const [img] = await loadImages([imgFull(id)]);
  const L = cardShareLayout(rec, { measure, link, artH: hasFace ? cardArtSize(img).h : undefined });
  const canvas = document.createElement("canvas");
  canvas.width = L.width * SCALE;
  canvas.height = L.height * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, L.width, L.height);
  ctx.textBaseline = "alphabetic";
  /* 页头：名称（金）+ 类型·版本（右，暗）+ 分隔线 */
  ctx.textAlign = "left";
  ctx.fillStyle = C.gold;
  ctx.font = "bold 24px sans-serif";
  ctx.fillText(L.name, 36, 44);
  ctx.textAlign = "right";
  ctx.fillStyle = C.dim;
  ctx.font = "12px sans-serif";
  ctx.fillText(L.meta, L.width - 36, 44);
  ctx.fillStyle = C.line;
  ctx.fillRect(36, L.headLineY, L.width - 72, 1);
  /* 卡面：与详情同一套呈现语义——有牌面 = .dimg（天然比例原样绘制，零裁切
     零拉伸 + 圆角 12 + gold-30 细边）；无牌面 = .noart-detail 卡壳（四类配色
     渐变底/虚线内框/顶部色条与类型字/圆盘图标，取图失败只剩 ◈） */
  if (!hasFace) {
    drawNoArtShell(ctx, L.art, rec, img);
  } else if (img) {
    ctx.save();
    roundRect(ctx, L.art.x, L.art.y, L.art.w, L.art.h, 12);
    ctx.clip();
    ctx.drawImage(img, L.art.x, L.art.y, L.art.w, L.art.h);
    ctx.restore();
    roundRect(ctx, L.art.x, L.art.y, L.art.w, L.art.h, 12);
    ctx.strokeStyle = "rgba(211,188,142,.45)";
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    drawShell(ctx, L.art.x, L.art.y, L.art.w, L.art.h);
  }
  /* 右栏：信息块 → 效果/技能分节 → story → 二维码 */
  ctx.textAlign = "left";
  for (const b of L.sideBlocks) {
    if (b.dim) {
      ctx.fillStyle = C.dim;
      ctx.font = "13px sans-serif";
      b.lines.forEach((ln, i) => ctx.fillText(ln, L.sideX, b.y + 16 + i * 18));
      continue;
    }
    ctx.fillStyle = C.gold;
    ctx.font = "bold 12px sans-serif";
    ctx.fillText(b.label, L.sideX, b.y + 14);
    if (b.hint) {
      const lw = ctx.measureText(b.label).width;
      ctx.fillStyle = C.dim;
      ctx.font = "11px sans-serif";
      ctx.fillText(b.hint, L.sideX + lw + 10, b.y + 14);
    }
    ctx.fillStyle = C.text;
    ctx.font = "14px sans-serif";
    b.lines.forEach((ln, i) => ctx.fillText(ln, L.sideX, b.y + 36 + i * 22));
  }
  for (const b of L.effectBlocks) {
    if (b.head) {
      ctx.fillStyle = C.gold;
      ctx.font = "bold 14px sans-serif";
      ctx.fillText(b.head, L.sideX, b.y + 14);
    }
    ctx.fillStyle = b.dim ? C.dim : C.text;
    ctx.font = (b.dim ? "13px" : "14px") + " sans-serif";
    const first = b.y + (b.head ? 36 : 22);
    b.lines.forEach((ln, i) => ctx.fillText(ln, L.sideX, first + i * (b.dim ? 20 : 22)));
  }
  if (L.qr) {
    drawQr(ctx, L.link!, L.qr.x, L.qr.y, L.qr.w);
    ctx.fillStyle = C.dim;
    ctx.font = "12px sans-serif";
    ctx.fillText("扫码打开这张卡", L.qr.x, L.qr.y + L.qr.h + 16);
  }
  /* 页脚：深链（左，解码显示 + 按宽省略——percent 编码又长又不可读）+ 水印（右） */
  ctx.fillStyle = C.line;
  ctx.fillRect(36, L.footLineY, L.width - 72, 1);
  ctx.fillStyle = C.dim;
  ctx.font = "12px sans-serif";
  const wm = "七圣召唤 · 卡牌与牌组浏览器";
  let linkText = L.link || rec.name;
  if (L.link) { try { linkText = decodeURIComponent(L.link); } catch (e) { /* 保留原样 */ } }
  const maxW = L.width - 72 - ctx.measureText(wm).width - 24;
  if (ctx.measureText(linkText).width > maxW) {
    while (linkText.length > 1 && ctx.measureText(linkText + "…").width > maxW) linkText = linkText.slice(0, -1);
    linkText += "…";
  }
  ctx.textAlign = "left";
  ctx.fillText(linkText, 36, L.footLineY + 26);
  ctx.textAlign = "right";
  ctx.fillText(wm, L.width - 36, L.footLineY + 26);
  return canvas;
}
