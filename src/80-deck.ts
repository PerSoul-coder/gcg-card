/* 80-deck.ts —— 牌组草稿：增删、份数上限、持久化与分享码生成。 */
import { costText, deckReqMet, reqGapText } from "./30-deps";
import { recordOfId, shareOfId, nameOfId, isCharId } from "./data/records";
import { $ } from "./core/dom";
import { decodeRaw, encodeRaw } from "./10-codec";
import { syncTileQty } from "./85-views";
import { pool } from "./45-pool";
import { state } from "./data/state";
import type { Deck, Draft } from "./types";
import { STORAGE_KEYS, imgFull, eleIcon, ICON_X, ICON_PLUS } from "./core/resources";
import { esc, toast } from "./core/dom";
import { registerLayer, setModalLayer } from "./core/layers";
import { TYPE_ZH } from "./data/model";

/* ---------- 牌组：多牌组存储 + 草稿门面 ----------
   decks: [{id, name, chars:[], cards:[[id,count]], updatedAt}]，持久化于 localStorage。
   draft 是"当前活动牌组"的内存门面——draftAdd / draftEncode 等旧接口全部保留，
   底层改为读写活动牌组，任何变更即同步落盘。旧版单草稿（gi-viewer-draft）首次启动自动迁移。 */
const draft: Draft = { chars: [], cards: new Map() };  /* chars: id[]；cards: id→count */
let decks: Deck[] = [];
let activeDeckId: number | null = null;
let deckRenameId: number | null = null;
let deckNoteId: number | null = null;
/* 存储结构单点消毒：loadDecks 的逐条体检与 newDeck/duplicateDeck 的构造都走这里，
   字段增补（note/core…）只改这一个函数。不合格的条目整条丢弃（对齐 favs/recent 口径）。 */
function normalizeDeck(raw: unknown): Deck | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Deck>;
  if (!Number.isFinite(r.id) || !Array.isArray(r.chars) || !Array.isArray(r.cards)) return null;
  const d: Deck = {
    v: 2,
    id: r.id as number,
    name: typeof r.name === "string" && r.name ? r.name : "牌组",
    chars: r.chars.map(Number).filter((n): n is number => Number.isFinite(n)),
    cards: r.cards
      .map(p => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : null))
      .filter((p): p is [number, number] => !!p && Number.isFinite(p[0]) && Number.isFinite(p[1])),
    updatedAt: Number.isFinite(r.updatedAt) ? r.updatedAt as number : Date.now(),
  };
  if (typeof r.note === "string" && r.note) d.note = r.note;
  if (Array.isArray(r.core)) d.core = r.core.map(Number).filter((n): n is number => Number.isFinite(n));
  return d;
}
function loadDecks() {
  decks = [];
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE_KEYS.decks) || "null");
    if (Array.isArray(d)) {
      for (const x of d as unknown[]) {
        const nd = normalizeDeck(x);
        if (nd) decks.push(nd);
      }
    }
  } catch (e) { decks = []; }
}
function saveDecks() { try { localStorage.setItem(STORAGE_KEYS.decks, JSON.stringify(decks)); } catch (e) {} }
function activeDeck() { return decks.find(d => d.id === activeDeckId) || null; }
let deckSeq = 0;
function newDeck(name?: string): Deck {
  /* id 带序号后缀：同一毫秒连建多个牌组也不会碰撞 */
  const d: Deck = { v: 2, id: Date.now() * 1000 + (deckSeq++ % 1000), name: name || `牌组 ${decks.length + 1}`, chars: [], cards: [], updatedAt: Date.now() };
  decks.unshift(d); activeDeckId = d.id; return d;
}

/* ---------- 牌组的增删改（原先散落在入口的点击处理里） ----------
   这些操作要读写 decks / activeDeckId / deckRenameId 三个模块内部状态，
   放在入口会迫使状态对外暴露；收回到这里，入口只负责分发意图。 */

/** 切换活动牌组，并把内容同步到 draft 门面。 */
export function selectDeck(id) {
  activeDeckId = id;
  syncFromActive();
}

/** 进入重命名态并聚焦输入框。 */
export function beginRenameDeck(id) {
  deckRenameId = id;
  renderDraftPanel();
  const inp = $("draftPanel").querySelector(".dk-rename") as HTMLInputElement | null;
  if (inp) { inp.focus(); inp.select(); }
}

/** 复制牌组：角色数组、卡牌计数、备注与核心牌都是深拷贝，改副本不影响原牌组。 */
export function duplicateDeck(id) {
  const src = decks.find(d => d.id === id);
  if (!src) return false;
  const d = newDeck(src.name + " 副本");
  d.chars = [...src.chars];
  d.cards = src.cards.map(([cardId, c]) => [cardId, c]);
  if (src.note) d.note = src.note;
  if (src.core) d.core = [...src.core];
  syncFromActive(); renderDraft(); renderDraftPanel();
  return true;
}

/** 删除牌组；删到空时自动补一个空牌组，避免界面失去活动牌组。 */
export function deleteDeckById(id) {
  decks = decks.filter(d => d.id !== id);
  if (!decks.length) newDeck();
  else if (activeDeckId === id) activeDeckId = decks[0].id;
  saveDecks(); syncFromActive(); renderDraft(); renderDraftPanel();
}
/* 活动牌组 → draft 门面 */
function syncFromActive() {
  const a = activeDeck();
  draft.chars = a ? [...a.chars] : [];
  draft.cards = new Map(a ? a.cards.map(([id, c]) => [Number(id), c]) : []);
}
/* draft 门面 → 活动牌组并持久化（替代旧 saveDraft 语义） */
function saveDraft() {
  const a = activeDeck();
  if (a) {
    a.chars = [...draft.chars];
    a.cards = [...draft.cards].map(([id, c]) => [id, c]);
    a.updatedAt = Date.now();
  }
  saveDecks();
}
/* 恢复：读 decks；没有则迁移旧版单草稿；仍没有则建一个空牌组 */
function loadDraft() {
  loadDecks();
  if (!decks.length) {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_KEYS.draft) || "null");
      if (d && Array.isArray(d.chars) && d.cards && typeof d.cards === "object") {
        const m = newDeck("我的牌组");
        m.chars = d.chars.filter(id => Number.isFinite(id));
        m.cards = Object.entries(d.cards as Record<string, number>)
          .map(([k, v]): [number, number] => [Number(k), Number(v)])
          .filter(([, v]) => Number.isFinite(v) && v > 0);
      }
    } catch (e) {}
  }
  if (!decks.length) newDeck();
  else if (!activeDeck()) activeDeckId = decks[0].id;
  syncFromActive();
}
/* 数据就绪后清理失效 id（数据版本更新导致旧卡不存在） */
function pruneDraft() {
  draft.chars = draft.chars.filter(id => isCharId(id));
  draft.cards = new Map([...draft.cards].filter(([id, v]) => !!recordOfId(id) && v > 0));
  saveDraft();
}
function draftTotal() { let n = 0; for (const v of draft.cards.values()) n += v; return n; }
/* 同名卡张数上限（唯一判定处）：秘传整套限 1 张，其余同名上限 2 张。
   之前 draftAdd / draftSetCount / deckProblems 各写了一遍同样的三元表达式，
   改一处漏两处时就会出现「管理面板能加到 2、详情只能加 1」这类不一致。 */
const COPY_LIMIT = 2, LEGEND_COPY_LIMIT = 1;
function copyLimit(idOrEnt) {
  const e = typeof idOrEnt === "object" ? idOrEnt : recordOfId(idOrEnt);
  return (e && (e.stats.tagsRaw || []).includes("GCG_TAG_LEGEND")) ? LEGEND_COPY_LIMIT : COPY_LIMIT;
}
function draftAdd(id) {
  let msg = "已加入当前牌组";
  if (isCharId(id)) {
    if (shareOfId(id) == null) { toast("该角色版本不可加入构筑", true); return; }
    if (draft.chars.includes(id)) { toast("该角色已在牌组中"); return; }
    if (draft.chars.length >= 3) { toast("角色槽已满（3 名）", true); return; }
    draft.chars.push(id);
    msg = `已加入角色「${recordOfId(id)?.name || id}」（${draft.chars.length}/3）`;
  } else if (!!recordOfId(id)) {
    if (shareOfId(id) == null) { toast("该版本不可加入构筑", true); return; }
    const e = recordOfId(id);
    if (!e) { toast("该卡牌不在卡池中", true); return; }
    /* 牌组构筑门槛：不满足「才能加入牌组」的条件时拒绝加入（与官方选卡一致），
       并说明缺什么——先提示而不是让用户生成分享码时才发现 */
    const bad = (e ? e.reqs.deck : []).find(r => !deckReqMet(r, draft.chars));
    if (bad) { toast(`「${e.name}」无法加入：${reqGapText(bad, draft.chars)}`, true); return; }
    const cur = draft.cards.get(id) || 0;
    const max = copyLimit(e);
    if (cur >= max) {
      toast(max === 1 ? `「${e.name}」是秘传牌，整套限 1 张` : `「${e.name}」同名卡最多 ${max} 张`, true);
      return;
    }
    if (draftTotal() >= 30) { toast("行动牌已满（30 张）", true); return; }
    const next = cur + 1;
    draft.cards.set(id, next);
    msg = `已加入「${e.name}」×${next}/${max}`;
  } else { toast("该卡牌不可加入牌组", true); return; }
  saveDraft(); renderDraft(); toast(msg);
}
function draftRemoveChar(id) { draft.chars = draft.chars.filter(x => x !== id); saveDraft(); renderDraft(); }
function draftRemoveCard(id) { draft.cards.delete(id); saveDraft(); renderDraft(); }
function draftSetCount(id, d) {
  const cur = draft.cards.get(id) || 0, next = cur + d;
  const e = recordOfId(id);
  const max = copyLimit(e);
  if (next <= 0) draftRemoveCard(id);
  else if (next > max) return;
  else if (d > 0 && draftTotal() >= 30) { toast("行动牌已满（30 张）", true); return; }
  else {
    /* 加量同样过构筑门槛：中途换掉角色后，旧卡不应继续加量 */
    const bad = e ? (e ? e.reqs.deck : []).find(r => !deckReqMet(r, draft.chars)) : null;
    if (bad) { toast(`「${e?.name || id}」无法加入：${reqGapText(bad, draft.chars)}`, true); return; }
    draft.cards.set(id, next), saveDraft(), renderDraft();
  }
}
function draftClear() { draft.chars = []; draft.cards.clear(); saveDraft(); renderDraft(); toast("当前牌组已清空"); }
function draftLoadCurrent() {
  if (!state.current) { toast("请先解析一个牌组", true); return; }
  draft.chars = [...state.current!.charIds];
  draft.cards = new Map(state.current!.order.flatMap(t => state.current!.groups[t].map(x => [x.id, x.count])));
  saveDraft(); renderDraft(); renderDraftPanel(); toast("已载入当前牌组");
}
/* 构筑规则校验：生成分享码的硬性检查，也是管理面板里的实时提示。
   返回结构化条目：text 给人读；ids 是关联卡，供「点击违规定位到卡」用
   （全局计数类问题没有单卡可指，ids 为空 → 界面上不可点）。 */
function deckProblems(): Array<{ text: string; ids: number[] }> {
  const errs: Array<{ text: string; ids: number[] }> = [];
  if (draft.chars.length !== 3) errs.push({ text: `需要 3 名角色（当前 ${draft.chars.length}）`, ids: [] });
  if (draftTotal() !== 30) errs.push({ text: `需要 30 张行动牌（当前 ${draftTotal()}）`, ids: [] });
  const legend = [...draft.cards].filter(([id]) => copyLimit(id) === 1);
  const legendCount = legend.reduce((a, [, c]) => a + c, 0);
  if (legendCount > 1) errs.push({ text: `秘传牌整套限 1 张（当前 ${legendCount}）`, ids: legend.map(([id]) => id) });
  const over = [...draft.cards].filter(([id, c]) => c > copyLimit(id));
  if (over.length) errs.push({ text: `${over.length} 种卡牌超过同名上限（${over.map(([id]) => recordOfId(id)?.name || id).join("、")}）`, ids: over.map(([id]) => id) });
  /* 牌组限制（才能加入牌组的门槛）：当前 3 名角色是否满足每张卡的构筑依赖。
     同一缺口归并成一条，避免整齐的共鸣套刷出十几行重复提示。 */
  const byReq = new Map();
  for (const [id] of draft.cards) {
    const e = recordOfId(id);
    if (!e) continue;
    for (const r of (e ? e.reqs.deck : [])) {
      if (deckReqMet(r, draft.chars)) continue;
      const k = r.code + "|" + (r.tag || r.name || "");
      if (!byReq.has(k)) byReq.set(k, { req: r, names: [], ids: [] });
      const g = byReq.get(k);
      g.names.push(e.name);
      if (!g.ids.includes(id)) g.ids.push(id);
    }
  }
  for (const { req, names, ids } of byReq.values())
    errs.push({ text: `${reqGapText(req, draft.chars)}——${names.join("、")}`, ids });
  return errs;
}
/* 生成分享码：格式硬校验（3 角色 + 30 张 + 秘传限 1 + 同名上限）→ 编码 → 解码自校验 */
function draftEncode() {
  const errs = deckProblems();
  if (errs.length) throw new Error(errs[0].text);
  const ids = [...draft.chars, ...[...draft.cards].flatMap(([id, c]) => Array(c).fill(id))];
  const shareIds = ids.map(id => {
    const s = shareOfId(id);
    if (s == null) throw new Error(`「${(recordOfId(id) || recordOfId(id))?.name || id}」无分享 id，不可生成分享码`);
    return s;
  });
  const code = encodeRaw(shareIds);
  if (JSON.stringify(decodeRaw(code)) !== JSON.stringify(shareIds)) throw new Error("编码自校验失败");
  return code;
}

/* ---------- 草稿栏与牌组管理面板 ---------- */
function renderDraft() {
  const bar = $("draftBar");
  /* 栏常驻显示：它是牌组管理器的唯一入口——空牌组时若整条隐藏，用户既看不到
     当前进度，也无从打开管理器新建/切换牌组 */
  bar.style.display = "flex";
  bar.innerHTML = `<span class="dbar-title">${esc(activeDeck()?.name || "牌组草稿")}</span>
      <span class="dbar-count">角色 <b>${draft.chars.length}</b>/3 · 行动牌 <b>${draftTotal()}</b>/30</span>
      <span class="dbar-acts">
        <button id="draftManage">管理 ▾</button>
        <button id="draftGen" class="primary">生成分享码</button>
      </span>`;
  /* 面板可见性与牌组是否为空无关：切换/新建空牌组时管理器应保持打开，
     否则用户点了「新建牌组」面板就消失，无法继续操作 */
  if ($("draftPanel").classList.contains("show")) renderDraftPanel();
  /* 卡库/检索瓦片上的「×n」跟着联动：否则加完第二张，瓦片还显示 ×1（或没有） */
  if (typeof syncTileQty === "function") syncTileQty();
}
function renderDraftPanel() {
  const slot = i => {
    const id = draft.chars[i];
    if (id == null) return `<div class="dslot empty"><span>空角色槽</span></div>`;
    const c = recordOfId(id);
    if (!c) return `<div class="dslot empty"><span>失效角色</span></div>`;
    const el = (c ? c.stats.element : "");
    return `<div class="dslot"><img src="${imgFull(id)}" loading="lazy" decoding="async" alt="">
      <b>${el ? eleIcon(el) : ""}${esc(c.name)}</b><button data-rmc="${id}" title="移除">${ICON_X}</button></div>`;
  };
  /* 牌组列表：点击切换活动牌组；重命名/复制/删除逐项操作 */
  const deckList = decks.map(d => {
    const n = d.cards.reduce((s, [, c]) => s + c, 0);
    const avatars = d.chars.slice(0, 3).map(id => {
      const c = recordOfId(id);
      return c ? `<img class="dk-av" src="${imgFull(id)}" alt="" title="${esc(c.name)}" loading="lazy">` : "";
    }).join("");
    const name = deckRenameId === d.id
      ? `<input class="dk-rename" data-dkren-input="${d.id}" value="${esc(d.name)}" maxlength="24">`
      : `<span class="dk-name">${esc(d.name)}</span>`;
    const noteLine = deckNoteId === d.id
      ? `<input class="dk-note" data-dknote-input="${d.id}" value="${esc(d.note || "")}" maxlength="120" placeholder="备注：对局思路 / 起手要素…">`
      : (d.note ? `<small class="dk-note-prev" title="${esc(d.note)}">${esc(d.note)}</small>` : "");
    return `<div class="dk-item${d.id === activeDeckId ? " active" : ""}" data-deck="${d.id}">
      <span class="dk-dot"></span>${avatars}
      <span class="dk-meta">${name}<small>${d.chars.length} 角色 · ${n} 行动牌 · ${new Date(d.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })}</small>${noteLine}</span>
      <span class="dk-acts">
        <button data-dkren="${d.id}" title="重命名">✎</button>
        <button data-dknote="${d.id}" title="备注（对局思路 / 起手要素）">备注</button>
        <button data-dkcpy="${d.id}" title="复制为新牌组">⧉</button>
        <button data-dkdel="${d.id}" title="删除"${decks.length <= 1 ? " disabled" : ""}>${ICON_X}</button>
      </span></div>`;
  }).join("");
  const byType = {};
  for (const [id, count] of draft.cards) {
    const e = recordOfId(id);
    if (!e) continue;
    (byType[e.typeZh] ??= []).push({ id, count, name: e.name, cost: costText(e.stats.cost), el: (e ? e.stats.element : "") });
  }
  const order = ["装备牌", "支援牌", "事件牌"].filter(t => byType[t])
    .concat(Object.keys(byType).filter(t => !["装备牌", "支援牌", "事件牌"].includes(t)));
  const problems = deckProblems();
  $("draftPanel").innerHTML = `
    <div class="dp-head"><b>牌组管理</b>
      <span class="dp-acts">
        <button id="draftNew">${ICON_PLUS} 新建牌组</button>
        <button id="draftLoad">载入当前牌组</button>
        <button id="draftClose">收起</button></span></div>
    <div class="dk-list">${deckList}</div>
    <div class="dp-head dp-sub"><b>正在编辑：${esc(activeDeck()?.name || "")}</b>
      <span class="dp-acts"><button id="draftClear">清空</button></span></div>
    <div class="dp-chars">${[0, 1, 2].map(slot).join("")}</div>
    ${order.map(t => `<div class="dp-type">${t}</div>` + byType[t].map(x => `
      <div class="dp-row"><span class="dp-name">${x.el ? eleIcon(x.el) : ""}${esc(x.name)}</span><span class="dp-cost">${esc(x.cost || "—")}</span>
        <span class="dp-cnt"><button data-dec="${x.id}" title="减少一张">−</button><b>×${x.count}</b><button data-inc="${x.id}"${x.count >= copyLimit(x.id) ? " disabled" : ""} title="${x.count >= copyLimit(x.id) ? (copyLimit(x.id) === 1 ? "秘传牌整套限 1 张" : "同名卡上限 " + copyLimit(x.id) + " 张") : "再加一张"}">${ICON_PLUS}</button></span>
        <button class="dp-rm" data-rm="${x.id}" title="移除">${ICON_X}</button></div>`).join("")).join("") || `<div style="color:var(--dim);padding:10px 4px">行动牌为空——在卡库或检索中点击「＋」加入</div>`}
    <div class="dk-val${problems.length ? " err" : " ok"}">${problems.length
      ? problems.map(p => `<button class="val-item" data-vgoto="${p.ids.join(",")}"${p.ids.length ? ` title="点击定位（打开关联卡）"` : " disabled"}>⚠ ${esc(p.text)}</button>`).join("")
      : "✓ 符合构筑规则，可生成分享码"}</div>`;
}
/* 重命名提交：Enter / 失焦均提交，Esc 取消 */
function commitDeckRename(inp) {
  const id = Number(inp.dataset.dkrenInput);
  const d = decks.find(x => x.id === id);
  const v = (inp.value || "").trim();
  if (d && v) d.name = v.slice(0, 24);
  deckRenameId = null;
  saveDecks(); renderDraft(); renderDraftPanel();
}
/** 进入备注编辑态并聚焦输入框（交互契约与重命名完全同构）。 */
export function beginEditNote(id) {
  deckNoteId = id;
  renderDraftPanel();
  const inp = $("draftPanel").querySelector(".dk-note") as HTMLInputElement | null;
  if (inp) { inp.focus(); inp.select(); }
}
/** 备注提交：清空 = 删除备注字段（不落空串）。 */
function commitDeckNote(inp) {
  const id = Number(inp.dataset.dknoteInput);
  const d = decks.find(x => x.id === id);
  const v = (inp.value || "").trim();
  if (d) { if (v) d.note = v.slice(0, 120); else delete d.note; }
  deckNoteId = null;
  saveDecks(); renderDraft(); renderDraftPanel();
}
$("draftPanel").addEventListener("keydown", ev => {
  const noteInp = (ev.target as HTMLElement).closest("[data-dknote-input]") as HTMLInputElement | null;
  if (noteInp) {
    if (ev.key === "Enter") { commitDeckNote(noteInp); noteInp.blur(); }
    else if (ev.key === "Escape") { deckNoteId = null; renderDraftPanel(); ev.stopPropagation(); }
    return;
  }
  const inp = (ev.target as HTMLElement).closest("[data-dkren-input]") as HTMLInputElement | null;
  if (!inp) return;
  if (ev.key === "Enter") { commitDeckRename(inp); inp.blur(); }
  else if (ev.key === "Escape") {
    deckRenameId = null; renderDraftPanel();
    ev.stopPropagation();   /* 只取消重命名，不要连带关掉整个管理面板 */
  }
});
$("draftPanel").addEventListener("focusout", ev => {
  const t = ev.target as HTMLElement;
  const noteInp = t.closest ? t.closest("[data-dknote-input]") : null;
  if (noteInp) { commitDeckNote(noteInp); return; }
  const inp = t.closest ? t.closest("[data-dkren-input]") : null;
  if (inp) commitDeckRename(inp);
});

/* ---------- 核心牌标记（属于活动牌组的构筑事实） ----------
   核心牌 = 这套牌的构筑依赖（少张数的解牌 / 唯一装备…），概览条列出
   「仅 1 张」提醒，导出与分享图随之携带。 */
export function toggleCore(id) {
  const d = activeDeck();
  if (!d) return false;
  const core = d.core ? [...d.core] : [];
  const i = core.indexOf(id);
  if (i >= 0) core.splice(i, 1); else core.push(id);
  if (core.length) d.core = core; else delete d.core;
  saveDecks();
  return i < 0;
}
export const isCore = (id) => !!activeDeck()?.core?.includes(id);
/* 备注按钮 → 编辑态（含阻止冒泡：不触发牌组切换） */
$("draftPanel").addEventListener("click", ev => {
  const b = (ev.target as HTMLElement).closest("[data-dknote]") as HTMLElement | null;
  if (!b) return;
  ev.stopPropagation();
  beginEditNote(Number(b.dataset.dknote));
});
/* 点击牌组项切换活动牌组（点在按钮/输入框上不切换） */
document.addEventListener("click", ev => {
  const item = (ev.target as HTMLElement).closest("[data-deck]");
  if (!item || (ev.target as HTMLElement).closest("button") || (ev.target as HTMLElement).closest("input")) return;
  activeDeckId = Number(item.dataset.deck);
  syncFromActive(); renderDraft(); renderDraftPanel();
});

/* ---------- 牌组管理面板：开合集中在这里 ----------
   面板是可滚动的 60dvh 浮层，打开期间必须锁住文档滚动，否则在面板里滑到底
   滚动链会传给页面（表现为「滑动被背景捕捉」）。类名 + 层登记 + 锁同步
   收在 setModalLayer 一个函数里成对完成，开合点不可能漏掉任何一件。 */
const draftPanelEl = () => $("draftPanel");
const draftPanelOpen = () => !!(draftPanelEl() && draftPanelEl().classList.contains("show"));
export function openDraftPanel(): void {
  setModalLayer("draftPanel", draftPanelEl(), true, { order: 46, close: closeDraftPanel });
}
export function closeDraftPanel(): void {
  setModalLayer("draftPanel", draftPanelEl(), false, { order: 46, close: closeDraftPanel });
}
export function toggleDraftPanel(): void {
  if (draftPanelOpen()) closeDraftPanel(); else openDraftPanel();
}
/* 启动即登记：层表从引导起就完整（Esc 在首次开合前也认识这层）。
   open/close 里的 setModalLayer 以同一 spec 幂等覆盖，二者不冲突。 */
registerLayer({ id: "draftPanel", isOpen: draftPanelOpen, close: closeDraftPanel, order: 46, modal: true });

export { draft, decks, activeDeckId, deckRenameId, deckNoteId, loadDecks, saveDecks, activeDeck, deckSeq, newDeck, normalizeDeck, syncFromActive, saveDraft, loadDraft, pruneDraft, draftTotal, COPY_LIMIT, LEGEND_COPY_LIMIT, copyLimit, draftAdd, draftRemoveChar, draftRemoveCard, draftSetCount, draftClear, draftLoadCurrent, deckProblems, draftEncode, renderDraft, renderDraftPanel, commitDeckRename };
