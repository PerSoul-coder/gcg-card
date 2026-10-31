/* 60-parse.ts —— 分享码解析：码 → 牌组视图（角色 / 分组 / 限制）。 */
import { decodeRaw } from "./10-codec";
import { $ } from "./core/dom";
import { ensureData } from "./20-data";
import { idOfShare, recordOfId, nameOfId } from "./data/records";
import { renderGrid, renderList, renderSummary } from "./85-views";
import { state } from "./data/state";
import { STORAGE_KEYS, tagZh, eleIcon } from "./core/resources";
import { esc, setStatus } from "./core/dom";
import { registerLayer } from "./core/layers";
import { safeReplaceState } from "./core/history";
import { pool } from "./45-pool";

/* ---------- 历史 ---------- */
function loadHistory() {
  try {
    const h = JSON.parse(localStorage.getItem(STORAGE_KEYS.history) || "[]");
    /* 逐条消毒：损坏条目（旧版本写坏 / 手动改坏）曾让 renderHistory 直接 TypeError，
       且持久损坏 = 历史面板永久不可用（post-boot 静默）。不合格的整条丢弃。 */
    return Array.isArray(h) ? h.filter(x => x && typeof x === "object"
      && typeof x.code === "string"
      && Array.isArray(x.chars)
      && x.chars.every(c => c && typeof c === "object" && typeof c.name === "string")) : [];
  } catch { return []; }
}
function pushHistory(entry) {
  let h = loadHistory().filter(x => x.code !== entry.code);
  h.unshift(entry);
  try { localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(h.slice(0, 12))); } catch {}
}
function renderHistory() {
  const h = loadHistory();
  const p = $("histPanel");
  if (!h.length) { p.innerHTML = `<div class="hist-item" style="cursor:default;color:var(--dim)">暂无历史记录</div>`; return; }
  p.innerHTML = h.map(x => `<div class="hist-item" data-code="${esc(x.code)}">
    ${x.chars.map(c => eleIcon(c.el, "hist-el")).join("")}
    <span>${esc(x.chars.map(c => c.name).join(" / "))}</span>
    <span class="code">${esc(x.code)}</span></div>`).join("");
}

/* ---------- 历史面板开合 ----------
   历史面板在文档流内（展开在本页顶部），不是模态浮层：它开着时页面照样该能滚动，
   所以不设 modal、也不参与滚动锁。层序排在菜单之上、牌组面板之下。 */
const histPanelEl = () => $("histPanel");
const histPanelOpen = () => !!(histPanelEl() && histPanelEl().classList.contains("show"));
export function openHistoryPanel(): void {
  const el = histPanelEl();
  if (el && el.classList) el.classList.add("show");
}
export function closeHistoryPanel(): void {
  const el = histPanelEl();
  if (el && el.classList) el.classList.remove("show");
}
export function toggleHistoryPanel(): void {
  if (histPanelOpen()) closeHistoryPanel(); else openHistoryPanel();
}
registerLayer({ id: "histPanel", isOpen: histPanelOpen, close: closeHistoryPanel, order: 20 });

/* 分享码 → 角色 id / 行动牌 id / 数量表。解析主流程与牌组差异共用，
   保证两处对同一串码得到完全一致的结果。 */
function parseShareIds(code) {
  const src = String(code || "").trim();
  const shareIds = decodeRaw(src);
  const ids = shareIds.map(s => {
    const id = idOfShare(s);
    if (!id) throw new Error(`未知的分享 id ${s}，分享码可能有误或数据版本不匹配`);
    return id;
  });
  const charIds = ids.slice(0, 3), cardIds = ids.slice(3);
  const countMap = new Map();
  for (const id of cardIds) countMap.set(id, (countMap.get(id) || 0) + 1);
  return { code: src, charIds, cardIds, countMap };
}

/* ---------- 解析主流程（分享码 → 牌组） ---------- */
async function decodeAndRender(code: string, opts: { noHash?: boolean; noHistory?: boolean } = {}) {
  code = code.trim();
  if (!code) return;
  $<HTMLInputElement>("btnDecode").disabled = true;
  setStatus(`<span class="spin"></span>解析中…`);
  try {
    await ensureData();
    const { charIds, cardIds, countMap } = parseShareIds(code);
    const groups = {};
    for (const [id, count] of countMap) {
      const e = recordOfId(id);
      if (!e) throw new Error(`未知卡牌 id ${id}`);
      const type = e.typeZh;
      (groups[type] ??= []).push({
        id, count, name: e.name, type, typeRaw: e.typeRaw, element: e.stats.element,
        tags: e.stats.tags, tagsRaw: e.stats.tagsRaw,
        playCost: e.stats.cost, dice: e.stats.dice, energy: e.stats.energy,
        related: e.rel.relatedCharacterId == null ? null : nameOfId(e.rel.relatedCharacterId),
        relatedId: e.rel.relatedCharacterId ?? null,
        restrictions: e.reqs.play, deckReqs: e.reqs.deck,
        effect: e.desc.effect.trim(), since: e.version,
      });
    }
    const known = ["装备牌", "支援牌", "事件牌", "援助牌"];
    const order = known.filter(t => groups[t]).concat(Object.keys(groups).filter(t => !known.includes(t)));

    state.current = {
      code, charIds, cardIds,
      chars: charIds.map(id => {
        const c = recordOfId(id);
        if (!c) throw new Error(`未知角色 id ${id}`);
        return { id, name: c.name, hp: c.stats.hp ?? undefined, energy: c.stats.maxEnergy ?? undefined,
          since: c.version, element: c.stats.element };
      }),
      groups, order,
    };
    state.deckOrder = [...state.current!.chars.map(c => c.id),
      ...order.flatMap(t => state.current!.groups[t].map(x => x.id))];

    renderSummary(); renderGrid(); renderList();
    /* 摘要只属于「卡面视图」：在卡库/列表里解析牌组不应把整块摘要顶到标签栏上方 */
    $("summary").style.display = state.currentView === "grid" ? "block" : "none";
    (["btnCopyCode", "btnExport"] as const).forEach(b => $<HTMLButtonElement>(b).disabled = false);
    setStatus(`解析成功：3 名角色 + ${cardIds.length} 张行动牌（去重 ${countMap.size} 种）`, "ok");
    if (!opts.noHash) safeReplaceState(null, "#" + code);   /* Safari 限速超限时丢地址栏同步，不中断解析 */
    if (!opts.noHistory) pushHistory({ code, chars: state.current!.chars.map(c => ({ name: c.name, el: c.element })) });
  } catch (e) {
    setStatus(`解析失败：${(e as Error).message}`, "err");
  } finally {
    $<HTMLInputElement>("btnDecode").disabled = false;
  }
}

/* ---------- 顶部输入框：只解析牌组分享码 ----------
   卡牌检索已移入「卡库浏览」的独立检索框，不再与分享码共用入口；
   这里不再自动把非分享码文本当成检索词，避免两个功能互相误触发。 */
const CODE_RE = /^[A-Za-z0-9+/]{50,}={0,2}$/;
function looksLikeCode(text) {
  return CODE_RE.test((text || "").replace(/\s+/g, ""));
}
async function resolveInput(text) {
  const t = (text || "").trim();
  if (!t) return;
  if (!looksLikeCode(t)) {
    setStatus("这不是牌组分享码。卡牌检索请使用「卡库浏览」顶部的检索框。", "err");
    return;
  }
  await decodeAndRender(t);
}

export { loadHistory, pushHistory, renderHistory, parseShareIds, decodeAndRender, CODE_RE, looksLikeCode, resolveInput };
