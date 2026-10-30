/* src/60-parse.js —— 由 scripts/_convert.mjs 从旧脚本转换（迁移中间态）。 */
import { decodeRaw } from "./10-codec";
import { $ } from "./core/dom";
import { ensureData } from "./20-data";
import { cardElement } from "./45-pool";
import { deckReqsOf, diceCost, energyCost, restrictionsOf } from "./30-deps";
import { renderGrid, renderList, renderSummary } from "./85-views";
import { state } from "./data/state";
import { STORAGE_KEYS, tagZh, eleIcon } from "./core/resources";
import { esc, setStatus } from "./core/dom";
import { TYPE_ZH } from "./data/model";
import { pool } from "./45-pool";

/* ---------- 历史 ---------- */
function loadHistory() { try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.history) || "[]"); } catch { return []; } }
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

/* 分享码 → 角色 id / 行动牌 id / 数量表。解析主流程与牌组差异共用，
   保证两处对同一串码得到完全一致的结果。 */
function parseShareIds(code) {
  const src = String(code || "").trim();
  const shareIds = decodeRaw(src);
  const ids = shareIds.map(s => {
    const id = state.shareMap[s];
    if (!id) throw new Error(`未知的分享 id ${s}，分享码可能有误或数据版本不匹配`);
    return id;
  });
  const charIds = ids.slice(0, 3), cardIds = ids.slice(3);
  const countMap = new Map();
  for (const id of cardIds) countMap.set(id, (countMap.get(id) || 0) + 1);
  return { code: src, charIds, cardIds, countMap };
}

/* ---------- 解析主流程（分享码 → 牌组） ---------- */
async function decodeAndRender(code, opts = {}) {
  code = code.trim();
  if (!code) return;
  $("btnDecode").disabled = true;
  setStatus(`<span class="spin"></span>解析中…`);
  try {
    await ensureData();
    const { charIds, cardIds, countMap } = parseShareIds(code);
    const groups = {};
    for (const [id, count] of countMap) {
      const e = state.entById.get(id);
      if (!e) throw new Error(`未知卡牌 id ${id}`);
      const type = TYPE_ZH[e.type] || e.type;
      (groups[type] ??= []).push({
        id, count, name: e.name, type, typeRaw: e.type, element: cardElement(e),
        tags: e.tags.map(tagZh).filter(Boolean), tagsRaw: e.tags,
        playCost: e.playCost, dice: diceCost(e.playCost), energy: energyCost(e.playCost),
        related: e.relatedCharacterId ? state.charById.get(e.relatedCharacterId)?.name : null,
        relatedId: e.relatedCharacterId ?? null,
        restrictions: restrictionsOf(e), deckReqs: deckReqsOf(e),
        desc: (e.description || "").trim(), since: e.sinceVersion,
      });
    }
    const known = ["装备牌", "支援牌", "事件牌", "援助牌"];
    const order = known.filter(t => groups[t]).concat(Object.keys(groups).filter(t => !known.includes(t)));

    state.current = {
      code, charIds, cardIds,
      chars: charIds.map(id => {
        const c = state.charById.get(id);
        if (!c) throw new Error(`未知角色 id ${id}`);
        return { id, name: c.name, hp: c.hp, energy: c.maxEnergy, since: c.sinceVersion,
          element: (c.tags.find(t => t.startsWith("GCG_TAG_ELEMENT")) || "").replace("GCG_TAG_ELEMENT_", "") };
      }),
      groups, order,
    };
    state.deckOrder = [...state.current.chars.map(c => c.id),
      ...order.flatMap(t => state.current.groups[t].map(x => x.id))];

    renderSummary(); renderGrid(); renderList();
    /* 摘要只属于「卡面视图」：在卡库/列表里解析牌组不应把整块摘要顶到标签栏上方 */
    $("summary").style.display = state.currentView === "grid" ? "block" : "none";
    ["btnCopyCode", "btnExport"].forEach(b => $(b).disabled = false);
    setStatus(`解析成功：3 名角色 + ${cardIds.length} 张行动牌（去重 ${countMap.size} 种）`, "ok");
    if (!opts.noHash) history.replaceState(null, "", "#" + code);
    if (!opts.noHistory) pushHistory({ code, chars: state.current.chars.map(c => ({ name: c.name, el: c.element })) });
  } catch (e) {
    setStatus(`解析失败：${e.message}`, "err");
  } finally {
    $("btnDecode").disabled = false;
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
