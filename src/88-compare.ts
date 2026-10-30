/* src/88-compare.js —— 由 scripts/_convert.mjs 从旧脚本转换（迁移中间态）。 */
import { cardElement, charElement, pool } from "./45-pool";
import { $ } from "./core/dom";
import { costText, deckReqsOf, diceCost, energyCost, restrictionsOf } from "./30-deps";
import { linkify } from "./40-concepts";
import { overlayBack, overlayOpen, renderOverlay, topView } from "./90-detail";
import { draftEncode } from "./80-deck";
import { parseShareIds } from "./60-parse";
import { dataReady, ensureData } from "./20-data";
import { state } from "./data/state";
import { ELE_ZH, tagZh, eleIcon } from "./core/resources";
import { esc, setStatus, toast } from "./core/dom";
import { TYPE_ZH, typeZhOf, cardArtHtml } from "./data/model";
import { decks } from "./80-deck";
import { navBar, tip } from "./90-detail";

/* ---------- 多卡对比：选择态 ----------
   对比是"跨视图的临时选择"，独立于牌组草稿与检索状态：
   · 卡库 / 检索结果里的卡块点「⇄」加入，最多 4 张；
   · 选择不写入 localStorage，刷新即清空，避免与牌组数据混淆；
   · 对比面板压入 state.overlayStack，可继续点卡名查看详情，返回时回到对比。 */
const COMPARE_MAX = 4;
const compareState = { ids: [] };
/* 面板偏好只存内存：仅看差异记住上次选择，相似卡区块每次重新展开 */
const comparePrefs = { onlyDiff: false };

function compareName(id) {
  return state.charById.get(id)?.name || state.entById.get(id)?.name || `#${id}`;
}
function cmpBtnHtml(id) {
  const on = compareState.ids.includes(Number(id));
  return `<button class="cmpbtn${on ? " on" : ""}" data-cmp="${id}" title="加入对比（最多 ${COMPARE_MAX} 张）" aria-pressed="${on}">⇄</button>`;
}
function toggleCompare(id) {
  id = Number(id);
  if (!state.charById.has(id) && !state.entById.has(id)) return;
  const i = compareState.ids.indexOf(id);
  if (i >= 0) compareState.ids.splice(i, 1);
  else if (compareState.ids.length >= COMPARE_MAX) { toast(`最多同时对比 ${COMPARE_MAX} 张卡牌`, true); return; }
  else compareState.ids.push(id);
  syncCompareUI();
}
function syncCompareUI() {
  renderCompareBar();
  const nodes = document.querySelectorAll ? document.querySelectorAll("[data-cmp]") : [];
  nodes.forEach(el => {
    const on = compareState.ids.includes(Number(el.dataset.cmp));
    if (el.classList) el.classList.toggle("on", on);
    if (el.setAttribute) el.setAttribute("aria-pressed", on ? "true" : "false");
    if (el.dataset && el.dataset.cmpLabel) el.textContent = on ? "✓ 已选" : el.dataset.cmpLabel;
  });
}
function renderCompareBar() {
  const bar = $("compareBar");
  if (!bar) return;
  const body = document.body;
  const ids = compareState.ids.filter(id => state.charById.has(id) || state.entById.has(id));
  if (!ids.length) {
    bar.classList.remove("show"); bar.innerHTML = "";
    if (body && body.classList) body.classList.remove("cmp-on");
    return;
  }
  bar.classList.add("show");
  /* 常驻对比栏会盖住页面最后一行，按显示状态给正文补底部留白 */
  if (body && body.classList) body.classList.add("cmp-on");
  bar.innerHTML = `<span class="cmpbar-title">对比 <b>${ids.length}</b>/${COMPARE_MAX}</span>
    <span class="cmpbar-chips">${ids.map(id => `<span class="cmpbar-chip"><button class="cmpbar-name" data-goto="${id}" title="查看详情">${esc(compareName(id))}</button><button data-cmprm="${id}" title="移出对比">✕</button></span>`).join("")}</span>
    <span class="cmpbar-acts"><button data-cmpclear="1">清空</button><button class="primary" data-cmpopen="1"${ids.length < 2 ? " disabled" : ""} title="${ids.length < 2 ? "至少选择 2 张" : "开始对比"}">对比</button></span>`;
}

/* ---------- 多卡对比：字段模型 ----------
   每张卡先归一化成"标签 → {html,text}"；text 用于判断差异，html 用于展示。
   文本归一化只去空白，不剥标点——「费用 1」与「费用1」视为相同。 */
function fieldVal(html, text) {
  return { html: html || "—", text: String(text ?? "").replace(/\s+/g, "") };
}
function compareFields(id) {
  const c = state.charById.get(id), e = state.entById.get(id);
  if (!c && !e) return null;
  const isChar = !!c;
  const raw = c || e;
  const el = isChar ? charElement(c) : cardElement(e);
  const tags = (raw.tags || []).filter(t => !t.startsWith("GCG_TAG_ELEMENT_")).map(tagZh).filter(Boolean);
  const since = isChar ? c.sinceVersion : e.sinceVersion;
  const cost = isChar ? "—" : (costText(e.playCost) || "—");
  const energy = isChar ? `上限 ${c.maxEnergy}` : (energyCost(e.playCost) ? `费用 ${energyCost(e.playCost)}` : "—");
  const hp = isChar ? String(c.hp) : "—";
  const rel = !isChar && e.relatedCharacterId != null
    ? (state.charById.get(e.relatedCharacterId)?.name || String(e.relatedCharacterId)) : "—";
  const dreq = !isChar ? (deckReqsOf(e).map(r => r.short).join("、") || "—") : "—";
  const play = !isChar ? (restrictionsOf(e).map(r => r.short).join("、") || "—") : "—";
  let effectHtml, effectText;
  if (isChar) {
    const skills = (c.skills || []).filter(s => !s.hidden);
    effectHtml = skills.map(s => `<div class="cmp-skill"><b>【${esc(s.name)}】</b>${linkify(esc((s.description || s.rawDescription || "").trim()))}</div>`).join("");
    effectText = skills.map(s => s.name + (s.description || s.rawDescription || "")).join("");
  } else {
    effectHtml = (e.description || "").trim() ? linkify(esc((e.description || "").trim())) : "";
    effectText = e.description || "";
  }
  return {
    id: Number(id), isChar, name: raw.name,
    rows: {
      "类型": fieldVal(isChar ? "角色牌" : esc(typeZhOf(e)), isChar ? "角色牌" : typeZhOf(e)),
      "元素": fieldVal(el ? eleIcon(el) + esc(ELE_ZH[el] || el) : "—", el ? (ELE_ZH[el] || el) : ""),
      "费用": fieldVal(esc(cost), cost),
      "充能": fieldVal(esc(energy), energy),
      "生命": fieldVal(hp, hp),
      "版本": fieldVal(esc(since || "—"), since || ""),
      "标签": fieldVal(tags.length ? esc(tags.join("、")) : "—", tags.join("、")),
      "关联角色": fieldVal(esc(rel), rel),
      "牌组限制": fieldVal(esc(dreq), dreq),
      "打出限制": fieldVal(esc(play), play),
      "效果 / 技能": fieldVal(effectHtml, effectText),
    },
  };
}
const COMPARE_LABELS = ["类型", "元素", "费用", "充能", "生命", "版本", "标签", "关联角色", "牌组限制", "打出限制", "效果 / 技能"];
function compareData(ids) {
  const items = ids.map(compareFields).filter(Boolean);
  const rows = COMPARE_LABELS.map(label => {
    const vals = items.map(it => it.rows[label] || fieldVal("—", ""));
    return { label, vals, diff: new Set(vals.map(v => v.text)).size > 1 };
  });
  return { items, rows };
}
function compareRows(ids) { return compareData(ids).rows; }

/* ---------- 相似卡替换建议 ----------
   候选来自全量卡池（可构筑卡），行动牌要求同类型，再按同费用 / 同角色 /
   标签重合加权；角色牌按同元素与标签重合。只给建议，不改变牌组。 */
function simMeta(x) {
  if (x.kind === "char") return `角色 · 生命 ${x.hp} · 充能 ${x.energy}`;
  return `${x.type}${costText(x.playCost) ? " · " + costText(x.playCost) : " · 无费用"}`;
}
function simScore(base, cand) {
  let score = 0;
  const why = [];
  if (base.kind === "card") {
    if (base.typeRaw === cand.typeRaw) { score += 40; why.push("同类型"); }
    if (base.dice === cand.dice) { score += 22; why.push("同费用"); }
    if (base.energyCost === cand.energyCost) score += 6;
    if (base.relatedId != null && base.relatedId === cand.relatedId) { score += 14; why.push("同角色"); }
  } else {
    if (base.element && base.element === cand.element) { score += 30; why.push("同元素"); }
    if (base.energy === cand.energy) score += 8;
  }
  if (base.element && base.element === cand.element) score += 8;
  const shared = base.tags.filter(t => cand.tags.includes(t));
  if (shared.length) { score += shared.length * 6; why.push("标签 " + shared.slice(0, 2).join("·")); }
  if (!why.length) why.push(base.kind === "card" ? "同类型" : "同类别");
  return { score, why };
}
function similarCards(id, limit = 3) {
  id = Number(id);
  const base = pool.find(x => x.id === id);
  if (!base) return [];
  const out = [];
  for (const x of pool) {
    if (x.id === id || x.share == null || x.kind !== base.kind) continue;
    if (base.kind === "card" && x.typeRaw !== base.typeRaw) continue;
    const { score, why } = simScore(base, x);
    out.push({ id: x.id, name: x.name, score, why: why.join(" · "), meta: simMeta(x) });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh")).slice(0, limit);
}
function inCurrentDeck(id) {
  return !!state.current && (state.current.charIds.includes(id) || state.current.cardIds.includes(id));
}
/* 把对比中的一张卡换成候选卡：同步浮动对比栏与已打开的对比视图 */
function swapCompare(fromId, toId) {
  fromId = Number(fromId); toId = Number(toId);
  const i = compareState.ids.indexOf(fromId);
  if (i < 0) return false;
  if (!state.charById.has(toId) && !state.entById.has(toId)) return false;
  if (compareState.ids.includes(toId)) return false;
  compareState.ids[i] = toId;
  const top = topView();
  if (top && top.kind === "compare") {
    const j = top.ids.indexOf(fromId);
    if (j >= 0) top.ids[j] = toId;
    renderOverlay();
  }
  syncCompareUI();
  return true;
}
function renderSimilarSection(items) {
  return `<div class="cmp-sim-sec">
    <h3>相似卡替换 <small>同类型优先，按费用 / 标签 / 关联角色排序</small></h3>
    ${items.map(it => {
      const cands = similarCards(it.id, 3);
      return `<div class="sim-block">
        <div class="sim-head"><span>${esc(it.name)}</span><small>${it.isChar ? "角色牌" : "行动牌"}</small></div>
        ${cands.length ? cands.map(c => {
          const inCmp = compareState.ids.includes(c.id);
          return `<div class="sim-item">
            <button class="sim-name" data-goto="${c.id}" title="查看详情">${esc(c.name)}</button>
            <span class="sim-meta">${esc(c.meta)}</span>
            <span class="sim-why">${esc(c.why)}</span>
            ${inCurrentDeck(c.id) ? `<span class="sim-in">已在牌组</span>` : ""}
            <button class="sim-swap" data-csimswap="${it.id}" data-simto="${c.id}"${inCmp ? ` disabled title="已在对比中"` : ` title="用这张卡替换对比位"`}>${inCmp ? "已在对比" : "⇄ 换入"}</button>
          </div>`;
        }).join("") : `<div class="sim-empty">没有可替换的同类型卡牌</div>`}
      </div>`;
    }).join("")}
  </div>`;
}

/* ---------- 多卡对比：面板 ---------- */
function renderCompareView(v) {
  const { items, rows } = compareData(v.ids);
  if (items.length < 2) {
    $("detail").innerHTML = `${navBar()}<div class="cmp-view"><div class="cmp-title">卡牌对比</div>
      <div class="cmp-empty">至少选择 2 张卡牌才能对比。</div></div>`;
    return;
  }
  const shown = v.onlyDiff ? rows.filter(r => r.diff) : rows;
  const diffN = rows.filter(r => r.diff).length;
  const n = items.length;
  const head = `<div class="cmp-hcell cmp-hlabel"><span>字段</span><small>${diffN} 项差异</small></div>` +
    items.map(it => `<div class="cmp-hcell">
      ${cardArtHtml(it.id, { kind: "cmp", alt: it.name })}
      <button class="cmp-hname" data-goto="${it.id}" title="查看详情">${esc(it.name)}</button>
      <button class="cmp-hx" data-cmprm="${it.id}" title="移出对比">✕</button></div>`).join("");
  const body = shown.map(r => `<div class="cmp-label${r.diff ? " diff" : ""}">${r.label}</div>` +
    r.vals.map(val => `<div class="cmp-val${r.diff ? " diff" : ""}">${val.html}</div>`).join("")).join("");
  const extra = `<button class="lbtn${v.onlyDiff ? " on" : ""}" data-cdiff="1" title="只显示存在差异的字段">${v.onlyDiff ? "显示全部" : "仅看差异"}</button>
    <button class="lbtn${v.showSim ? " on" : ""}" data-csimtoggle="1" title="按同类型 / 同费用 / 标签重合给出替换候选">相似卡</button>`;
  $("detail").innerHTML = `${navBar(extra)}
    <div class="cmp-view">
      <div class="cmp-title">卡牌对比 <small>${n} 张 · ${rows.length} 项字段</small></div>
      ${shown.length
        ? `<div class="cmp-scroll"><div class="cmp-table" style="--n:${n}">${head}${body}</div></div>`
        : `<div class="cmp-empty">所选卡牌的字段完全一致。</div>`}
      ${v.showSim ? renderSimilarSection(items) : ""}
      <div class="cmp-hint">点击卡名查看详情 · 对比上限 ${COMPARE_MAX} 张 · 差异字段以金色标记${v.showSim ? "" : " · 「相似卡」可看替换候选"}</div>
    </div>`;
}
function showCompare() {
  const ids = compareState.ids.filter(id => state.charById.has(id) || state.entById.has(id));
  if (ids.length < 2) { toast("至少选择 2 张卡牌才能对比", true); return; }
  const view = { kind: "compare", ids: [...ids], onlyDiff: comparePrefs.onlyDiff, showSim: false };
  const top = topView();
  if (overlayOpen() && top) {
    /* 从详情打开时压栈：返回键回到那张卡，而不是把详情上下文丢掉 */
    if (top.kind === "compare") { top.ids = view.ids; top.showSim = false; }
    else state.overlayStack.push(view);
  } else state.overlayStack = [view];
  renderOverlay();
}

/* ---------- 牌组差异：解码复用 + 纯差异模型 ---------- */
function deckCodeNow() {
  if (state.current && state.current.code) return state.current.code;
  try { return draftEncode(); }
  catch (e) { toast(e.message, true); return ""; }
}
function deckDist(d) {
  const cost = Array(6).fill(0), type = {};
  for (const [id, n] of d.countMap) {
    const e = state.entById.get(id);
    if (!e) continue;
    cost[Math.min(diceCost(e.playCost), 5)] += n;
    const t = typeZhOf(e);
    type[t] = (type[t] || 0) + n;
  }
  return { cost, type };
}
/* 两套分享码的差异：角色按名字匹配（同角色的不同版本不算换人），
   行动牌按 id 汇总数量；added / removed / changed / same 都是行数组。 */
function diffDecks(codeA, codeB) {
  const A = parseShareIds(codeA), B = parseShareIds(codeB);
  const charName = id => state.charById.get(id)?.name || `#${id}`;
  const aNames = new Set(A.charIds.map(charName));
  const bNames = new Set(B.charIds.map(charName));
  const charAdded = B.charIds.filter(id => !aNames.has(charName(id)));
  const charRemoved = A.charIds.filter(id => !bNames.has(charName(id)));
  const ids = new Set([...A.countMap.keys(), ...B.countMap.keys()]);
  const rows = [...ids].map(id => {
    const e = state.entById.get(id);
    const a = A.countMap.get(id) || 0, b = B.countMap.get(id) || 0;
    return { id, name: e?.name || `#${id}`, type: TYPE_ZH[e?.type] || e?.type || "", a, b, delta: b - a };
  }).sort((x, y) => (x.type.localeCompare(y.type, "zh") || x.name.localeCompare(y.name, "zh")));
  return {
    A, B, rows,
    added: rows.filter(r => r.a === 0 && r.b > 0),
    removed: rows.filter(r => r.a > 0 && r.b === 0),
    changed: rows.filter(r => r.a > 0 && r.b > 0 && r.a !== r.b),
    same: rows.filter(r => r.a === r.b),
    charAdded, charRemoved,
  };
}
function deckHeadHtml(tag, d) {
  const chars = d.charIds.map(id => {
    const c = state.charById.get(id);
    return c ? `<span class="dd-chip">${eleIcon(charElement(c))}${esc(c.name)}</span>` : "";
  }).join("");
  return `<div class="dd-deck"><b>牌组 ${tag}</b><span class="dd-chars">${chars}</span>
    <small>${d.charIds.length} 名角色 · ${d.cardIds.length} 张行动牌</small></div>`;
}
function distTable(label, keys, a, b) {
  const rows = keys.map(k => {
    const av = a[k] || 0, bv = b[k] || 0, d = bv - av;
    return `<tr><td>${esc(k)}</td><td>${av}</td><td>${bv}</td>
      <td class="delta ${d > 0 ? "up" : d < 0 ? "down" : ""}">${d === 0 ? "—" : (d > 0 ? "+" : "") + d}</td></tr>`;
  }).join("");
  return `<table class="dd-table dd-dist"><tr><th>${esc(label)}</th><th>A</th><th>B</th><th>Δ</th></tr>${rows}</table>`;
}
function renderDeckDiffRes(res, showSame) {
  const da = deckDist(res.A), db = deckDist(res.B);
  const costKeys = ["0", "1", "2", "3", "4", "5+"];
  const aCost = Object.fromEntries(costKeys.map((k, i) => [k, da.cost[i]]));
  const bCost = Object.fromEntries(costKeys.map((k, i) => [k, db.cost[i]]));
  const typeKeys = [...new Set([...Object.keys(da.type), ...Object.keys(db.type)])].sort((a, b) => a.localeCompare(b, "zh"));
  const shown = showSame ? res.rows : res.rows.filter(r => r.a !== r.b);
  const cardRows = shown.map(r => `<tr class="${r.a === 0 ? "added" : r.b === 0 ? "removed" : "changed"}">
    <td><button class="blchip" data-goto="${r.id}">${esc(r.name)}</button><small>${esc(r.type)}</small></td>
    <td>${r.a ? "×" + r.a : "—"}</td><td>${r.b ? "×" + r.b : "—"}</td>
    <td class="delta ${r.b > r.a ? "up" : r.b < r.a ? "down" : ""}">${r.a === r.b ? "—" : (r.b > r.a ? "+" : "") + (r.b - r.a)}</td></tr>`).join("");
  const charLine = (res.charAdded.length || res.charRemoved.length)
    ? `${res.charRemoved.length ? `<span class="dd-tag del">A 独有角色：${res.charRemoved.map(id => esc(compareName(id))).join("、")}</span>` : ""}
       ${res.charAdded.length ? `<span class="dd-tag add">B 独有角色：${res.charAdded.map(id => esc(compareName(id))).join("、")}</span>` : ""}`
    : `<span class="dd-tag same">角色完全相同</span>`;
  return `
    <div class="dd-decks">${deckHeadHtml("A", res.A)}${deckHeadHtml("B", res.B)}</div>
    <div class="dd-sum">
      <span class="dd-tag add">新增 <b>${res.added.length}</b> 种</span>
      <span class="dd-tag del">移除 <b>${res.removed.length}</b> 种</span>
      <span class="dd-tag chg">数量变化 <b>${res.changed.length}</b> 种</span>
      <span class="dd-tag same">相同 <b>${res.same.length}</b> 种</span>
      ${charLine}
    </div>
    <div class="dd-sec">
      <h3>行动牌差异 <button class="dd-mini${showSame ? " on" : ""}" data-dd-all="1">${showSame ? "只看差异" : `显示相同（${res.same.length}）`}</button></h3>
      ${shown.length ? `<table class="dd-table">
        <tr><th>卡牌</th><th>A</th><th>B</th><th>Δ</th></tr>${cardRows}</table>`
        : `<div class="dd-empty">${res.rows.length ? "两套牌组的行动牌完全一致。" : "没有可比对的行动牌。"}</div>`}
    </div>
    <div class="dd-sec dd-cols">
      <div><h3>费用曲线</h3>${distTable("费用", costKeys, aCost, bCost)}</div>
      <div><h3>类型分布</h3>${typeKeys.length ? distTable("类型", typeKeys, da.type, db.type) : `<div class="dd-empty">无行动牌</div>`}</div>
    </div>`;
}
/* 牌组对比的输入与结果只在内存保留：关掉再打开继续上一次的对比，
   避免每次都要重新粘贴两串长分享码。 */
const deckDiffState = { a: "", b: "", res: null, err: "", showSame: false, dirty: false };
function saveDeckDiff(v) {
  if (!v || v.kind !== "deckdiff") return;
  deckDiffState.a = v.a || "";
  deckDiffState.b = v.b || "";
  deckDiffState.res = v.res || null;
  deckDiffState.err = v.err || "";
  deckDiffState.showSame = !!v.showSame;
  deckDiffState.dirty = !!v.dirty;
}
function runDeckDiff(v) {
  v.dirty = false;
  try {
    if (!String(v.a || "").trim() || !String(v.b || "").trim())
      throw new Error("请填写牌组 A 与牌组 B 的分享码");
    v.res = diffDecks(v.a, v.b);
    v.err = "";
  } catch (e) {
    v.res = null;
    v.err = e.message;
  }
  saveDeckDiff(v);
  return v;
}
function swapDeckDiff(v) {
  const t = v.a; v.a = v.b; v.b = t;
  v.dirty = false;
  v.err = "";
  v.res = null;
  if (String(v.a || "").trim() && String(v.b || "").trim()) runDeckDiff(v);
  saveDeckDiff(v);
  return v;
}
function clearDeckDiff(v) {
  v.a = ""; v.b = ""; v.res = null; v.err = ""; v.showSame = false; v.dirty = false;
  saveDeckDiff(v);
  return v;
}
function renderDeckDiffView(v) {
  $("detail").innerHTML = `${navBar()}
    <div class="dd-view">
      <div class="cmp-title">牌组差异对比</div>
      <div class="dd-form">
        <div class="dd-side">
          <label class="dd-field"><span>牌组 A</span>
            <input data-dd="a" value="${esc(v.a)}" placeholder="粘贴分享码" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" enterkeyhint="go" aria-label="牌组 A 分享码"></label>
          <button class="dd-mini" data-dd-use="a" title="填入当前正在查看的牌组">用当前</button>
        </div>
        <button class="dd-mini dd-swap" data-dd-swap="1" title="交换 A / B" aria-label="交换牌组 A 与 B">⇅<span class="dd-swap-t">交换</span></button>
        <div class="dd-side">
          <label class="dd-field"><span>牌组 B</span>
            <input data-dd="b" value="${esc(v.b)}" placeholder="粘贴分享码" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" enterkeyhint="go" aria-label="牌组 B 分享码"></label>
          <button class="dd-mini" data-dd-use="b" title="填入当前正在查看的牌组">用当前</button>
        </div>
      </div>
      <div class="dd-actions">
        <button class="primary" data-dd-run="1">对比</button>
        <button class="dd-mini" data-dd-clear="1">清空</button>
        <span class="dd-tip">按 Enter 也可对比 · 结果会在关闭后保留</span>
      </div>
      <div class="dd-dirty${v.dirty ? " show" : ""}" data-dd-dirty>分享码已修改，点「对比」或按 Enter 更新结果</div>
      ${v.err ? `<div class="dd-err">${esc(v.err)}</div>` : ""}
      ${v.res ? renderDeckDiffRes(v.res, v.showSame)
        : `<div class="dd-hint">粘贴两套牌组分享码，查看新增 / 移除 / 数量变化，以及费用曲线与类型分布差异。点「用当前」可填入顶部正在查看的牌组。</div>`}
    </div>`;
}
function focusDeckDiffInput() {
  if (!document.querySelector) return;
  const top = topView();
  if (!top || top.kind !== "deckdiff") return;
  /* A 已由当前牌组预填时，直接把光标放到 B，少一次点击 */
  const which = !top.a ? "a" : (!top.b ? "b" : null);
  if (!which) return;
  const el = document.querySelector(`[data-dd="${which}"]`);
  if (el && typeof el.focus === "function") el.focus();
}
function showDeckDiff() {
  if (!dataReady) {
    ensureData().then(showDeckDiff).catch(e => setStatus("数据加载失败：" + e.message, "err"));
    return;
  }
  if (!deckDiffState.a && state.current?.code) deckDiffState.a = state.current.code;
  state.overlayStack = [{ kind: "deckdiff", ...deckDiffState }];
  renderOverlay();
  focusDeckDiffInput();
}

/* ---------- 交互 ---------- */
/* 卡块上的「⇄」用捕获阶段拦截：避免继续触发卡片点击（打开详情） */
document.addEventListener("click", ev => {
  const b = ev.target.closest ? ev.target.closest("[data-cmp]") : null;
  if (!b) return;
  ev.preventDefault();
  ev.stopPropagation();
  toggleCompare(Number(b.dataset.cmp));
  /* 详情顶栏的「对比 / ✓ 已选」和「⇄ n」需要跟着选择数即时变化 */
  const top = topView();
  if (overlayOpen() && top && top.kind === "detail") renderOverlay();
}, true);

document.addEventListener("click", ev => {
  const rm = ev.target.closest ? ev.target.closest("[data-cmprm]") : null;
  if (rm) {
    const id = Number(rm.dataset.cmprm);
    toggleCompare(id);
    const top = topView();
    if (top && top.kind === "compare") {
      top.ids = top.ids.filter(x => x !== id);
      if (top.ids.length < 2) { overlayBack(); toast("至少保留 2 张才能对比", true); }
      else renderOverlay();
    }
    return;
  }
  if (ev.target.closest("[data-cmpclear]")) { compareState.ids = []; syncCompareUI(); return; }
  if (ev.target.closest("[data-cmpopen]")) { showCompare(); return; }
  if (ev.target.closest("[data-cdiff]")) {
    const top = topView();
    if (top && top.kind === "compare") {
      top.onlyDiff = !top.onlyDiff;
      comparePrefs.onlyDiff = top.onlyDiff;
      renderOverlay();
    }
    return;
  }
  if (ev.target.closest("[data-csimtoggle]")) {
    const top = topView();
    if (top && top.kind === "compare") { top.showSim = !top.showSim; renderOverlay(); }
    return;
  }
  const swap = ev.target.closest ? ev.target.closest("[data-csimswap]") : null;
  if (swap) {
    const toId = Number(swap.dataset.simto);
    if (swapCompare(swap.dataset.csimswap, toId)) toast(`已换入「${compareName(toId)}」`);
    else toast("该卡已在对比中", true);
    return;
  }
  if (ev.target.closest("[data-dd-run]")) {
    const top = topView();
    if (!top || top.kind !== "deckdiff") return;
    runDeckDiff(top);
    renderOverlay();
    return;
  }
  if (ev.target.closest("[data-dd-swap]")) {
    const top = topView();
    if (!top || top.kind !== "deckdiff") return;
    swapDeckDiff(top);
    renderOverlay();
    return;
  }
  if (ev.target.closest("[data-dd-clear]")) {
    const top = topView();
    if (!top || top.kind !== "deckdiff") return;
    clearDeckDiff(top);
    renderOverlay();
    focusDeckDiffInput();
    return;
  }
  const use = ev.target.closest ? ev.target.closest("[data-dd-use]") : null;
  if (use) {
    const top = topView();
    if (!top || top.kind !== "deckdiff") return;
    const code = deckCodeNow();
    if (!code) return;
    top[use.dataset.ddUse] = code;
    top.dirty = !!top.res;
    saveDeckDiff(top);
    renderOverlay();
    return;
  }
  if (ev.target.closest("[data-dd-all]")) {
    const top = topView();
    if (top && top.kind === "deckdiff") {
      top.showSame = !top.showSame;
      saveDeckDiff(top);
      renderOverlay();
    }
  }
});

/* 输入框只改状态、不重渲染，避免每敲一个字符就丢焦点。
   已有结果时给出「已修改」提示，防止看着旧结果以为是最新的。 */
document.addEventListener("input", ev => {
  const inp = ev.target.closest ? ev.target.closest("[data-dd]") : null;
  if (!inp) return;
  const top = topView();
  if (!top || top.kind !== "deckdiff") return;
  top[inp.dataset.dd] = inp.value;
  top.dirty = !!top.res;
  saveDeckDiff(top);
  const hint = document.querySelector ? document.querySelector("[data-dd-dirty]") : null;
  if (hint && hint.classList) hint.classList.toggle("show", top.dirty);
});

/* Enter 直接对比：长分享码粘贴后不用再挪去点按钮 */
document.addEventListener("keydown", ev => {
  if (ev.key !== "Enter") return;
  const inp = ev.target.closest ? ev.target.closest("[data-dd]") : null;
  if (!inp) return;
  const top = topView();
  if (!top || top.kind !== "deckdiff") return;
  ev.preventDefault();
  runDeckDiff(top);
  renderOverlay();
});

export { COMPARE_MAX, compareState, comparePrefs, compareName, cmpBtnHtml, toggleCompare, syncCompareUI, renderCompareBar, fieldVal, compareFields, COMPARE_LABELS, compareData, compareRows, simMeta, simScore, similarCards, inCurrentDeck, swapCompare, renderSimilarSection, renderCompareView, showCompare, deckCodeNow, deckDist, diffDecks, deckHeadHtml, distTable, renderDeckDiffRes, deckDiffState, saveDeckDiff, runDeckDiff, swapDeckDiff, clearDeckDiff, renderDeckDiffView, focusDeckDiffInput, showDeckDiff };
