/* 85-views.ts —— 卡面 / 列表视图与卡库浏览：筛选、分面、分页、瓦片渲染。 */
import { R_STYLE, R_ZH, allReqs, depBadges, reqElement } from "./30-deps";
import { recordOfId, isCharId, nameCmp } from "./data/records";
import { $ } from "./core/dom";
import { safeReplaceState } from "./core/history";
import { CAT_ORDER, clearBrowseFilters, corpusKey, descSnippet, hlText, loadRecent, nearNames, resultTypeLabel, searchCards, searchState, toggleSearchScope } from "./70-search";
import { termEntries } from "./40-concepts";
import { MECHS, mechLabel, mechMaskOf } from "./44-mechs";
import { POOL_TYPE_ORDER, pool, poolStats, poolVersion, verCmp } from "./45-pool";
import { activeDeck, copyLimit, draft, draftAdd, isCore, toggleCore } from "./80-deck";
import { dataReady } from "./20-data";
import { openTermName, showDetail } from "./90-detail";
import { state } from "./data/state";
import { STORAGE_KEYS, imgFull, ELE_ZH, ELE_COLOR, ENERGY_ICON, ELE_ICONS, eleIcon, enPips, ICON_PLUS, ICON_STAR } from "./core/resources";
import { favs, isFav, toggleFav } from "./45-pool";
import { rcStripHtml } from "./46-recent";
import { esc } from "./core/dom";
import type { PoolEntry, SearchHit } from "./types";
import { TYPE_ZH, cardArtHtml } from "./data/model";
import { costHtml, costText } from "./30-deps";
import { linkify } from "./40-concepts";
import { KIND_ZH } from "./50-backlinks";
import { HOT_WORDS, browseActive, inputHint, matchChip, scopeRow } from "./70-search";
import { cmpBtnHtml } from "./88-compare";

/* ---------- 概览条（含费用曲线 / 充能 / 限制统计） ---------- */
function renderSummary() {
  const typeCounts = state.current!.order.map(t => `${t} <b>${state.current!.groups[t].reduce((a, x) => a + x.count, 0)}</b>`).join("　·　");
  const elesHtml = [...new Set(state.current!.chars.map(c => c.element).filter(Boolean))]
    .map(el => `${eleIcon(el)}${esc(ELE_ZH[el] || el)}`).join(" / ");
  const vers = [...new Set([...state.current!.chars.map(c => c.since), ...state.current!.order.flatMap(t => state.current!.groups[t].map(x => x.since))])].filter(Boolean).sort();

  /* 费用曲线（按张数计重）：元素骰 0~4 / 5+ */
  const buckets = Array(6).fill(0);
  let enCards = 0, enMax = 0, enTotal = 0, rCards = 0, dCards = 0;
  const rCount = {}, dCount = {};
  for (const t of state.current!.order) for (const x of state.current!.groups[t]) {
    buckets[Math.min(x.dice, 5)] += x.count;
    if (x.energy) { enCards += x.count; enMax = Math.max(enMax, x.energy); enTotal += x.energy * x.count; }
    for (const r of x.restrictions) { rCount[r.code] = (rCount[r.code] || 0) + x.count; rCards += x.count; }
    for (const r of x.deckReqs || []) { dCount[r.code] = (dCount[r.code] || 0) + x.count; dCards += x.count; }
  }
  const maxB = Math.max(...buckets, 1);
  const curve = `<div class="curve" title="元素骰费用分布（0~4 / 5+，按张数计重）；点击柱条在卡面视图中定位该费用的卡">${buckets.map((n, i) => `
    <div class="cbar"${n ? ` data-odds="${i}" title="元素骰费用 ${i === 5 ? "5+" : i}：${n} 张——点击在下方定位"` : ""}>
      <span class="cnum">${n || ""}</span>
      <div class="cfill" style="height:${Math.round(n / maxB * 100)}%"></div>
      <span class="clabel">${i === 5 ? "5+" : i}</span>
    </div>`).join("")}<span class="ctitle">元素骰费用曲线</span></div>`;

  const energyChip = enCards
    ? `<span class="en-inline">${ENERGY_ICON}<span>充能费用：<b>${enCards}</b> 张 / 累计 <b>${enTotal}</b> 点（单卡最高 ${enMax}）</span></span>` : "";
  /* 依赖统计分两组：牌组限制（构筑门槛）/ 打出限制（对局中生效）。点击 chips 过滤列表 */
  const reqChips = (label, counts, total) => total
    ? `<span>${label}：<b>${total}</b> 张（${Object.entries(counts).map(([k, v]) => `<a class="rl" data-filter="${R_ZH[k]}" title="在列表视图中筛出这些卡">${R_ZH[k]} ${v}</a>`).join(" / ")}）</span>` : "";
  const rChips = reqChips("牌组限制", dCount, dCards) + reqChips("打出限制", rCount, rCards);
  /* 核心牌清单：活动牌组的 core 标记 → 有几张、几张仅 1 张（确定性提醒，非概率） */
  const coreIds = activeDeck()?.core || [];
  const coreN = coreIds.length;
  const coreSingles = coreIds.filter(id => (draft.cards.get(id) || 0) <= 1)
    .slice(0, 3).map(id => recordOfId(id)?.name || `#${id}`);
  const coreChip = coreN
    ? `<span>核心牌：<b>${coreN}</b> 张${coreSingles.length ? `（仅 1 张：${coreSingles.map(esc).join("、")}${coreIds.filter(id => (draft.cards.get(id) || 0) <= 1).length > 3 ? "…" : ""}）` : "（均已 2 张）"}</span>`
    : "";

  $("summary").innerHTML = `
    <div class="sum-chars">${state.current!.chars.map(c => `
      <span class="chip"><span class="edot" style="--ec:${ELE_COLOR[c.element || ""] || "var(--faint)"}">${ELE_ICONS[c.element || ""] || ""}</span>${esc(c.name)}<small class="chip-en">${enPips(c.energy || 0)}</small></span>`).join("")}
    </div>
    <div class="sum-types"><span>元素构成：<b>${elesHtml}</b></span><span>${typeCounts}</span><span>版本跨度：<b>${esc(vers.join(" ~ "))}</b></span></div>
    <div class="sum-extra">${energyChip}${rChips}${coreChip}</div>
    ${curve}`;
}
/* 核心牌标记：捕获阶段拦截，stopPropagation 让 90-detail 的行点击（bubble）不触发 */
document.addEventListener("click", ev => {
  const b = (ev.target as HTMLElement).closest("[data-core]") as HTMLElement | null;
  if (!b) return;
  ev.stopPropagation();
  ev.preventDefault();
  const on = toggleCore(Number(b.dataset.core));
  b.classList.toggle("on", on);
  b.title = on ? "取消核心牌（概览条列出「仅 1 张」提醒，随导出携带）" : "标记为核心牌（概览条列出「仅 1 张」提醒，随导出携带）";
  renderSummary();
}, true);
/* 点击概览中的限制统计 → 跳到列表视图并过滤；
   点击费用柱条 → 卡面视图高亮该费用的卡并滚到第一张（再点同桶取消）。
   概览条只在卡面视图显示，所以定位目标就是 #view-grid 里的 .tile。 */
let oddsHit = -1;
function clearOddsHit(): void {
  document.querySelectorAll(".cost-hit").forEach(el => el.classList.remove("cost-hit"));
}
$("summary").addEventListener("click", ev => {
  const bar = (ev.target as HTMLElement).closest("[data-odds]") as HTMLElement | null;
  if (bar) {
    const b = Number(bar.dataset.odds);
    const same = b === oddsHit;
    clearOddsHit();
    oddsHit = same ? -1 : b;
    if (same) return;
    const diceOf = new Map(state.current
      ? state.current.order.flatMap(t => state.current!.groups[t].map(x => [x.id, x.dice] as [number, number]))
      : []);
    const match = (d: number) => (b === 5 ? d >= 5 : d === b);
    let first: HTMLElement | null = null;
    for (const el of document.querySelectorAll("#view-grid .tile")) {
      const d = diceOf.get(Number((el as HTMLElement).dataset.id));
      if (d != null && match(d)) {
        el.classList.add("cost-hit");
        if (!first) first = el as HTMLElement;
      }
    }
    first?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const a = (ev.target as HTMLElement).closest("[data-filter]");
  if (!a) return;
  listFilter = a.dataset.filter || "";
  (document.querySelector('.tab[data-view="list"]') as HTMLElement | null)?.click();
  renderList();
});

/* ---------- 卡面视图 ---------- */
function tileHtml(x) {
  const badges = depBadges(allReqs(x));
  const rel = x.related ? `${esc(x.related)}·天赋` : "";
  const en = x.energy ? ` <span class="en-mark" title="充能 ${x.energy}">${ENERGY_ICON}${x.energy}</span>` : "";
  return `<div class="tile" data-id="${x.id}">
    <div class="imgbox">${cardArtHtml(x.id, { kind: "tile", alt: x.name, cls: "card-img" })}
      <div class="badges">${badges}</div>
      ${x.count > 1 ? `<span class="cnt">×${x.count}</span>` : ""}
      <div class="capbar">${x.element ? eleIcon(x.element, "inline-el") : ""}${esc(x.name)}${en}${rel ? `<small>${rel}</small>` : ""}</div></div></div>`;
}
function renderGrid() {
  clearOddsHit(); oddsHit = -1;   /* 重渲染后旧的高亮引用已失效，一并复位 */
  if (!state.current) {
    $("view-grid").innerHTML = `<div class="empty-hint">尚未解析牌组<br><small>粘贴分享码后自动解析；也可以先回「卡库浏览」筛选检索，或用「牌组工具 → 加载示例牌组」</small></div>`;
    return;
  }
  $("view-grid").innerHTML = `<div class="sec-title">角色牌</div>
    <div class="char-row">${state.current!.chars.map(c => `
      <div class="char-card"><div class="imgbox" data-id="${c.id}">
        <img class="card-img" src="${imgFull(c.id)}" decoding="async" width="420" height="720" alt="${esc(c.name)}">
        <span class="el-badge" style="background:${ELE_COLOR[c.element] || "var(--faint)"}"><span class="badge-ico">${ELE_ICONS[c.element] || ""}</span>${ELE_ZH[c.element] || c.element}</span>
        <span class="en-badge">${enPips(c.energy || 0)}</span>
      </div>
      <div class="cap">${esc(c.name)}<small>生命 ${c.hp} · 充能 ${c.energy} · ${esc(c.since || "")}</small></div></div>`).join("")}
    </div>` +
    state.current!.order.map(t => `<div class="sec-title">${t}（${state.current!.groups[t].reduce((a, x) => a + x.count, 0)}）</div>
      <div class="card-grid">${state.current!.groups[t].map(tileHtml).join("")}</div>`).join("");
}

/* ---------- 列表视图（含限制列 + 表头排序） ---------- */
let listFilter = "";

/** 设置列表筛选词（输入框与测试都经这里，避免直接改模块内部变量）。 */
export function setListFilter(v: string): void {
  listFilter = v;
}
let listSort = { key: "count", dir: -1 };
const sortVal = {
  count: x => x.count,
  name: x => x.name,
  cost: x => x.dice * 100 + x.energy,
  since: x => parseFloat(String(x.since || "0").replace("v", "")) || 0,
};
function renderList() {
  if (!state.current) {
    $("view-list").innerHTML = `<div class="empty-hint">尚未解析牌组<br><small>解析分享码后，这里以表格形式展示全部卡牌与效果</small></div>`;
    return;
  }
  const f = listFilter.trim().toLowerCase();
  /* 筛选命中范围含依赖的 code / 中文类别（概览条按限制统计点击过滤时传 R_ZH 文本） */
  const match = x => !f || [x.name, x.related, x.type, ...(x.tags || []),
    ...allReqs(x).map(r => r.label + " " + r.short + " " + r.code + " " + (R_ZH[r.code] || "")), x.effect].join(" ").toLowerCase().includes(f);
  const arrow = k => listSort.key === k ? (listSort.dir < 0 ? " ▾" : " ▴") : "";
  /* 依赖限制 pill：deckEl 的元素前缀改用矢量图标，颜色仍取元素色 */
  const reqPill = r => {
    const el = reqElement(r);
    const col = el ? (ELE_COLOR[el] || "var(--gold)") : R_STYLE[r.code];
    return `<span class="rpill" style="color:${col}" title="${esc(r.label)}">${el ? eleIcon(el, "inline-el") : ""}${esc(r.short)}</span>`;
  };
  const rows = t => state.current!.groups[t].filter(match)
    .sort((a, b) => listSort.dir * (sortVal[listSort.key](a) < sortVal[listSort.key](b) ? -1 : sortVal[listSort.key](a) > sortVal[listSort.key](b) ? 1 : nameCmp(a.name, b.name)))
    .map(x => `<tr data-id="${x.id}">
    <td class="cnt">${x.count > 1 ? "×" + x.count : "1"}</td>
    <td>${x.element ? eleIcon(x.element, "inline-el") : ""}${esc(x.name)}<button class="corebtn${isCore(x.id) ? " on" : ""}" data-core="${x.id}" title="${isCore(x.id) ? "取消核心牌" : "标记为核心牌（概览条列出「仅 1 张」提醒，随导出携带）"}">核</button></td><td>${costHtml(x.playCost)}</td>
    <td>${allReqs(x).map(reqPill).join("") || '<span style="color:var(--faint)">—</span>'}</td>
    <td>${esc(x.related || "—")}</td><td>${esc(x.since || "—")}</td>
    <td class="desc">${linkify(esc(x.effect))}</td></tr>`).join("");
  const sections = state.current!.order.map(t => {
    if (!state.current!.groups[t].some(match)) return "";
    return `<div class="sec-title">${t}</div><div class="table-wrap"><table>
      <tr>
        <th class="sortable" data-key="count">数量${arrow("count")}</th>
        <th class="sortable" data-key="name">名称${arrow("name")}</th>
        <th class="sortable" data-key="cost">费用${arrow("cost")}</th>
        <th>依赖限制</th>
        <th>关联角色</th>
        <th class="sortable" data-key="since">版本${arrow("since")}</th>
        <th>效果</th></tr>
      ${rows(t)}</table></div>`;
  }).join("");
  $("view-list").innerHTML = `
    <div class="list-tools"><input id="listSearch" placeholder="筛选：名称 / 限制 / 标签 / 效果关键词…" value="${esc(listFilter)}">
      <span class="hint">点击行看详情 · 点表头排序 · 快捷键 1/2 切视图 · / 聚焦筛选 · Ctrl+P 打印</span></div>` +
    (sections || `<div class="empty-hint slim">无匹配卡牌</div>`);
  $("listSearch").addEventListener("input", e => {
    listFilter = (e.target as HTMLInputElement).value;
    const p = (e.target as HTMLInputElement).selectionStart;
    renderList();
    const n = $<HTMLInputElement>("listSearch");
    n.focus(); n.setSelectionRange(p || 0, p || 0);
  });
  document.querySelectorAll("#view-list th.sortable").forEach(th => th.addEventListener("click", () => {
    const k = th.dataset.key || "";
    listSort = { key: k, dir: listSort.key === k ? -listSort.dir : (k === "name" ? 1 : -1) };
    renderList();
  }));
}

/* ---------- 卡库检索结果（第一阶段筛选 → 第二阶段关键词） ---------- */
function hlName(s) { return hlText(s, searchState.q); }

function searchTile(r) {
  if (r.kind === "concept") {
    /* 技能命中：带所属牌面的技能瓦片（概念命中里唯一有「页面」的一类，
       费用/所属/牌面都在技能页里）——不再渲染成无脸的概念文字块 */
    if (r.ckind === "skill") {
      const entry = termEntries(r.name).find(e => e.kind === "skill");
      if (entry) {
        const meta = `${entry.type || "技能"}${entry.owner ? ` · ${entry.owner}` : ""}`;
        return `<div class="tile stile" data-term="${esc(r.name)}" title="点击查看技能">
          <div class="imgbox">${entry.artId != null ? cardArtHtml(entry.artId, { kind: "tile", alt: r.name }) : `<div class="cbox"><span>${esc(entry.type || "技能")}</span></div>`}</div>
          <div class="tname">${hlName(r.name)}</div>
          <div class="tmeta">${esc(meta)} ${matchChip(r)}</div>
          ${r.match === "desc" && r.descText ? `<div class="tsnip">${descSnippet(r.descText, searchState.q) || ""}</div>` : ""}</div>`;
      }
    }
    /* 用行上携带的具体种类（ckind），而不是词条列表首项——
       首项可能是同名的卡牌/角色条目，会把"术语"错标成"卡牌" */
    const k = r.ckind || termEntries(r.name).find(e => e.kind !== "card" && e.kind !== "char")?.kind || "keyword";
    return `<div class="tile stile" data-term="${esc(r.name)}" title="点击查看概念解释">
      <div class="cbox"><span>${esc(KIND_ZH[k] || "概念")}</span></div>
      <div class="tname">${hlName(r.name)}</div>
      <div class="tmeta">${esc(KIND_ZH[k] || "概念")} ${matchChip(r)}</div>
      ${r.match === "desc" && r.descText ? `<div class="tsnip">${descSnippet(r.descText, searchState.q) || ""}</div>` : ""}</div>`;
  }
  const isChar = r.kind === "char";
  /* kind 为角色/卡牌时 id 必定存在（概念命中走上面分支），这里取到的是原始记录 */
  const raw = recordOfId(r.id!);
  if (!raw) return "";   /* 数据里出现检索命中但卡池缺记录：宁可空着也不渲染半张卡 */
  const ele = raw.stats.element;
  const meta = isChar ? `${eleIcon(ele)} ${ELE_ZH[ele] || ele} · 生命 ${raw.stats.hp} · 充能 ${raw.stats.maxEnergy}`
    : `${ele ? eleIcon(ele) + " · " : ""}${esc(raw.typeZh)}${costText(raw.stats.cost) ? " · " + esc(costText(raw.stats.cost)) : ""}`;
  /* 依赖徽标：与卡面/卡库同一套渲染（牌组限制 + 打出限制） */
  const badges = isChar ? "" : depBadges([...raw.reqs.deck, ...raw.reqs.play]);
  /* 不可构筑原因区分：对局实体（状态/召唤物）vs 历史版本变体 */
  const noShareWarn = r.noShare
    ? (raw.domain === "field"
      ? `<span class="vwarn" title="对局中生成的实体，不可加入构筑">实体</span>`
      : `<span class="vwarn" title="历史版本变体，不可加入构筑">变体</span>`)
    : "";
  const qty = isChar ? 0 : (draft.cards.get(r.id) || 0);
  const qtyBadge = qty ? `<span class="qcnt${qty >= copyLimit(r.id) ? " max" : ""}" title="当前牌组已加入 ${qty}/${copyLimit(r.id)} 张">×${qty}</span>` : "";
  return `<div class="tile stile" data-id="${r.id}" title="点击查看详情">
    <div class="imgbox">${cardArtHtml(r.id, { kind: "tile", alt: raw.name })}
      ${badges ? `<div class="badges">${badges}</div>` : ""}${qtyBadge}${cmpBtnHtml(r.id)}</div>
    <div class="tname">${hlName(r.name)}${noShareWarn}</div>
    <div class="tmeta">${meta} ${matchChip(r)}</div>
    ${r.match === "desc" && r.descText ? `<div class="tsnip">${descSnippet(r.descText, searchState.q) || ""}</div>` : ""}
    ${r.noShare ? "" : `<button class="addbtn" data-add="${r.id}" title="加入当前牌组">${ICON_PLUS}</button>`}</div>`;
}
/* 检索结果 HTML：结果已经在第二阶段按当前卡库子集算好（searchState.results） */
function browseSearchResultsHtml() {
  const st = searchState;
  if (!st.results.length) {
    const near = nearNames(st.q, 6);
    const recent = loadRecent();
    return `${scopeRow()}<div class="search-empty">
      <div>未找到与“${esc(st.q)}”匹配的内容${browseActive() ? "（当前卡库筛选已生效）" : ""}</div>
      ${near.length ? `<div class="near-title">最接近的名字</div>
        <div class="hotrow">${near.map(x => `<button class="fchip" data-q="${esc(x.name)}">${esc(x.name)}</button>`).join("")}</div>` : ""}
      <div class="near-title">换个说法试试</div>
      <div class="hotrow">${HOT_WORDS.slice(0, 6).map(h => `<button class="fchip" data-q="${h}">${h}</button>`).join("")}</div>
      ${recent.length ? `<div class="hotrow">${recent.map(h => `<button class="fchip" data-q="${esc(h)}" title="最近搜索">${esc(h)}</button>`).join("")}</div>` : ""}
      <small>${inputHint()}</small></div>`;
  }
  const shown = st.results.filter(r => !st.filter || resultTypeLabel(r) === st.filter);
  const nOf = c => st.results.filter(r => resultTypeLabel(r) === c).length;
  const cats = ["全部", ...CAT_ORDER.filter(c => nOf(c) > 0)]
    .map(c => { const n = c === "全部" ? st.results.length : nOf(c); return `<button class="fchip${st.filter === (c === "全部" ? "" : c) ? " on" : ""}" data-f="${c === "全部" ? "" : esc(c)}">${c} <b>${n}</b></button>`; }).join("");
  /* 行动牌里把「不可构筑」的（对局实体 / 历史变体）拆出去，默认折叠——
     检索也是用来找构筑组件的，让状态牌和召唤物混在行动牌里只会稀释结果 */
  const cards = shown.filter(r => r.kind === "card");
  const buildCards = cards.filter(r => r.buildable !== false);
  const otherCards = cards.filter(r => r.buildable === false);
  /* 「显示不可构筑」是全局开关：打开时检索结果也平铺，不再折叠 */
  const groups: Array<[string, SearchHit[]]> = ([
    ["角色", shown.filter(r => r.kind === "char")],
    ["行动牌", showUnbuildable ? cards : buildCards],
    ["技能", shown.filter(r => r.kind === "concept" && r.ckind === "skill")],
    ["概念", shown.filter(r => r.kind === "concept" && r.ckind !== "skill")],
  ] as Array<[string, SearchHit[]]>).filter(([, list]) => list.length);
  const otherBlock = !showUnbuildable && otherCards.length ? `<div class="nbgroup${nbOpen.search ? " open" : ""}">
      <button class="nbhead" data-nb="search" aria-expanded="${nbOpen.search}">
        <span class="nbmark" aria-hidden="true">${nbOpen.search ? "▾" : "▸"}</span>
        <b>对局实体与历史变体</b><span class="nbn">${otherCards.length}</span>
        <small>命中但不可加入牌组（对局中生成 / 旧版本变体）</small>
        <span class="nbact">${nbOpen.search ? "收起" : "展开"}</span>
      </button>
      ${nbOpen.search ? `<div class="card-grid">${otherCards.map(searchTile).join("")}</div>` : ""}
    </div>` : "";
  const fuzzyN = st.results.filter(r => ["pinyin", "initials", "fuzzy"].includes(r.match)).length;
  const descN = st.results.filter(r => r.match === "desc").length;
  const breakdown = [fuzzyN ? `拼音/模糊 ${fuzzyN}` : "", descN ? `释义 ${descN}` : ""].filter(Boolean).join(" · ");
  return `
    ${scopeRow()}
    <div class="search-head"><span>“${esc(st.q)}” 命中 <b>${st.results.length}</b> 条${st.results.length >= 90 ? "（已截断，请细化关键词）" : ""}${breakdown ? `　<small class="sbreak">其中 ${breakdown}</small>` : ""}</span>
      <div class="fchips">${cats}</div></div>
    ${groups.map(([t, list]) => `<div class="sec-title">${t} <small>${list.length}</small></div>
      <div class="card-grid">${list.map(searchTile).join("")}</div>`).join("")}
    ${otherBlock}
    ${shown.length ? "" : `<div class="empty-hint slim">该分类下无匹配结果</div>`}`;
}

/* ---------- 卡库浏览：多维筛选 / 排序 / 分片渲染 ----------
   筛选维度由下方 FILTER_DIMS 注册表驱动（类别 / 元素 / 骰子费用 / 充能 / 标签 /
   机制 / 版本）。计数为 facet 计数：每个可选值按"其余维度全部生效"统计，
   点进去不会把人带向空结果。 */
/** 卡库筛选状态：筛选维度 + 排序。u（是否显示不可构筑）是全局开关，不在这里。 */
type FilterKey = "type" | "el" | "cost" | "energy" | "tag" | "mech" | "ver";
interface BrowseState { type: string; el: string; cost: string; energy: string; tag: string; mech: string; ver: string; sort: string; dir: number }
/* ---------- 筛选维度注册表 ----------
   每个维度的全部行为都由这张表驱动：取值、放行判定、分面计数、hash 编解码、
   展开态行渲染、已激活 chips 标签。新增维度 = 表里加一条 + BrowseState 加一个键，
   不再往十来处 if 链里各插一刀。
   · value：单值维度。返回 null 表示「该条没有这个属性」（角色没有骰子费用 /
     充能 / 机制文本），激活该维度时这类条目一律不匹配——这正是既有行为。
   · values：多值维度（标签），一条卡可同时命中多个值，分面逐值累加。
   · double：分面按「可构筑 / 不可构筑」双计数（type / tag 这类实体也可能有的维度）。
   · row：定制行渲染（版本用下拉）；缺省走默认 chips 行。
   · vals：行内可选值的枚举顺序；缺省按分面键。 */
interface FilterDim {
  key: FilterKey;
  letter: string;                          /* hash 参数字母（#b=t=…,e=…） */
  label: string;                           /* 展开态行标签 */
  value?: (x: PoolEntry) => string | null;
  values?: (x: PoolEntry) => string[];
  double?: boolean;
  allCount?: "sum";                        /* 「全部」chip 显示分面合计 */
  vals?: (facets: Facets) => string[];
  chipLabel?: (v: string) => string;
  chipActive?: (v: string) => string;
  allTitle?: string;                       /* 「全部」chip 的悬浮说明 */
  row?: (st: BrowseState, facets: Facets) => string;
}
const FILTER_DIMS: FilterDim[] = [
  {
    key: "type", letter: "t", label: "类别", double: true, allCount: "sum",
    value: x => x.typeRaw,
    vals: () => POOL_TYPE_ORDER.filter(t => poolStats.byType[t]),
    chipLabel: v => TYPE_ZH[v] || v,
    chipActive: v => TYPE_ZH[v] || v,
    allTitle: "可构筑 / 对局实体与历史变体（后者默认折叠，可用右侧开关平铺）",
  },
  {
    key: "el", letter: "e", label: "元素", allCount: "sum",
    value: x => x.element || null,
    vals: f => Object.keys(ELE_ZH).filter(e => fcn(f.el, e)),
    chipLabel: v => eleIcon(v) + ELE_ZH[v],
    allTitle: "按角色元素筛选（含其天赋牌）",
  },
  {
    key: "cost", letter: "c", label: "骰子费用",
    value: x => (x.kind === "char" ? null : String(Math.min(x.dice, 5))),
    vals: f => ["0", "1", "2", "3", "4", "5"].filter(k => fcn(f.cost, k)),
    chipLabel: v => (v === "5" ? "5+" : v),
    chipActive: v => "骰子 " + (v === "5" ? "5+" : v),
  },
  {
    key: "energy", letter: "n", label: "充能",
    value: x => (x.kind === "char" ? null : (x.energyCost > 0 ? String(x.energyCost) : "0")),
    vals: f => Object.keys(f.energy).sort(),
    chipLabel: v => (v === "0" ? "无充能" : ENERGY_ICON + v),
    chipActive: v => (v === "0" ? "无充能" : ENERGY_ICON + v),
  },
  {
    key: "tag", letter: "g", label: "标签", double: true,
    values: x => x.tags.filter((t): t is string => !!t),
    vals: f => Object.entries(f.tag).sort((a, b) => b[1].n - a[1].n).map(([t]) => t),
  },
  {
    key: "mech", letter: "m", label: "机制", double: true,
    /* 机制是多值维度：一张卡可同时命中多个机制；角色无效果文本，恒不命中
       （机制激活时角色牌整体不出现在结果里） */
    values: x => {
      const mask = mechMaskOf(x.id);
      return MECHS.filter((_, i) => mask & (1 << i)).map(m => m.key);
    },
    vals: f => MECHS.filter(m => fcn(f.mech, m.key)).map(m => m.key),
    chipLabel: v => mechLabel(v),
    allTitle: "按效果文本归类的高频机制（curated 正则；角色牌不参与此维度）",
  },
  {
    key: "ver", letter: "v", label: "版本", row: (st, facets) => verRow(st),
    value: x => x.ver || null,
  },
];
/* 清空全部筛选维度（不动排序方向）。检索「范围」按钮与重置按钮共用。 */
function emptyBrowseFilters(): Pick<BrowseState, FilterKey> {
  return { type: "", el: "", cost: "", energy: "", tag: "", mech: "", ver: "" };
}
const browseState: BrowseState = { ...emptyBrowseFilters(), sort: "name", dir: 1 };
const BROWSE_DIMS: FacetDim[] = FILTER_DIMS.map(d => d.key) as FacetDim[];   /* 兼容旧名（键数组视图） */
/* 每页 40 张：一次插入 60 张带图片的瓦片本身就是一次 50ms 级的长任务，
   拆小后每次追加更短，滚动时不至于被"补货"卡住一帧以上。 */
const BROWSE_PAGE = 40;
/* 视口上下各保留 4 页（≈160 张）瓦片实例：再远的页清空内容只留等高占位（见 pagerSweep） */
const PAGE_KEEP = 4;
/* 两个分页网格的运行时状态（主网格 / 折叠分组） */
/** 分页网格：按页挂载 / 卸载，视口外整页移除，避免 1480 张卡同时驻留 DOM。 */
interface PagerPageRec { el: HTMLElement; h: number; filled: boolean }
interface Pager {
  grid: HTMLElement;
  sentinel: HTMLElement | null;
  items: PoolEntry[];
  tileFn: (x: PoolEntry, inGroup: boolean) => string;
  tag: string;
  pages: PagerPageRec[];
  gridTop: number | null;
  offsets: number[] | null;
}
let bPager: Pager | null = null, nbPager: Pager | null = null;
/* 视口尺寸：测试与 SSR 环境没有 window/innerHeight，统一从这里取，避免各处 try */
function viewH() { try { return window.innerHeight || innerHeight || 800; } catch (e) { return 800; } }
function viewTop() { try { return window.scrollY || window.pageYOffset || 0; } catch (e) { return 0; } }
function passFilter(x, st) {
  for (const d of FILTER_DIMS) {
    const v = st[d.key];
    if (!v) continue;
    if (d.values) {
      if (!d.values(x).includes(v)) return false;
      continue;
    }
    const k = d.value!(x);
    if (k === null || k !== v) return false;
  }
  return true;
}
function browseCmp(a, b, key, dir) {
  if (key === "name") return dir * nameCmp(a.name, b.name);   /* 数据层字典序索引：引号牌名按正文排序 */
  if (key === "id") return dir * (a.id - b.id);
  if (key === "ver") return dir * (verCmp(a.ver, b.ver) || nameCmp(a.name, b.name));
  /* cost：角色无骰子费用，按费用排序时固定沉到一端（升序在顶） */
  const va = a.kind === "char" ? -1 : a.dice * 100 + a.energyCost;
  const vb = b.kind === "char" ? -1 : b.dice * 100 + b.energyCost;
  return dir * (va - vb) || nameCmp(a.name, b.name);
}
/* ---------- 筛选结果 / 分面计数 / 分组：按筛选状态记忆 ----------
   一次筛选只该算一次。滚动追加、计数刷新、翻页上下文、加牌后的徽标同步都会回头
   要这份数据，1480 条的 filter + localeCompare 排序在滚动路径上重复跑就是白烧帧。
   key 里带 poolVersion：数据刷新重建卡池后自动失效。 */
/* 按「筛选状态 + 卡池版本」记忆结果：翻页/重渲染时不必重算 1480 条。
   data 的具体形状随用途不同（分面计数 / 可构筑拆分），因此用 unknown 并在取用处收窄。 */
type FacetCell = { b: number; o: number; n: number };
type FacetDim = "type" | "el" | "cost" | "energy" | "tag" | "mech" | "ver";
type Facets = Record<FacetDim, Record<string, FacetCell>>;
interface BrowseSplit { all: PoolEntry[]; build: PoolEntry[]; other: PoolEntry[] }
const _browseMemo: {
  filter: { key: string; list: PoolEntry[] | null };
  facets: { key: string; data: Facets | null };
  split: { key: string; data: BrowseSplit | null };
} = { filter: { key: "", list: null }, facets: { key: "", data: null }, split: { key: "", data: null } };
function browseStateKey(st = browseState) {
  return FILTER_DIMS.map(d => st[d.key]).concat([st.sort, String(st.dir)]).join("\u0001")
    + "@" + poolVersion + (showFavsOnly ? "|f" : "");
}
function browseFilter(st = browseState): PoolEntry[] {
  const key = browseStateKey(st);
  if (_browseMemo.filter.key === key) return _browseMemo.filter.list || [];
  const list = pool.filter(x => passFilter(x, st) && (!showFavsOnly || favs.has(x.id))).sort((a, b) => browseCmp(a, b, st.sort, st.dir));
  _browseMemo.filter = { key, list };
  return list;
}
/* ---------- 可构筑 / 不可构筑：卡库的分组 ----------
   判据只有「有没有分享 id」（构建期写进 record.share），不按类型再猜一次。
   卡库的用途是找构筑组件，把 800 多个对局实体（状态/召唤物/队伍状态）与历史
   变体混排进来，真正能用的 600 多张会被淹掉——所以默认只列可构筑的，
   其余收进折叠分组；需要查实体数据时展开即可，展开状态记在本地。 */
const isBuildableEntry = x => x.share != null;
/* 全局开关：不可构筑项直接平铺在卡库里，而不是收进折叠分组。
   与「展开分组」是两种意图——分组是"顺手查一条实体"，开关是"我要看全库"。 */
let showUnbuildable = false;
try { showUnbuildable = localStorage.getItem(STORAGE_KEYS.browseUnbuildable) === "1"; } catch (e) {}
/* persist=false：分享链接带来的视图只改当前这一屏，不覆盖本机默认偏好——
   否则点开别人的链接会悄悄改掉自己的习惯 */
function setShowUnbuildable(v: boolean, persist = true) {
  showUnbuildable = !!v;
  if (persist === false) return;
  try { localStorage.setItem(STORAGE_KEYS.browseUnbuildable, showUnbuildable ? "1" : "0"); } catch (e) {}
}
/* 收藏过滤：只看星标的卡。不落本机偏好（忘关会以为卡丢了），只随分享链接走（f=1）。 */
let showFavsOnly = false;
function setShowFavsOnly(v: boolean) { showFavsOnly = !!v; }
const nbOpen = { browse: false, search: false };
try { nbOpen.browse = localStorage.getItem(STORAGE_KEYS.browseOther) === "1"; } catch (e) {}
function browseSplit(st = browseState): BrowseSplit {
  const key = browseStateKey(st);
  if (_browseMemo.split.key === key) return _browseMemo.split.data!;
  const all = browseFilter(st), build: PoolEntry[] = [], other: PoolEntry[] = [];
  for (const x of all) (isBuildableEntry(x) ? build : other).push(x);
  const data = { all, build, other };
  _browseMemo.split = { key, data };
  return data;
}
/* 折叠分组（卡库与检索共用同一套外观）：标题里给数量与"为什么折叠" */
function otherGroupHtml(list, open) {
  if (!list.length) return "";
  return `<div class="nbgroup${open ? " open" : ""}" id="nbgroup">
    <button class="nbhead" data-nb="browse" aria-expanded="${open}">
      <span class="nbmark" aria-hidden="true">${open ? "▾" : "▸"}</span>
      <b>对局实体与历史变体</b><span class="nbn">${list.length}</span>
      <small>由技能或卡牌效果在对局中生成，或为旧版本变体，不能加入牌组</small>
      <span class="nbact">${open ? "收起" : "展开"}</span>
    </button>
    ${open ? `<div class="card-grid" id="nbg"></div><div class="bsentinel" id="nbsentinel"></div>` : ""}
  </div>`;
}
/* facet 计数：某维度的每个可选值，在"其余维度全部生效"下的命中数。
   注意：撤下某一维度要置为 ""（初始值）而不是 delete——passFilter 判 `!== ""`，
   undefined 会被当成激活的筛选项。
   每个格子区分可构筑 / 不可构筑：类型 chip 因此能直接说出「0 / 367」这种
   "这一类里没有能用的牌"的信息，而不是给一个看得见点进去全是实体的数字。 */
function facetCounts(st = browseState): Facets {
  const key = browseStateKey(st);
  if (_browseMemo.facets.key === key) return _browseMemo.facets.data!;
  const out: Facets = { type: {}, el: {}, cost: {}, energy: {}, tag: {}, mech: {}, ver: {} };
  const bump = (dim: FacetDim, k: string, build: boolean) => {
    const cell = out[dim][k] || (out[dim][k] = { b: 0, o: 0, n: 0 });
    if (build) cell.b++; else cell.o++;
    cell.n++;
  };
  for (const d of FILTER_DIMS) {
    const st2 = { ...st, [d.key]: "" };
    for (const x of pool) {
      if (!passFilter(x, st2)) continue;
      const build = isBuildableEntry(x);
      if (d.values) { for (const k of d.values(x)) if (k) bump(d.key as FacetDim, k, build); continue; }
      const k = d.value!(x);
      if (k != null) bump(d.key as FacetDim, k, build);
    }
  }
  _browseMemo.facets = { key, data: out };
  return out;
}
/* 分面格子取总数（兼容旧写法里把 facets.el[e] 当数字用） */
const fcn = (map, k) => (map && map[k] ? map[k].n : 0);
/* 筛选状态 ↔ hash（#b=t=GCG_CARD_EVENT,e=HYDO,c=2,...,u=1）便于分享当前视图。
   解析时容忍有无前导 #（init 传入的是剥掉 # 的串）。
   u=1 表示「显示不可构筑」开关打开；只有真正打开时才写，避免每条链接都拖一个 u=0。 */
function browseHash(st = browseState) {
  const p: string[] = [];
  for (const d of FILTER_DIMS) {
    const v = st[d.key];
    /* if (v) 而非 !== ""：容忍测试传入的缺维度部分状态（undefined 不入 hash） */
    if (v) p.push(d.letter + "=" + (d.key === "tag" ? encodeURIComponent(v) : v));
  }
  if (st.sort !== "name") p.push("s=" + st.sort);
  if (st.dir !== 1) p.push("d=-1");
  if (showUnbuildable) p.push("u=1");
  if (showFavsOnly) p.push("f=1");
  if (searchState.q) p.push("q=" + encodeURIComponent(searchState.q));
  return p.length ? "#b=" + p.join(",") : "";
}
/* u：链接里的开关状态；q：检索词（第二阶段）。hash 带 b= 时它就是这一屏的权威值
   （u 缺省 = 关闭；q 缺省 = 清空检索词），收到链接的人看到的就是分享者看到的那一屏。
   入参约定为「未整体解码」的原始 hash：各参数在下面各自解码一次（旧实现被
   routeHash 先整体解码过一次再传进来，参数又解码一次——q 里出现字面 % 就 URIError）。
   维度参数的字母由 FILTER_DIMS 的 letter 定义，解码按同一张表反查。 */
function parseBrowseHash(hash) {
  const st = { ...emptyBrowseFilters(), sort: "name", dir: 1, u: false, f: false, q: undefined as string | undefined };
  const byLetter = new Map(FILTER_DIMS.map(d => [d.letter, d]));
  const m = String(hash || "").match(/^#?b=(.*)$/);
  if (!m) return null;
  /* 畸形转义（%zz）按原样当值用：分享链接坏了不该炸路由 */
  const dec = (v: string) => { try { return decodeURIComponent(v); } catch (e) { return v; } };
  for (const kv of m[1].split(",")) {
    const i = kv.indexOf("=");
    if (i < 0) continue;
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    const d = byLetter.get(k);
    if (d) st[d.key] = d.key === "tag" ? dec(v) : v;
    else if (k === "s") st.sort = v;
    else if (k === "d") st.dir = -1;
    else if (k === "u") st.u = v === "1" || v === "on" || v === "true";
    else if (k === "f") st.f = v === "1" || v === "on" || v === "true";
    else if (k === "q") st.q = dec(v);
  }
  return st;
}
function syncBrowseHash() {
  const h = browseHash();
  /* 每敲一键检索都会 replace 一次：走安全封装，Safari 限速抛 SecurityError 时
     只丢一次地址栏同步，不中断 input 处理链 */
  safeReplaceState(null, h || location.pathname + location.search);
}
/* chip 计数：数字 = 只显示总数；{b,o} = 双计数（可构筑 / 不可构筑）。
   只有真存在不可构筑项时才出现第二种数字，否则 chip 会全长成一串「12/0」。 */
/* n 有两种形态：纯计数（number），或「可构筑 / 对局实体」双计数（{b,o}）。 */
function browseChip(group: string, val: string, label: string, n: number | { b: number; o: number } | null, active: boolean, title = "") {
  let cnt = "";
  if (n != null && typeof n === "object") {
    cnt = `<b>${n.b}</b>${n.o ? `<i class="fco" title="其中 ${n.o} 项是对局实体或历史变体，不可加入牌组">/${n.o}</i>` : ""}`;
  } else if (n != null) cnt = `<b>${n}</b>`;
  const zero = n != null && typeof n === "object" && !n.b && n.o ? " zb" : "";
  return `<button class="fchip${active ? " on" : ""}${zero}" data-bg="${group}" data-bv="${esc(String(val))}" title="${esc(title)}">${label}${cnt}</button>`;
}
const sumCells = (map?: Record<string, { b: number; o: number }>) =>
  Object.values(map || {}).reduce((a, c) => ({ b: a.b + c.b, o: a.o + c.o }), { b: 0, o: 0 });
function browseTile(x, inGroup) {
  const elCol = x.element ? ELE_COLOR[x.element] : "";
  const badges = depBadges(allReqs(x));
  const add = x.share != null ? `<button class="addbtn" data-add="${x.id}" title="加入当前牌组">${ICON_PLUS}</button>` : "";
  const qty = x.kind === "card" ? (draft.cards.get(x.id) || 0) : 0;
  const qtyBadge = qty ? `<span class="qcnt${qty >= copyLimit(x.id) ? " max" : ""}" title="当前牌组已加入 ${qty}/${copyLimit(x.id)} 张">×${qty}</span>` : "";
  const meta = x.kind === "char"
    ? `${eleIcon(x.element)} ${esc(ELE_ZH[x.element] || "")} · 生命 ${x.hp} · <span class="en-inline" title="充能 ${x.energy}">${ENERGY_ICON}${x.energy}</span>`
    : `${x.element ? eleIcon(x.element) + " · " : ""}${esc(x.type)}${costText(x.playCost) ? " · " + esc(costText(x.playCost)) : ""}${x.related ? " · " + esc(x.related) : ""}`;
  /* 在「对局实体与历史变体」分组里不再逐个标「不可构筑」——标题已说明；
     只有角色变体（类型看不出不可构筑）保留一个短标记 */
  const warn = x.share == null && (!inGroup || x.kind === "char")
    ? `<span class="vwarn" title="对局实体或历史版本变体，不可加入构筑">${inGroup ? "变体" : "不可构筑"}</span>` : "";
  return `<div class="tile stile btile" data-id="${x.id}" tabindex="0" title="点击查看详情">
    <div class="imgbox"${elCol ? ` style="border-left-color:${elCol}"` : ""}>
      ${cardArtHtml(x.id, { kind: "tile", alt: x.name })}
      <div class="badges">${badges}</div>${add}<button class="favbtn${isFav(x.id) ? " on" : ""}" data-fav="${x.id}" aria-pressed="${isFav(x.id)}" title="${isFav(x.id) ? "取消收藏" : "收藏"}">${ICON_STAR}</button>${qtyBadge}${cmpBtnHtml(x.id)}${isCore(x.id) ? '<span class="core-badge" title="当前牌组的核心牌">核</span>' : ""}</div>
    <div class="tname">${esc(x.name)}${warn}</div>
    <div class="tmeta">${meta}${x.ver ? " · " + esc(x.ver) : ""}</div></div>`;
}
/* 数量徽标就地更新：加牌 / 减牌后不重绘整页（会丢滚动位置），只改已渲染的瓦片 */
function syncTileQty() {
  const nodes = document.querySelectorAll(".tile[data-id]");
  for (const el of nodes) {
    const id = Number(el.dataset.id);
    const n = isCharId(id) ? 0 : (draft.cards.get(id) || 0);
    const box = el.querySelector(".imgbox");
    if (!box) continue;
    let b = box.querySelector(".qcnt") as HTMLElement | null;
    if (!n) { if (b) b.remove(); continue; }
    if (!b) {
      b = document.createElement("span");
      b.className = "qcnt";
      box.insertBefore(b, box.querySelector(".addbtn") || null);
    }
    b.textContent = "×" + n;
    b.title = `当前牌组已加入 ${n}/${copyLimit(id)} 张`;
    b.classList.toggle("max", n >= copyLimit(id));
  }
}
/* 筛选栏展开状态：默认折叠——排序与已激活筛选常驻（低门槛、高频），
   六维筛选收进「筛选」按钮（ Progressive Disclosure），选择记忆在本地 */
const BROWSE_EXP_KEY = STORAGE_KEYS.browseExpanded;
let browseExpanded = false;
try { browseExpanded = localStorage.getItem(BROWSE_EXP_KEY) === "1"; } catch (e) {}

/** 展开 / 收起多维筛选（按钮点击与测试都经这里）。 */
export function setBrowseExpanded(v: boolean): void {
  browseExpanded = v;
}
/* 已激活筛选 chips（折叠态展示，点击即移除该维度） */
function activeBrowseChips(st) {
  const chips: string[] = [];
  for (const d of FILTER_DIMS) {
    const v = st[d.key];
    if (v !== "") chips.push(browseChip(d.key, v, d.chipActive ? d.chipActive(v) : (d.chipLabel ? d.chipLabel(v) : v), null, true, "点击移除该筛选"));
  }
  return chips.join("");
}
/* 默认 chips 行：全部 + 注册表枚举的各值（计数来自分面） */
function dimChipRow(d: FilterDim, st: BrowseState, facets: Facets): string {
  const s = d.allCount === "sum" ? sumCells(facets[d.key]) : null;
  const allN = s == null ? null : (d.double ? s : s.b + s.o);
  const vals = d.vals ? d.vals(facets) : Object.keys(facets[d.key]);
  const row = browseChip(d.key, "", "全部", allN, st[d.key] === "", d.allTitle || "")
    + vals.map(v => browseChip(d.key, v, d.chipLabel ? d.chipLabel(v) : v, facets[d.key][v], st[d.key] === v,
      d.double ? "计数为「可构筑 / 不可构筑」" : "")).join("");
  return `<div class="bg-row"><span class="bg-label">${d.label}</span><div class="bg-chips">${row}</div></div>`;
}
function verRow(st: BrowseState): string {
  const verSel = `<select class="bg-sel" data-bg="ver" title="按版本筛选"><option value="">全部版本</option>` +
    poolStats.versions.map(v => `<option${st.ver === v ? " selected" : ""}>${esc(v)}</option>`).join("") + `</select>`;
  return `<div class="bg-row bg-ctrl"><span class="bg-label">版本</span>${verSel}</div>`;
}
function browseBarHtml(st: BrowseState, facets: Facets) {
  const sortSel = `<select class="bg-sel" data-bs="sort" title="排序方式">
      <option value="name"${st.sort === "name" ? " selected" : ""}>按名称</option>
      <option value="cost"${st.sort === "cost" ? " selected" : ""}>按费用</option>
      <option value="ver"${st.sort === "ver" ? " selected" : ""}>按版本</option>
      <option value="id"${st.sort === "id" ? " selected" : ""}>按编号</option></select>`;
  const dirBtn = `<button class="bg-dir" data-bdir="1" title="${st.dir < 0 ? "当前降序，点击升序" : "当前升序，点击降序"}">${st.dir < 0 ? "↑" : "↓"}</button>`;
  const activeCount = FILTER_DIMS.filter(d => st[d.key] !== "").length;
  const dirty = activeCount > 0 || st.sort !== "name" || st.dir !== 1;
  const toggle = `<button class="bg-toggle" data-btoggle="1" title="展开 / 收起多维筛选">${browseExpanded ? "收起筛选 ▴" : "筛选 ▾"}${activeCount ? `<b>${activeCount}</b>` : ""}</button>`;
  const reset = dirty ? `<button class="bg-reset" data-breset="1" title="清除全部筛选与排序">重置</button>` : "";
  /* 顶行（常驻）：筛选开关 + 已激活 chips（仅折叠态）+ 重置 + 排序 + 显示开关 + 计数 */
  const ubSwitch = `<button class="bg-sw${showUnbuildable ? " on" : ""}" data-bub="1" role="switch" aria-checked="${showUnbuildable}"
      title="把对局中生成的状态 / 召唤物与历史版本变体也平铺进来（默认收进底部分组）">显示不可构筑<i class="sw" aria-hidden="true"></i></button>`;
  const favSwitch = `<button class="bg-sw${showFavsOnly ? " on" : ""}" data-bfav="1" role="switch" aria-checked="${showFavsOnly}"
      title="只看收藏的卡牌（星标在卡块右上角与详情页）">${ICON_STAR} 收藏</button>`;
  const top = `<div class="bg-row bg-top">${toggle}
      ${browseExpanded ? "" : `<div class="bg-chips">${activeBrowseChips(st)}</div>`}
      ${reset}<span class="bg-label">排序</span>${sortSel}${dirBtn}${ubSwitch}${favSwitch}
      <span class="bg-count"></span></div>`;
  /* 展开态：注册表逐维出各行（激活态由 chip 高亮表示，无需再重复 chips） */
  const rows = browseExpanded ? FILTER_DIMS.map(d => (d.row ? d.row(st, facets) : dimChipRow(d, st, facets))).join("") : "";
  return `<div class="browse-bar">${top}${rows}</div>`;
}
/* 卡库检索框：与顶部牌组码输入框彻底分离；输入只作用于当前卡库子集 */
function browseSearchHtml() {
  return `<div class="browse-search">
    <div class="sugwrap">
      <input id="browseSearch" placeholder="在卡库中检索：卡牌名 / 角色名 / 术语 / 效果关键词…" spellcheck="false" autocomplete="off" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="suggest" aria-expanded="false" value="${esc(searchState.q)}">
      <div id="suggest" class="suggest" role="listbox" aria-label="检索建议"></div>
    </div>
    ${searchState.q ? `<button class="bg-reset" data-sclear="1" title="清空检索">清空</button>` : ""}
  </div>`;
}
function renderBrowse() {
  const st = browseState;
  const facets = facetCounts(st);
  $("view-browse").innerHTML = rcStripHtml() + browseSearchHtml() + browseBarHtml(st, facets) +
    `<div id="browseResults"></div>`;
  renderBrowseResults();
}
/* 结果区：筛选（阶段一）先收敛卡池，关键词（阶段二）只在该子集内检索 */
function renderBrowseResults() {
  const box = $("browseResults");
  if (!box) return;
  const split = browseSplit();
  bPager = null; nbPager = null;
  unobserveSentinel($("bsentinel")); unobserveSentinel($("nbsentinel"));
  if (searchState.q.trim()) {
    if (dataReady) {
      searchState.results = searchCards(searchState.q, { corpus: split.all });
      searchState.corpusKey = corpusKey();
    }
    box.classList.remove("no-build", "flat");
    box.innerHTML = browseSearchResultsHtml();
    updateBrowseCount(split.all.length);
    return;
  }
  searchState.results = [];
  /* 开关打开：全部平铺（不再分折叠组）；关闭：可构筑 + 底部分组 */
  const flat = showUnbuildable;
  const mainList = flat ? split.all : split.build;
  const open = !flat && (nbOpen.browse || split.build.length === 0);
  /* 可构筑为 0 时把空网格与哨兵收起来：否则筛选「状态牌」会在标题前留一段空白 */
  box.classList.toggle("no-build", mainList.length === 0);
  box.classList.toggle("flat", flat);
  box.innerHTML = `<div class="card-grid paged" id="bgrid"></div><div class="bsentinel" id="bsentinel"></div>` +
    (flat ? "" : otherGroupHtml(split.other, open));
  bPager = makePager($("bgrid"), $("bsentinel"), mainList, browseTile, flat ? "flat" : "build");
  pagerFillAhead(bPager, 3000, 2);
  observeSentinel(bPager);
  if (open) {
    nbPager = makePager($("nbg"), $("nbsentinel"), split.other, browseTile, "other");
    pagerFillAhead(nbPager, 2000, 1);
    observeSentinel(nbPager);
  }
  updateBrowseCount(split.all.length);
}
function updateBrowseCount(n) {
  const box = $("view-browse");
  const cnt = box && box.querySelector ? box.querySelector(".bg-count") : null;
  if (!cnt) return;
  if (searchState.q.trim()) {
    cnt.innerHTML = `命中 <b>${searchState.results.length}</b> 条${browseActive() ? `（筛选后 ${n} 张）` : ""}`;
    return;
  }
  const { build, other } = browseSplit();
  if (showUnbuildable) {
    cnt.innerHTML = `共 <b>${build.length + other.length}</b> 张（可构筑 <b>${build.length}</b>　·　不可构筑 <b>${other.length}</b>）`;
    return;
  }
  cnt.innerHTML = `可构筑 <b>${build.length}</b> 张`
    + (other.length ? `　·　另有 <b>${other.length}</b> 项不可构筑${nbOpen.browse ? "" : "（折叠）"}` : "")
    + (dirtyBrowse() ? `（全库 ${poolStats.total}）` : "");
}
/* 当前实际展示的卡牌 id：检索态 = 命中列表；浏览态 = 筛选结果（详情翻页上下文）。
   折叠中的分组不算"已展示"，翻页上下文跟着可见列表走。 */
function browseVisibleIds() {
  if (searchState.q.trim()) return searchState.results.filter(r => r.kind === "card" || r.kind === "char").map(r => r.id);
  const { all, build, other } = browseSplit();
  if (showUnbuildable) return all.map(x => x.id);
  const open = nbOpen.browse || build.length === 0;
  return (open ? build.concat(other) : build).map(x => x.id);
}
const dirtyBrowse = () => browseState.type || browseState.el || browseState.cost !== "" || browseState.energy !== "" || browseState.tag || browseState.ver || browseState.sort !== "name" || browseState.dir !== 1;

/* ---------- 分页网格：按页挂载 + 视口外卸载 ----------
   把 600~1480 张瓦片一次性铺满 DOM，代价是近两万节点、几百张已解码位图，滚动时每帧
   都要参与样式与合成；滚过去的页留在 DOM 里既不省内存，也让滚回来更贵。
   这里每页 BROWSER_PAGE 张，滚离视口超过 PAGE_KEEP 页就把该页清空、保留等高占位，
   滚回来再挂载。占位高度在页挂载时测一次（页内容与图片占位比例固定，重挂高度一致），
   滚动过程中只读缓存的页偏移，不做布局查询。 */
function makePager(grid: HTMLElement, sentinel: HTMLElement | null, items: PoolEntry[], tileFn: (x: PoolEntry, inGroup: boolean) => string, tag: string): Pager {
  return { grid, sentinel, items, tileFn, tag, pages: [], gridTop: null, offsets: null };
}
function measureH(el) {
  const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
  return r && r.height ? Math.round(r.height) : 0;
}
function pagerPage(pg: Pager, i: number): PagerPageRec {
  let rec = pg.pages[i];
  if (rec) return rec;
  const el = document.createElement("div");
  el.className = "bpage";
  if (pg.grid.appendChild) pg.grid.appendChild(el);
  rec = { el, h: 0, filled: false };
  pg.pages[i] = rec;
  pg.offsets = null;
  return rec;
}
function pagerFill(pg: Pager, i: number): boolean {
  const rec = pagerPage(pg, i);
  if (rec.filled) return false;
  const from = i * BROWSE_PAGE, to = Math.min(from + BROWSE_PAGE, pg.items.length);
  if (to <= from) return false;
  let html = "";
  for (let k = from; k < to; k++) html += pg.tileFn(pg.items[k], pg.tag === "other");
  rec.el.innerHTML = html;
  if (rec.el.style) rec.el.style.height = "";   /* 撤掉占位，回到内容高度 */
  rec.filled = true;
  rec.h = measureH(rec.el) || rec.h || 0;
  pg.offsets = null;
  return true;
}
function pagerSentinel(pg: Pager): void {
  const s = pg.sentinel;
  if (!s) return;
  const shown = Math.min(pg.pages.length * BROWSE_PAGE, pg.items.length);
  const more = shown < pg.items.length;
  if (!pg.items.length) s.textContent = "";
  else if (pg.tag === "other") s.textContent = more ? `已展示 ${shown}/${pg.items.length}，滚动加载更多…` : `已展示全部 ${pg.items.length} 项`;
  else s.textContent = more ? "滚动加载更多…" : `已展示全部 ${pg.items.length} 张`;
}
/* 追加下一页；返回 false 表示已经没有更多 */
function pagerGrow(pg) {
  if (!pg) return false;
  if (pg.pages.length * BROWSE_PAGE >= pg.items.length) return false;
  pagerFill(pg, pg.pages.length);
  pagerSentinel(pg);
  return true;
}
/* 补到"哨兵离开提前加载区"为止。前 budget 页同帧补齐（首屏不能分帧，会闪），
   之后每帧补一页——一次插 100 多张瓦片本身就是长任务，摊到多帧就不挡滚动了。
   getBoundingClientRect 只在真正要补页时测，滚动路径本身不再测量。 */
function pagerFillAhead(pg, margin, budget) {
  if (!pg) return;
  const m = margin == null ? 3000 : margin;
  let left = budget == null ? 2 : budget;
  const step = () => {
    if (pg !== bPager && pg !== nbPager) return;        /* 网格已重建，放弃这一轮 */
    if (pg.pages.length * BROWSE_PAGE >= pg.items.length) { pagerSentinel(pg); return; }
    if (pg.pages.length) {
      const s = pg.sentinel;
      const r = s && s.getBoundingClientRect ? s.getBoundingClientRect() : null;
      if (!r) { pagerSentinel(pg); return; }            /* 无布局信息（Node 测试） */
      if (r.top > viewH() + m) { pagerSentinel(pg); return; }
    }
    pagerGrow(pg);
    if (left-- > 0) step();
    else if (typeof requestAnimationFrame === "function") requestAnimationFrame(step);
  };
  step();
}
/* 视口外卸载 / 滚回重挂。只用缓存的页偏移与高度，滚动中零布局查询。 */
function pagerSweep(pg) {
  if (!pg || pg.pages.length < 4) return;
  if (pg.gridTop == null) {
    const r = pg.grid && pg.grid.getBoundingClientRect ? pg.grid.getBoundingClientRect() : null;
    pg.gridTop = (r ? r.top : 0) + viewTop();
    pg.offsets = null;
  }
  if (!pg.offsets) {
    const offs: number[] = [];
    let y = pg.gridTop || 0;
    for (const rec of pg.pages) { offs.push(y); y += rec.h || 0; }
    pg.offsets = offs;
  }
  /* 窗口按"页索引"算而不是像素：手机上一页 40 张能铺 4000px，用像素阈值会永远不卸载 */
  const offs = pg.offsets;
  const vTop = viewTop();
  const vBot = vTop + viewH();
  let first = -1, last = -1;
  for (let i = 0; i < pg.pages.length; i++) {
    const rec = pg.pages[i];
    if (!rec.h) continue;
    if (offs[i] + rec.h > vTop && offs[i] < vBot) { if (first < 0) first = i; last = i; }
  }
  if (first < 0) return;                       /* 网格整体不在视口内：保持现状 */
  const dropFrom = first - PAGE_KEEP, dropTo = last + PAGE_KEEP;
  for (let i = 0; i < pg.pages.length; i++) {
    const rec = pg.pages[i];
    if (i < dropFrom || i > dropTo) {
      if (rec.filled) {
        rec.el.innerHTML = "";                                  /* 释放瓦片与其图片位图 */
        if (rec.el.style) rec.el.style.height = rec.h + "px";   /* 等高占位：滚动条不动 */
        rec.filled = false;
      }
    } else if (i > dropFrom && i < dropTo && !rec.filled) {
      pagerFill(pg, i);                                        /* 回到窗口内：重新挂载 */
    }
  }
}
/* 追加：卡库主网格 */
function appendBrowseTiles(list) {
  if (searchState.q.trim()) return false;
  if (list) bPager = makePager($("bgrid"), $("bsentinel"), list, browseTile, "build");
  if (!bPager) return false;
  return pagerGrow(bPager);
}
/* 追加：折叠分组网格 */
function appendOtherTiles(list) {
  if (list) nbPager = makePager($("nbg"), $("nbsentinel"), list, browseTile, "other");
  if (!nbPager) return false;
  return pagerGrow(nbPager);
}
/* 滚动：rAF 合帧，只在帧内做一次窗口计算；补齐交给 IntersectionObserver（不可用时兜底） */
let browseTick = false;
const hasIO = typeof IntersectionObserver === "function";
function browseMaybeMore() {
  if (state.currentView !== "browse" || searchState.q.trim()) return;
  if (browseTick) return;
  browseTick = true;
  const run = () => {
    browseTick = false;
    if (state.currentView !== "browse" || searchState.q.trim()) return;
    if (!hasIO) { pagerFillAhead(bPager, 3000, 1); pagerFillAhead(nbPager, 2000, 1); }
    pagerSweep(bPager);
    pagerSweep(nbPager);
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run); else run();
}
document.addEventListener("scroll", browseMaybeMore, { passive: true });
if (typeof window.addEventListener === "function") {
  window.addEventListener("resize", () => {
    /* 列数一变，页高度就变了：偏移缓存作废（远端占位高度留着，滚回时会重挂成正确高度） */
    for (const pg of [bPager, nbPager]) if (pg) { pg.gridTop = null; pg.offsets = null; }
  }, { passive: true });
}
/* 哨兵观察：进入提前加载区就补页。IO 只在交叉状态变化时回调，比滚动里测量便宜 */
let browseIO: IntersectionObserver | null = null;
const ioPagers = new WeakMap<Element, Pager>();
function observeSentinel(pg) {
  if (!pg || !pg.sentinel || !hasIO) return;
  if (!browseIO) {
    browseIO = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) {
        const target = ioPagers.get(e.target);
        if (target) pagerFillAhead(target, 3000, 1);
      }
    }, { rootMargin: "3000px 0px" });
  }
  ioPagers.set(pg.sentinel, pg);
  browseIO.observe(pg.sentinel);
}
function unobserveSentinel(s) {
  if (browseIO && s) { try { browseIO.unobserve(s); } catch (e) {} }
}
/* 分组折叠开关（卡库与检索结果共用） */
function toggleNbGroup(kind) {
  nbOpen[kind] = !nbOpen[kind];
  if (kind === "browse") { try { localStorage.setItem(STORAGE_KEYS.browseOther, nbOpen[kind] ? "1" : "0"); } catch (e) {} }
  renderBrowseResults();
}
/* 筛选交互：chip 再点一次 = 取消；select/dir/reset 即时重渲染并同步 hash */
$("view-browse").addEventListener("click", ev => {
  const add = (ev.target as HTMLElement).closest("[data-add]");
  if (add) { ev.stopPropagation(); draftAdd(Number(add.dataset.add)); return; }
  const nb = (ev.target as HTMLElement).closest("[data-nb]");
  if (nb) { ev.stopPropagation(); toggleNbGroup(nb.dataset.nb); return; }
  if ((ev.target as HTMLElement).closest("[data-btoggle]")) {
    browseExpanded = !browseExpanded;
    try { localStorage.setItem(BROWSE_EXP_KEY, browseExpanded ? "1" : "0"); } catch (e) {}
    renderBrowse(); return;
  }
  /* 全局开关：不可构筑项平铺 / 收进分组 */
  if ((ev.target as HTMLElement).closest("[data-bub]")) {
    setShowUnbuildable(!showUnbuildable);
    renderBrowse();
    syncBrowseHash();
    return;
  }
  /* 收藏过滤：只看星标 */
  if ((ev.target as HTMLElement).closest("[data-bfav]")) {
    setShowFavsOnly(!showFavsOnly);
    renderBrowse();
    syncBrowseHash();
    return;
  }
  /* 星标：就地更新按钮状态；收藏过滤开着时列表要即时反映（卡可能消失） */
  const favB = (ev.target as HTMLElement).closest("[data-fav]") as HTMLElement | null;
  if (favB) {
    ev.stopPropagation();
    const on = toggleFav(Number(favB.dataset.fav));
    favB.classList.toggle("on", on);
    favB.setAttribute("aria-pressed", String(on));
    favB.title = on ? "取消收藏" : "收藏";
    if (showFavsOnly) { renderBrowseResults(); syncBrowseHash(); }
    return;
  }
  const chip = (ev.target as HTMLElement).closest("button[data-bg]");
  if (chip) {
    const g = (chip.dataset.bg || "") as keyof BrowseState;
    Object.assign(browseState, { [g]: browseState[g] === chip.dataset.bv ? "" : (chip.dataset.bv || "") });
    renderBrowse(); syncBrowseHash(); return;
  }
  if ((ev.target as HTMLElement).closest("[data-breset]")) {
    Object.assign(browseState, emptyBrowseFilters(), { sort: "name", dir: 1 });
    renderBrowse(); syncBrowseHash(); return;
  }
  if ((ev.target as HTMLElement).closest("[data-sclear]")) { clearBrowseQuery(); return; }
  if ((ev.target as HTMLElement).closest("[data-bdir]")) { browseState.dir = -browseState.dir; renderBrowse(); syncBrowseHash(); return; }
  /* 检索结果区：范围开关 / 分类 chips / 热门词 / 概念 / 详情 */
  const scopeBtn = (ev.target as HTMLElement).closest("[data-scope]");
  if (scopeBtn) { toggleSearchScope(scopeBtn.dataset.scope); return; }
  if ((ev.target as HTMLElement).closest("[data-scope-clear]")) { clearBrowseFilters(); return; }
  const q = (ev.target as HTMLElement).closest("[data-q]");
  if (q) { applyBrowseQuery(q.dataset.q || ""); return; }
  const f = (ev.target as HTMLElement).closest("[data-f]");
  if (f) { searchState.filter = f.dataset.f || ""; renderBrowseResults(); return; }
  const term = (ev.target as HTMLElement).closest("[data-term]");
  if (term) { openTermName(term.dataset.term); return; }
  const tile = (ev.target as HTMLElement).closest("[data-id]");
  if (tile) showDetail(Number(tile.dataset.id));
});
function applyBrowseQuery(q: string) {
  const input = $<HTMLInputElement>("browseSearch");
  if (input) input.value = q;
  searchState.q = q;
  searchState.filter = "";
  renderBrowseResults();
  syncBrowseHash();
}
function clearBrowseQuery() {
  searchState.q = "";
  searchState.filter = "";
  renderBrowse();
  syncBrowseHash();
  const input = $("browseSearch");
  if (input) input.focus();
}
$("view-browse").addEventListener("change", ev => {
  const sel = (ev.target as HTMLElement).closest("[data-bg]");
  if (sel && sel.tagName === "SELECT") {
    Object.assign(browseState, { [(sel.dataset.bg || "") as keyof BrowseState]: (sel as HTMLSelectElement).value });
    renderBrowse(); syncBrowseHash(); return;
  }
  const s = (ev.target as HTMLElement).closest("[data-bs]");
  if (s) { browseState.sort = (s as HTMLSelectElement).value; renderBrowse(); syncBrowseHash(); }
});

export { renderSummary, tileHtml, renderGrid, listFilter, listSort, sortVal, renderList, hlName, searchTile, browseSearchResultsHtml, browseState, FILTER_DIMS, BROWSE_DIMS, emptyBrowseFilters, BROWSE_PAGE, PAGE_KEEP, bPager, nbPager, viewH, viewTop, passFilter, browseCmp, _browseMemo, browseStateKey, browseFilter, isBuildableEntry, showUnbuildable, setShowUnbuildable, showFavsOnly, setShowFavsOnly, nbOpen, browseSplit, otherGroupHtml, facetCounts, fcn, browseHash, parseBrowseHash, syncBrowseHash, browseChip, sumCells, browseTile, syncTileQty, BROWSE_EXP_KEY, browseExpanded, activeBrowseChips, browseBarHtml, browseSearchHtml, renderBrowse, renderBrowseResults, updateBrowseCount, browseVisibleIds, dirtyBrowse, makePager, measureH, pagerPage, pagerFill, pagerSentinel, pagerGrow, pagerFillAhead, pagerSweep, appendBrowseTiles, appendOtherTiles, browseTick, hasIO, browseMaybeMore, browseIO, ioPagers, observeSentinel, unobserveSentinel, toggleNbGroup, applyBrowseQuery, clearBrowseQuery };
