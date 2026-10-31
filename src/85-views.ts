/* 85-views.ts —— 卡面 / 列表视图与卡库浏览：筛选、分面、分页、瓦片渲染。 */
import { R_STYLE, R_ZH, allReqs, depBadges, reqElement } from "./30-deps";
import { recordOfId, isCharId, nameCmp } from "./data/records";
import { $ } from "./core/dom";
import { safeReplaceState } from "./core/history";
import { showOdds } from "./86-odds";
import { CAT_ORDER, clearBrowseFilters, corpusKey, hlText, loadRecent, nearNames, resultTypeLabel, searchCards, searchState, toggleSearchScope } from "./70-search";
import { termEntries } from "./40-concepts";
import { POOL_TYPE_ORDER, pool, poolStats, poolVersion, verCmp } from "./45-pool";
import { copyLimit, draft, draftAdd } from "./80-deck";
import { dataReady } from "./20-data";
import { openTermName, showDetail } from "./90-detail";
import { state } from "./data/state";
import { STORAGE_KEYS, imgFull, ELE_ZH, ELE_COLOR, ENERGY_ICON, ELE_ICONS, eleIcon, enPips, ICON_PLUS, ICON_STAR } from "./core/resources";
import { favs, isFav, toggleFav } from "./45-pool";
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
  const curve = `<div class="curve" data-odds="1" role="button" tabindex="0" title="打开抽牌概率与费用曲线" aria-label="打开抽牌概率与费用曲线">${buckets.map((n, i) => `
    <div class="cbar" title="元素骰费用 ${i === 5 ? "5+" : i}：${n} 张">
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

  $("summary").innerHTML = `
    <div class="sum-chars">${state.current!.chars.map(c => `
      <span class="chip"><span class="edot" style="--ec:${ELE_COLOR[c.element || ""] || "var(--faint)"}">${ELE_ICONS[c.element || ""] || ""}</span>${esc(c.name)}<small class="chip-en">${enPips(c.energy || 0)}</small></span>`).join("")}
    </div>
    <div class="sum-types"><span>元素构成：<b>${elesHtml}</b></span><span>${typeCounts}</span><span>版本跨度：<b>${esc(vers.join(" ~ "))}</b></span></div>
    <div class="sum-extra">${energyChip}${rChips}<button class="sum-odds" data-odds="1" title="查看费用曲线与关键牌起手 / 前几回合的抽到概率">抽牌概率与费用曲线 ›</button></div>
    ${curve}`;
}
/* 费用曲线整体可点：键盘 Enter / 空格与点击一致 */
$("summary").addEventListener("keydown", ev => {
  if ((ev.key === "Enter" || ev.key === " ") && (ev.target as HTMLElement).closest("[data-odds]")) {
    ev.preventDefault();
    showOdds();
  }
});
/* 点击概览中的限制统计 → 跳到列表视图并过滤 */
$("summary").addEventListener("click", ev => {
  if ((ev.target as HTMLElement).closest("[data-odds]")) { showOdds(); return; }
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
  if (!state.current) {
    $("view-grid").innerHTML = `<div class="empty-hint">尚未解析牌组<br><small>粘贴分享码后自动解析；也可以先回「卡库浏览」筛选检索，或用页头「更多 → 加载示例牌组」</small></div>`;
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
    <td>${x.element ? eleIcon(x.element, "inline-el") : ""}${esc(x.name)}</td><td>${costHtml(x.playCost)}</td>
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
          <div class="tmeta">${esc(meta)} ${matchChip(r)}</div></div>`;
      }
    }
    /* 用行上携带的具体种类（ckind），而不是词条列表首项——
       首项可能是同名的卡牌/角色条目，会把"术语"错标成"卡牌" */
    const k = r.ckind || termEntries(r.name).find(e => e.kind !== "card" && e.kind !== "char")?.kind || "keyword";
    return `<div class="tile stile" data-term="${esc(r.name)}" title="点击查看概念解释">
      <div class="cbox"><span>${esc(KIND_ZH[k] || "概念")}</span></div>
      <div class="tname">${hlName(r.name)}</div>
      <div class="tmeta">${esc(KIND_ZH[k] || "概念")} ${matchChip(r)}</div></div>`;
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
   筛选维度：类别 / 元素（角色及其天赋）/ 骰子费用 / 充能 / 标签 / 版本。
   计数为 facet 计数：每个可选值按"其余维度全部生效"统计，点进去不会把人带向空结果。 */
/** 卡库筛选状态：六个维度 + 排序。u（是否显示不可构筑）是全局开关，不在这里。 */
interface BrowseState { type: string; el: string; cost: string; energy: string; tag: string; ver: string; sort: string; dir: number }
const browseState: BrowseState = { type: "", el: "", cost: "", energy: "", tag: "", ver: "", sort: "name", dir: 1 };
const BROWSE_DIMS: FacetDim[] = ["type", "el", "cost", "energy", "tag", "ver"];
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
function facetKey(x, dim) {
  if (dim === "type") return x.typeRaw;
  if (dim === "el") return x.element || null;
  if (dim === "cost") return x.kind === "char" ? null : String(Math.min(x.dice, 5));
  if (dim === "energy") return x.kind === "char" ? null : (x.energyCost > 0 ? String(x.energyCost) : "0");
  if (dim === "ver") return x.ver || null;
  return null;
}
function passFilter(x, st) {
  if (st.type && x.typeRaw !== st.type) return false;
  if (st.el && x.element !== st.el) return false;
  if (st.cost !== "" && (x.kind === "char" || String(Math.min(x.dice, 5)) !== st.cost)) return false;
  if (st.energy !== "" && (x.kind === "char" || (x.energyCost > 0 ? String(x.energyCost) : "0") !== st.energy)) return false;
  if (st.tag && !x.tags.includes(st.tag)) return false;
  if (st.ver && x.ver !== st.ver) return false;
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
type FacetDim = "type" | "el" | "cost" | "energy" | "tag" | "ver";
type Facets = Record<FacetDim, Record<string, FacetCell>>;
interface BrowseSplit { all: PoolEntry[]; build: PoolEntry[]; other: PoolEntry[] }
const _browseMemo: {
  filter: { key: string; list: PoolEntry[] | null };
  facets: { key: string; data: Facets | null };
  split: { key: string; data: BrowseSplit | null };
} = { filter: { key: "", list: null }, facets: { key: "", data: null }, split: { key: "", data: null } };
function browseStateKey(st = browseState) {
  return [st.type, st.el, st.cost, st.energy, st.tag, st.ver, st.sort, st.dir].join("\u0001") + "@" + poolVersion + (showFavsOnly ? "|f" : "");
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
  const out: Facets = { type: {}, el: {}, cost: {}, energy: {}, tag: {}, ver: {} };
  const bump = (dim: FacetDim, k: string, build: boolean) => {
    const cell = out[dim][k] || (out[dim][k] = { b: 0, o: 0, n: 0 });
    if (build) cell.b++; else cell.o++;
    cell.n++;
  };
  for (const dim of BROWSE_DIMS) {
    const st2 = { ...st, [dim]: "" };
    for (const x of pool) {
      if (!passFilter(x, st2)) continue;
      const build = isBuildableEntry(x);
      if (dim === "tag") { for (const t of x.tags) if (t) bump("tag", t, build); continue; }
      const k = facetKey(x, dim);
      if (k != null) bump(dim, k, build);
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
  if (st.type) p.push("t=" + st.type);
  if (st.el) p.push("e=" + st.el);
  if (st.cost !== "") p.push("c=" + st.cost);
  if (st.energy !== "") p.push("n=" + st.energy);
  if (st.tag) p.push("g=" + encodeURIComponent(st.tag));
  if (st.ver) p.push("v=" + st.ver);
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
   routeHash 先整体解码过一次再传进来，参数又解码一次——q 里出现字面 % 就 URIError）。 */
function parseBrowseHash(hash) {
  const st = { type: "", el: "", cost: "", energy: "", tag: "", ver: "", sort: "name", dir: 1, u: false, f: false, q: undefined as string | undefined };
  const m = String(hash || "").match(/^#?b=(.*)$/);
  if (!m) return null;
  /* 畸形转义（%zz）按原样当值用：分享链接坏了不该炸路由 */
  const dec = (v: string) => { try { return decodeURIComponent(v); } catch (e) { return v; } };
  for (const kv of m[1].split(",")) {
    const i = kv.indexOf("=");
    if (i < 0) continue;
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    if (k === "t") st.type = v;
    else if (k === "e") st.el = v;
    else if (k === "c") st.cost = v;
    else if (k === "n") st.energy = v;
    else if (k === "g") st.tag = dec(v);
    else if (k === "v") st.ver = v;
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
      <div class="badges">${badges}</div>${add}<button class="favbtn${isFav(x.id) ? " on" : ""}" data-fav="${x.id}" aria-pressed="${isFav(x.id)}" title="${isFav(x.id) ? "取消收藏" : "收藏"}">${ICON_STAR}</button>${qtyBadge}${cmpBtnHtml(x.id)}</div>
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
  const push = (g: string, label: string, val: string) => chips.push(browseChip(g, val, label, null, true, "点击移除该筛选"));
  if (st.type) push("type", TYPE_ZH[st.type] || st.type, st.type);
  if (st.el) push("el", eleIcon(st.el) + (ELE_ZH[st.el] || st.el), st.el);
  if (st.cost !== "") push("cost", "骰子 " + (st.cost === "5" ? "5+" : st.cost), st.cost);
  if (st.energy !== "") push("energy", st.energy === "0" ? "无充能" : ENERGY_ICON + st.energy, st.energy);
  if (st.tag) push("tag", st.tag, st.tag);
  if (st.ver) push("ver", st.ver, st.ver);
  return chips.join("");
}
function browseBarHtml(st: BrowseState, facets: Facets) {
  const buildN = poolStats.buildable, otherN = poolStats.total - poolStats.buildable;
  const typeRow = browseChip("type", "", "全部", { b: buildN, o: otherN }, !st.type, "可构筑 / 对局实体与历史变体（后者默认折叠，可用右侧开关平铺）") +
    POOL_TYPE_ORDER.filter(t => poolStats.byType[t]).map(t =>
      browseChip("type", t, TYPE_ZH[t] || t, facets.type[t], st.type === t, "计数为「可构筑 / 不可构筑」")).join("");
  const elTotal = sumCells(facets.el);
  const elRow = browseChip("el", "", "全部", elTotal.b + elTotal.o, !st.el, "按角色元素筛选（含其天赋牌）") +
    Object.keys(ELE_ZH).filter(e => fcn(facets.el, e)).map(e =>
      browseChip("el", e, eleIcon(e) + ELE_ZH[e], fcn(facets.el, e), st.el === e)).join("");
  const costRow = browseChip("cost", "", "全部", null, st.cost === "") +
    ["0", "1", "2", "3", "4", "5"].filter(k => fcn(facets.cost, k)).map(k =>
      browseChip("cost", k, k === "5" ? "5+" : k, fcn(facets.cost, k), st.cost === k)).join("");
  const enRow = browseChip("energy", "", "全部", null, st.energy === "") +
    Object.keys(facets.energy).sort().map(k =>
      browseChip("energy", k, k === "0" ? "无充能" : ENERGY_ICON + k, fcn(facets.energy, k), st.energy === k)).join("");
  const tagRow = browseChip("tag", "", "全部", null, !st.tag) +
    Object.entries(facets.tag).sort((a, b) => b[1].n - a[1].n).map(([t, cell]) =>
      browseChip("tag", t, t, cell, st.tag === t)).join("");
  const verSel = `<select class="bg-sel" data-bg="ver" title="按版本筛选"><option value="">全部版本</option>` +
    poolStats.versions.map(v => `<option${st.ver === v ? " selected" : ""}>${esc(v)}</option>`).join("") + `</select>`;
  const sortSel = `<select class="bg-sel" data-bs="sort" title="排序方式">
      <option value="name"${st.sort === "name" ? " selected" : ""}>按名称</option>
      <option value="cost"${st.sort === "cost" ? " selected" : ""}>按费用</option>
      <option value="ver"${st.sort === "ver" ? " selected" : ""}>按版本</option>
      <option value="id"${st.sort === "id" ? " selected" : ""}>按编号</option></select>`;
  const dirBtn = `<button class="bg-dir" data-bdir="1" title="${st.dir < 0 ? "当前降序，点击升序" : "当前升序，点击降序"}">${st.dir < 0 ? "↑" : "↓"}</button>`;
  const activeCount = (st.type ? 1 : 0) + (st.el ? 1 : 0) + (st.tag ? 1 : 0) + (st.ver ? 1 : 0)
    + (st.cost !== "" ? 1 : 0) + (st.energy !== "" ? 1 : 0);
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
  /* 展开态：六维筛选各行（激活态由 chip 高亮表示，无需再重复 chips） */
  const rows = browseExpanded ? `
    <div class="bg-row"><span class="bg-label">类别</span><div class="bg-chips">${typeRow}</div></div>
    <div class="bg-row"><span class="bg-label">元素</span><div class="bg-chips">${elRow}</div></div>
    <div class="bg-row"><span class="bg-label">骰子费用</span><div class="bg-chips">${costRow}</div></div>
    <div class="bg-row"><span class="bg-label">充能</span><div class="bg-chips">${enRow}</div></div>
    <div class="bg-row"><span class="bg-label">标签</span><div class="bg-chips">${tagRow}</div></div>
    <div class="bg-row bg-ctrl"><span class="bg-label">版本</span>${verSel}</div>` : "";
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
  $("view-browse").innerHTML = browseSearchHtml() + browseBarHtml(st, facets) +
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
    Object.assign(browseState, { type: "", el: "", cost: "", energy: "", tag: "", ver: "", sort: "name", dir: 1 });
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

export { renderSummary, tileHtml, renderGrid, listFilter, listSort, sortVal, renderList, hlName, searchTile, browseSearchResultsHtml, browseState, BROWSE_DIMS, BROWSE_PAGE, PAGE_KEEP, bPager, nbPager, viewH, viewTop, facetKey, passFilter, browseCmp, _browseMemo, browseStateKey, browseFilter, isBuildableEntry, showUnbuildable, setShowUnbuildable, showFavsOnly, setShowFavsOnly, nbOpen, browseSplit, otherGroupHtml, facetCounts, fcn, browseHash, parseBrowseHash, syncBrowseHash, browseChip, sumCells, browseTile, syncTileQty, BROWSE_EXP_KEY, browseExpanded, activeBrowseChips, browseBarHtml, browseSearchHtml, renderBrowse, renderBrowseResults, updateBrowseCount, browseVisibleIds, dirtyBrowse, makePager, measureH, pagerPage, pagerFill, pagerSentinel, pagerGrow, pagerFillAhead, pagerSweep, appendBrowseTiles, appendOtherTiles, browseTick, hasIO, browseMaybeMore, browseIO, ioPagers, observeSentinel, unobserveSentinel, toggleNbGroup, applyBrowseQuery, clearBrowseQuery };
