/* 98-textimport.ts —— 文本牌表回流导入。
   场景：IM 里收到别人用本工具导出的「文本牌表」，粘回来重建成牌组。
   两层拆分：parseTextDeck / textImportChecks / loadTextDeck 是纯逻辑层
   （逐行解析 → 名称精确/归一匹配 → 检查清单 → 载入为新牌组），
   弹层（overlay kind "textimport"，不写历史，与 deckdiff/qr 同类）是薄交互层：
   粘贴 → 确认弹页（逐行解析结果 / 同名候选消歧 / 检查清单）→ 载入。
   载入永远创建新牌组，不覆盖现有牌组；超上限与秘传超限按检查页说明截断。
   文本里若带【分享码】行，确认页给一键「用分享码直接解析」——那是逐字节可靠的路。 */
import { $, esc, toast } from "./core/dom";
import { ICON_X } from "./core/resources";
import { state } from "./data/state";
import { recordOfId } from "./data/records";
import { pool } from "./45-pool";
import { copyLimit, newDeck, saveDraft, draft, activeDeck } from "./80-deck";
import { deckReqMet, reqGapText } from "./30-deps";
import { normCompact } from "./70-search";
import { renderOverlay, setOverlayOpen } from "./90-detail";
import { overlayHashClear } from "./core/history";
import { decodeAndRender } from "./60-parse";
import type { PoolEntry } from "./types";

export interface TILine { raw: string; name: string; count: number; resolved: number | null; candidates: number[] }
export interface TIResult { chars: TILine[]; cards: TILine[]; note: string | null; code: string | null }
export interface TICheck { level: "err" | "warn"; text: string }

/* ---------- 名称索引（精确名 + 归一名，按种类分桶） ----------
   归一 = NFKC + 去符号（normCompact），容忍全角/空白/标点的抄写差异。
   同名多版本（历史变体 / 对局实体）都在候选里，但优先可构筑版本（share != null）。 */
const exactIndex = new Map<string, PoolEntry[]>();
const normIndex = new Map<string, PoolEntry[]>();
let indexBuilt = false;
function buildIndex(): void {
  if (indexBuilt) return;
  for (const x of pool) {
    const ek = x.kind + "|" + x.name;
    const el = exactIndex.get(ek);
    if (el) el.push(x); else exactIndex.set(ek, [x]);
    const nk = x.kind + "|" + normCompact(x.name);
    const nl = normIndex.get(nk);
    if (nl) nl.push(x); else normIndex.set(nk, [x]);
  }
  indexBuilt = true;
}
/** 测试 / 数据重载后复位索引。 */
export function resetTextImportIndex(): void {
  exactIndex.clear(); normIndex.clear(); indexBuilt = false;
}
function resolveLine(l: TILine, kind: "char" | "card"): void {
  buildIndex();
  const list = exactIndex.get(kind + "|" + l.name) || normIndex.get(kind + "|" + normCompact(l.name)) || [];
  l.candidates = list.map(x => x.id);
  const build = list.filter(x => x.share != null);
  const pick = build.length ? build : list;
  l.resolved = pick.length ? pick[0].id : null;
}

/* ---------- 解析（纯函数） ---------- */
/* 逐行剥修饰：〔依赖〕任意位置、尾缀（关联·天赋）、充能×N；数量前缀 2× / ×2 / 2x；
   有序列表残留（1. / 1、）一并容忍。剥完为空则整行忽略。 */
function parseCardLine(line: string, kind: "char" | "card"): TILine | null {
  let s = line.trim();
  s = s.replace(/〔[^〕]*〕/g, " ").replace(/（[^）]*）\s*$/g, " ").replace(/充能\s*×?\s*\d+/g, " ");
  let count = 1;
  const m = s.match(/^(?:([0-9０-９]+)\s*[×xX*]\s*|[×xX*]\s*([0-9０-９]+)\s+)(.+)$/);
  if (m) { count = Number(m[1] || m[2]); s = m[3]; }
  s = s.replace(/^\d+[.、]\s*/, "").trim();
  if (!s) return null;
  return {
    raw: line, name: s,
    count: Number.isFinite(count) && count > 0 ? count : 1,
    resolved: null, candidates: [],
  };
}
export function parseTextDeck(text: string): TIResult {
  const res: TIResult = { chars: [], cards: [], note: null, code: null };
  let section: "char" | "card" | null = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.includes("七圣召唤 · 卡牌与牌组浏览器")) continue;   /* 页脚水印行 */
    const h = line.match(/^【(.+?)】\s*(.*)$/);
    if (h) {
      const tag = h[1], rest = h[2].trim();
      if (tag === "角色") {
        section = "char";
        /* 本工具的格式是「【角色】A / B / C」同行斜杠分隔；也有人一行一名，都认 */
        for (const part of rest.split(/\s*\/\s*/)) {
          const t = part.trim() ? parseCardLine(part, "char") : null;
          if (t) res.chars.push(t);
        }
        continue;
      }
      if (tag === "备注") { res.note = rest || null; continue; }
      if (tag === "分享码") { res.code = rest || null; continue; }
      section = "card";   /* 装备牌 / 支援牌 / 事件牌 等分组都当行动牌段落 */
      continue;
    }
    if (!section) section = "card";   /* 无分组的纯列表：全部当行动牌 */
    const t = parseCardLine(line, section);
    if (t) (section === "char" ? res.chars : res.cards).push(t);
  }
  for (const l of res.chars) resolveLine(l, "char");
  for (const l of res.cards) resolveLine(l, "card");
  return res;
}

/* ---------- 检查清单（确认弹页的核心） ---------- */
export function textImportChecks(res: TIResult): TICheck[] {
  const out: TICheck[] = [];
  const chars = res.chars.map(l => l.resolved).filter((x): x is number => x != null);
  const unresolvedChars = res.chars.filter(l => l.resolved == null).length;
  if (unresolvedChars) out.push({ level: "err", text: `${unresolvedChars} 行角色名未识别——修正后再载入` });
  if (chars.length !== 3) out.push({ level: "err", text: `角色需要 3 名（当前识别 ${chars.length}）` });
  const total = res.cards.reduce((a, l) => a + l.count, 0);
  if (total !== 30) out.push({ level: "warn", text: `行动牌共 ${total} 张（构筑需要恰好 30 张；可以先载入再补齐）` });
  const unknown = res.cards.filter(l => l.resolved == null);
  if (unknown.length) out.push({ level: "warn", text: `${unknown.length} 行卡名未识别（载入时忽略）：${unknown.slice(0, 3).map(l => "「" + l.name + "」").join("、")}${unknown.length > 3 ? " 等" : ""}` });
  const byId = new Map<number, number>();
  for (const l of res.cards) if (l.resolved != null) byId.set(l.resolved, (byId.get(l.resolved) || 0) + l.count);
  const overs = [...byId].filter(([id, c]) => c > copyLimit(id));
  if (overs.length) out.push({ level: "warn", text: `${overs.length} 种卡超过同名上限（${overs.map(([id]) => recordOfId(id)?.name || "#" + id).join("、")}）——载入时截断到上限` });
  const legendN = [...byId].filter(([id]) => copyLimit(id) === 1).reduce((a, [, c]) => a + c, 0);
  if (legendN > 1) out.push({ level: "warn", text: `秘传牌共 ${legendN} 张（整套限 1 张）——载入时只保留 1 张` });
  /* 构筑依赖预检（与 deckProblems 同口径的轻量版）：角色齐 3 名才检查得出结论 */
  if (chars.length === 3) {
    const gaps = new Map<string, { text: string; names: string[] }>();
    for (const [id] of byId) {
      const e = recordOfId(id);
      if (!e) continue;
      for (const r of e.reqs.deck) {
        if (deckReqMet(r, chars)) continue;
        const k = r.code + "|" + (r.tag || r.name || "");
        let g = gaps.get(k);
        if (!g) { g = { text: reqGapText(r, chars), names: [] }; gaps.set(k, g); }
        if (!g.names.includes(e.name)) g.names.push(e.name);
      }
    }
    for (const g of gaps.values())
      out.push({ level: "warn", text: `${g.text}——${g.names.join("、")}（载入后可在管理面板的校验条定位）` });
  }
  return out;
}

/* ---------- 载入（纯逻辑）：创建新牌组，不覆盖现有 ---------- */
export interface TILoadStat { id: number; kinds: number; total: number }
export function loadTextDeck(res: TIResult): TILoadStat {
  const d = newDeck("导入牌组");
  draft.chars = res.chars.map(l => l.resolved).filter((x): x is number => x != null).slice(0, 3);
  draft.cards = new Map();
  for (const l of res.cards) {
    if (l.resolved == null) continue;
    draft.cards.set(l.resolved, (draft.cards.get(l.resolved) || 0) + l.count);
  }
  for (const [id, c] of [...draft.cards]) draft.cards.set(id, Math.min(c, copyLimit(id)));
  let legendSeen = false;
  for (const [id] of [...draft.cards]) {
    if (copyLimit(id) !== 1) continue;
    if (legendSeen) draft.cards.delete(id);
    else { draft.cards.set(id, 1); legendSeen = true; }
  }
  if (res.note) {
    const a = activeDeck();
    if (a) a.note = res.note;
  }
  saveDraft();
  return { id: d.id, kinds: draft.cards.size, total: [...draft.cards.values()].reduce((a, c) => a + c, 0) };
}

/* ---------- 弹层（薄交互层） ---------- */
let tiStep: "input" | "review" = "input";
let tiParsed: TIResult | null = null;

export function showTextImport(): void {
  tiStep = "input"; tiParsed = null;
  overlayHashClear();   /* 整屏弹层不写历史：与 deckdiff/qr 同类 */
  state.overlayStack = [{ kind: "textimport", scrollTop: 0, cmpLeft: 0 }];
  renderOverlay();
}

function tiInputHtml(): string {
  return `<h2>导入文本牌表</h2>
    <textarea id="tiText" class="ti-text" rows="12" spellcheck="false" placeholder="粘贴文本牌表（本工具「导出 → 文本牌表 · 复制」的格式）：&#10;【角色】甘雨 / 迪奥娜 / 凯亚&#10;【备注】起手找解牌&#10;【事件牌】&#10;2× 某某事件牌&#10;…&#10;【分享码】…"></textarea>
    <p class="ti-hint">逐行识别「数量× 名称」；角色行 / 备注行 / 分享码行都认，〔依赖〕（关联）充能×N 等修饰会剥掉。名称按精确 → 归一（忽略全半角、符号、空白）匹配卡库，同名多版本优先取可构筑版本，歧义行在下一页点选。载入会创建<b>新牌组</b>，不影响现有牌组。</p>
    <div class="ti-acts"><button class="primary" data-ti="parse">解析预览</button></div>`;
}
function tiReviewHtml(): string {
  const res = tiParsed!;
  const checks = textImportChecks(res);
  const errs = checks.filter(c => c.level === "err");
  const row = (l: TILine, i: number, isChar: boolean) => {
    const rec = l.resolved != null ? recordOfId(l.resolved) : null;
    const name = rec ? esc(rec.name) : `<b class="ti-miss">未识别</b>`;
    const alt = rec && rec.name !== l.name ? `<small class="ti-alt">（原文：${esc(l.name)}）</small>` : "";
    const rawMiss = rec ? "" : `<span class="ti-raw">${esc(l.raw.trim())}</span>`;
    const cand = l.candidates.length > 1
      ? `<span class="ti-cands">候选：${l.candidates.map(id => {
          const c = recordOfId(id);
          const on = id === l.resolved;
          return `<button class="fchip${on ? " on" : ""}" data-ti="pick" data-kind="${isChar ? "char" : "card"}" data-line="${i}" data-id="${id}" title="${esc((c?.name || "") + (c?.version ? " · " + c.version : ""))}">${esc(c?.name || "#" + id)}${c?.version ? `<small> ${esc(c.version)}</small>` : ""}</button>`;
        }).join("")}</span>`
      : "";
    return `<div class="ti-row">${l.count > 1 ? `<b class="ti-n">×${l.count}</b>` : ""}${name}${alt}${rawMiss}${cand}</div>`;
  };
  return `<h2>确认导入</h2>
    ${res.code ? `<div class="ti-code"><span>文本里带了分享码——逐字节最可靠：</span><button data-ti="code">用分享码直接解析</button></div>` : ""}
    <div class="ti-sec">角色（${res.chars.length} 行）</div>
    ${res.chars.map((l, i) => row(l, i, true)).join("") || `<div class="ti-row"><span class="ti-miss">（无角色行）</span></div>`}
    <div class="ti-sec">行动牌 ${res.cards.reduce((a, l) => a + l.count, 0)} 张 / ${res.cards.length} 种</div>
    ${res.cards.map((l, i) => row(l, i, false)).join("") || `<div class="ti-row"><span class="ti-miss">（无行动牌行）</span></div>`}
    ${res.note ? `<div class="ti-sec">备注</div><div class="ti-row">${esc(res.note)}</div>` : ""}
    <div class="ti-sec">检查</div>
    <div class="ti-checks${errs.length ? " err" : ""}">${checks.length
      ? checks.map(c => `<div class="ti-check ${c.level}">${c.level === "err" ? "✕" : "⚠"} ${esc(c.text)}</div>`).join("")
      : `<div class="ti-check ok">✓ 全部通过</div>`}</div>
    <div class="ti-acts">
      <button data-ti="back">返回修改</button>
      <button class="primary" data-ti="load"${errs.length || !res.cards.length ? " disabled" : ""}>载入为新牌组</button>
    </div>`;
}
export function renderTextImportView(): void {
  $("detail").innerHTML = `<div class="navbtns"><button title="关闭 (Esc)" data-act="close">${ICON_X}</button></div>
    <div class="dinfo ti-view">${tiStep === "input" ? tiInputHtml() : tiReviewHtml()}</div>`;
  setOverlayOpen(true);
}

/* 弹层内按钮委托（data-ti）；关闭走 90-detail 通用的 data-act="close" */
document.addEventListener("click", ev => {
  const b = (ev.target as HTMLElement).closest("[data-ti]") as HTMLElement | null;
  if (!b) return;
  const act = b.dataset.ti;
  if (act === "parse") {
    const txt = ($("tiText") as HTMLTextAreaElement | null)?.value || "";
    if (!txt.trim()) { toast("先粘贴文本牌表", true); return; }
    tiParsed = parseTextDeck(txt);
    tiStep = "review";
    renderOverlay();
  } else if (act === "back") {
    tiStep = "input";
    renderOverlay();
  } else if (act === "code") {
    const code = tiParsed?.code || "";
    state.overlayStack = []; setOverlayOpen(false);
    void decodeAndRender(code);
  } else if (act === "load") {
    if (!tiParsed) return;
    const stat = loadTextDeck(tiParsed);
    state.overlayStack = []; setOverlayOpen(false);
    toast(`已载入为新牌组：${stat.kinds} 种 ${stat.total} 张（牌组工具 → 管理面板可查看）`);
  } else if (act === "pick") {
    if (!tiParsed) return;
    const list = b.dataset.kind === "char" ? tiParsed.chars : tiParsed.cards;
    const line = list[Number(b.dataset.line)];
    const id = Number(b.dataset.id);
    if (line && Number.isFinite(id) && line.candidates.includes(id)) {
      line.resolved = id;
      renderOverlay();
    }
  }
});
