/* 90-detail.ts —— 详情弹层与浮层栈：卡牌 / 概念 / 技能页与层级导航。 */
import { KIND_ZH, backlinks } from "./50-backlinks";
import { $ } from "./core/dom";
import { copyLimit, draft, draftAdd, draftRemoveCard, draftRemoveChar } from "./80-deck";
import { browseVisibleIds } from "./85-views";
import { renderSkillView, showSkill, skillOf } from "./47-skills";
import { compareState, renderCompareView, renderDeckDiffView } from "./88-compare";
import { renderQrView } from "./97-qr";
import { R_STYLE, reqElement } from "./30-deps";
import { termEntries } from "./40-concepts";
import { state } from "./data/state";
import type { GcgRecord, OverlayEntry } from "./types";
import { recordOfId, nameOfId, isCharId, isShadowId, cardRecords, keyIdOf } from "./data/records";
import { ELE_ZH, ELE_COLOR, tagZh, eleIcon, enPips, imgFull, ICON_X, ICON_SWAP, ICON_STAR, ICON_LINK } from "./core/resources";
import { esc, toast, copyText } from "./core/dom";
import { registerLayer, syncScrollLock, setModalLayer } from "./core/layers";
import { animateExit } from "./core/motion";
import { overlayHashOf, overlayHashParse, overlayHashPush, overlayHashReplace, overlayHashBack, overlayHashCloseAll, overlayHashPop, overlayHashAdopt, overlayPushDepth, overlayHashClear } from "./core/history";
import { cardArtHtml, artFallback, artIconFail, artIconReady } from "./data/model";
import { dataOrigins } from "./20-data";
import { costHtml } from "./30-deps";
import { linkify } from "./40-concepts";
import { pool, poolStats, isFav, toggleFav } from "./45-pool";
import { skillsHtml, skillsHtmlCard, equipSkillsHtml } from "./47-skills";
import { termHtml } from "./50-backlinks";
import { COMPARE_MAX } from "./88-compare";

/* ---------- 详情弹层（含限制、关联与反链导航） ---------- */
/* 反链 chips：引用该概念的其他卡牌/角色，点击跳转详情。
   同名多版本（如「增殖生命体」有火/水/草/雷四张状态牌）只出一个 chip——
   否则会并排出现四个一模一样的按钮，既分不清也没法选；代表条目优先取可构筑版本，
   title 里注明还有几个同名条目。 */
function backlinkHtml(name: string, selfId: number | null = null) {
  const b = backlinks.get(name);
  if (!b || !b.size) return "";
  /* 准备状态影子不进"被引用"：它只是技能自己的运行时标记，列出来会与技能同名同义 */
  const ids = [...b].filter(x => x !== selfId && !isShadowId(x));
  if (!ids.length) return "";
  const byName = new Map();      /* 卡片显示名 → { id, n } */
  for (const id of ids) {
    const t = recordOfId(id);
    if (!t) continue;
    const cur = byName.get(t.name);
    if (!cur) byName.set(t.name, { id, n: 1, deckable: t.share != null });
    else {
      cur.n++;
      if (!cur.deckable && t.share != null) { cur.id = id; cur.deckable = true; }
    }
  }
  const all = [...byName.entries()];
  const shown = all.slice(0, 30);
  const chips = shown.map(([n, info]) =>
    `<button class="blchip" data-goto="${info.id}" title="查看：${esc(n)}${info.n > 1 ? `（另有 ${info.n - 1} 个同名条目）` : ""}">${esc(n)}</button>`).join("");
  const total = all.length;
  const more = total > shown.length ? `<span class="blmore">…等 ${total} 个引用来源</span>` : "";
  return `<div class="drel"><b>被引用</b><span class="blchips">${chips}${more}</span></div>`;
}
/* 角色天赋牌 chips（卡牌详情中排除自身，避免自指）。
   只在当前卡自身是天赋牌时输出：relatedCharacterId 推导后，角色专属装备牌
   （咬咬鲨鱼、驰轮车）也有关联角色——给它们列一串天赋牌 chips 是噪音。 */
function charTalentChips(charId: number, excludeId: number | null = null, onlyForTalent = false): string {
  const list = cardRecords().filter(r =>
    r.rel.relatedCharacterId === charId && r.stats.tagsRaw.includes("GCG_TAG_TALENT"));
  if (!list.length) return "";
  if (onlyForTalent) {
    const self = excludeId != null && recordOfId(excludeId);
    if (!self || !self.stats.tagsRaw.includes("GCG_TAG_TALENT")) return "";
  }
  return `<div class="drel"><b>天赋牌</b><span class="blchips">` + list.map(r => {
    const cid = keyIdOf(r.key);
    return `<button class="blchip${cid === excludeId ? " self" : ""}" data-goto="${cid}" title="${esc(r.name)}${cid === excludeId ? "（当前卡牌）" : ""}">${esc(r.name)}</button>`;
  }).join("") + `</span></div>`;
}
function draftHas(id) { return isCharId(id) ? draft.chars.includes(id) : draft.cards.has(id); }
/* 详情页的主行动：加入牌组。
   同名卡可以放 2 张（秘传 1 张，见 80-deck 的 copyLimit），所以这里不能做成
   「加入 / 移出」二选一——那只允许加 1 张。已加入时按钮写「再加一张 ×1/2」，
   加满才禁用；移出另作次级入口，一次清掉这张卡的全部份数。 */
function deckActionHtml(id: number, joinable: boolean, c: GcgRecord | null): string {
  if (!joinable) return "";
  if (c) {
    const has = draft.chars.includes(id);
    return `<button class="jbtn${has ? " in" : ""}" title="${has ? "点击移出当前牌组" : "加入当前牌组（共 3 个角色槽）"}" data-act="draftToggle">${has ? "移出牌组" : "加入牌组"}</button>`;
  }
  const n = draft.cards.get(id) || 0, max = copyLimit(id);
  const add = n < max
    ? `<button class="jbtn${n ? " in" : ""}" title="加入当前牌组（同名上限 ${max} 张）" data-act="draftToggle">${n ? `＋ 再加一张 ${n}/${max}` : "＋ 加入牌组"}</button>`
    : `<button class="jbtn in" disabled title="同名卡上限 ${max} 张，已加满">✓ 已满 ${n}/${max}</button>`;
  const out = n ? `<button class="lbtn" title="从当前牌组移出（共 ${n} 张）" data-act="draftRemove">移出</button>` : "";
  return add + out;
}
/* ---------- 弹层导航模型 ----------
   弹层内部是一个「视图栈」，元素只有两种：
     · detail —— 卡牌 / 角色详情，自带同级翻页上下文（ids / idx）
     · term   —— 概念页；概念页里的术语链接继续压栈，可沿概念链一路深钻
   返回（‹ / Esc）逐层弹出：概念 → 来源概念 → … → 来源卡牌 → 关闭弹层。
   所有入口（卡面 / 列表 / 卡库 / 检索 / 深链 / 反链 chip / 术语链接）都走
   showDetail / showTermModal 这一条路径，因此翻页与下钻在任意界面表现一致。 */
function topView() { return state.overlayStack.length ? state.overlayStack[state.overlayStack.length - 1] : null; }
const overlayOpen = () => $("overlay").classList.contains("show");

/* 弹层的开关统一走这里：显示/隐藏 + 通知层栈同步背景滚动锁。
   只挂 fixed 遮罩是不够的——弹层滚到边界后滚动链会继续传给文档，
   于是"在弹层里上下滑，背景的卡面视图跟着动"。锁滚动与 scrollbar 补偿
   都收在 core/layers 里，其他浮层共用同一套。 */
/* 退场动画只在「支持且未关闭动效」时播放：reduced-motion 与测试环境（无 matchMedia）
   都直接瞬时关闭——与 CSS 的 reduced-motion 归零语义一致，也不拖慢同步断言。
   生命周期本体（取消/守卫/兜底/收尾）收在 core/motion 的 animateExit，
   这里只提供类名与回调——此前这段是六步手工序列，两轮事故都发生在这里。 */
/* 退场动画进行中又重新打开：先 cancel 再自己摆正类名——否则挂起的收尾
   会在动画结束/兜底定时器触发时把刚开好的弹层摘掉（.show 被误删，弹层开着却不可交互）。 */
let cancelOverlayClose: (() => void) | null = null;
function setOverlayOpen(open: boolean) {
  const ov = $("overlay");
  if (!ov || !ov.classList) return;
  if (!open && ov.classList.contains("show")) {
    /* 退场：.show 即刻摘除（层即刻算关闭，滚动锁随退场开始就释放——布局抖动与
       淡出重叠，而不是淡出结束后突兀一跳），再用 .closing 播淡出；
       animationend 只认 ovl-out 且只认自己（.detail 的 dlg-out 更早结束，会冒泡上来）。 */
    cancelOverlayClose?.();
    cancelOverlayClose = animateExit({
      el: ov, openCls: "show", closingCls: "closing", anim: "ovl-out",
      onStart: syncScrollLock,
    });
    /* 翻页方向类不能残留：display:none 期间动画被重置，重开时会重播一次翻页滑入 */
    const detail = $("detail");
    if (detail && detail.classList) detail.classList.remove("pg-prev", "pg-next");
    return;
  }
  cancelOverlayClose?.();
  cancelOverlayClose = null;
  ov.classList.remove("closing");
  ov.classList.toggle("show", open);
  if (!open) {
    const detail = $("detail");
    if (detail && detail.classList) detail.classList.remove("pg-prev", "pg-next");
  }
  syncScrollLock();
  if (open) hideTip();      /* 弹层盖上来时，残留的悬浮预览会浮在遮罩之上 */
}

/* 同级翻页列表：按打开入口推断——卡库 → 当前实际展示的卡牌（筛选结果或检索命中）；
   牌组 → 牌组内顺序。（旧实现把"牌组顺序"和"导航上下文"混成一个 modalList，
   从卡库/检索打开详情时会被压成单张，此后再从卡面视图打开详情也仍是单张。） */
function pagerContextFor(id) {
  if (state.currentView === "browse") {
    const ids = browseVisibleIds();
    if (ids.includes(id)) return ids;
  }
  return state.deckOrder.includes(id) ? state.deckOrder : [id];
}
function detailView(id: number, ids?: number[]): OverlayEntry {
  const list = ids && ids.length ? ids.slice() : [id];
  const i = list.indexOf(id);
  return { kind: "detail", id, ids: list, idx: i < 0 ? 0 : i };
}
/* 每个视图自己记住滚动位置：翻页 / 下钻后回到顶部，返回时回到原来的位置。
   旧实现每次 innerHTML 重建都会把弹层滚回顶部，返回对比面板后要重新往下找。 */
let renderedView: OverlayEntry | null = null;
/* resetScroll：翻页 / 换了一张卡时强制回到顶部；其余重渲染沿用视图自己的位置 */
/* 弹层 kind → 渲染函数：renderOverlay 的分发点收口在这张表。
   syncOverlayToHash 的相等判定逻辑各 kind 异质（id/name/key 字段不同），保持分支不走表。 */
const OVERLAY_RENDER: Record<string, (v: OverlayEntry) => void> = {
  term: renderTermView,
  skill: renderSkillView,
  compare: renderCompareView,
  deckdiff: renderDeckDiffView,
  qr: renderQrView,
  detail: renderDetailView,
};
function renderOverlay(resetScroll = false) {
  const reset = resetScroll === true;
  const detail = $("detail");
  if (!reset && renderedView && detail && typeof detail.scrollTop === "number") {
    renderedView.scrollTop = detail.scrollTop;
    const sc = detail.querySelector ? detail.querySelector(".cmp-scroll") : null;
    if (sc) renderedView.cmpLeft = sc.scrollLeft || 0;
  }
  const top = topView();
  if (!top) { setOverlayOpen(false); renderedView = null; return; }
  if (reset) { top.scrollTop = 0; top.cmpLeft = 0; }
  /* kind → 渲染函数注册表：新弹层种类在这里挂一行（渲染函数保持模块内聚） */
  (OVERLAY_RENDER[top.kind] || renderDetailView)(top);
  setOverlayOpen(true);
  if (detail && typeof detail.scrollTop === "number") detail.scrollTop = top.scrollTop || 0;
  if (top.cmpLeft && detail && detail.querySelector) {
    const sc = detail.querySelector(".cmp-scroll");
    if (sc) sc.scrollLeft = top.cmpLeft;
  }
  renderedView = top;
}
/* 打开详情：弹层已开（反链 / 关联 / 术语身份跳转）→ 压栈，返回可回上一张；
   未开 → 重置栈。同 id 连续点击不重复压栈。 */
function showDetail(id: number, ids?: number[], fromHistory = false) {
  id = Number(id);
  const top = topView();
  if (overlayOpen() && top && top.kind === "detail" && top.id === id) return;
  if (!overlayOpen()) state.overlayStack = [];
  state.overlayStack.push(detailView(id, ids || pagerContextFor(id)));
  const nt = topView();
  const h = overlayHashOf(nt);
  if (!fromHistory && h) { overlayHashPush(h); nt!.hpushed = true; }   /* 写入历史：后退键逐层回退 */
  renderOverlay();
}
function overlayBack() {
  const top = topView();
  /* 有历史条目的层把返回交给历史：popstate 统一做差量同步（含前进重开） */
  if (top && top.hpushed && overlayHashBack()) return;
  state.overlayStack.pop();
  if (!state.overlayStack.length) { setOverlayOpen(false); return; }
  renderOverlay();
}
function overlayClose() {
  /* 全部关闭：一次吞掉整链历史，单个 popstate 完成清栈 */
  if (overlayHashCloseAll()) return;
  state.overlayStack = []; setOverlayOpen(false);
}
/* popstate 差量同步：把可回退层弹到目标深度（不触发历史），缺的层按 hash 重开。
   后退 = 弹栈；前进 = 重开；夹在中间的普通层（compare）一并清掉。
   99-main 的 popstate 监听负责调用它。 */
function overlayMatches(top, want): boolean {
  if (!top || !want) return false;
  if (want.kind === "detail") return top.kind === "detail" && top.id === want.id;
  if (want.kind === "term") return top.kind === "term" && top.name === want.name;
  return top.kind === "skill" && top.key === want.key;
}
function syncOverlayToHash(targetDepth: number, want) {
  const isH = v => v && (v.kind === "detail" || v.kind === "term" || v.kind === "skill");
  /* 深链 / 前进重开的层没有自己的条目：按「带条目的层数」对齐目标深度 */
  const entryDepth = () => state.overlayStack.filter(v => isH(v) && v.hpushed).length;
  while (state.overlayStack.length) {
    const top = topView();
    if (!top) break;
    if (isH(top) && top.hpushed) {
      if (entryDepth() <= targetDepth) break;
      state.overlayStack.pop();
      overlayHashPop();
      continue;
    }
    /* 无条目层分两类：
       · 普通层（compare / deckdiff）——hash 认它就留，且打开在基座上时后退不关它；
       · 无条目的可回退层（深链开的详情）——hash 不认它就是陈旧视图，始终弹掉。 */
    if (isH(top)) {
      if (want && overlayMatches(top, want) && entryDepth() >= targetDepth) break;
      state.overlayStack.pop();
      continue;
    }
    if (entryDepth() > 0) { state.overlayStack.pop(); continue; }
    break;
  }
  /* 前进重开：目标深度还没到，按 hash 补上缺的那层（不写历史，但认领该条目） */
  if (want && entryDepth() < targetDepth) {
    if (want.kind === "detail") { if (recordOfId(want.id)) { state.overlayStack.push(detailView(want.id)); topView()!.hpushed = true; overlayHashAdopt(); } }
    else if (want.kind === "term") { if (termEntries(want.name).length) { state.overlayStack.push({ kind: "term", name: want.name }); topView()!.hpushed = true; overlayHashAdopt(); } }
    else if (want.kind === "skill" && skillOf(want.key)) { state.overlayStack.push({ kind: "skill", key: want.key }); topView()!.hpushed = true; overlayHashAdopt(); }
  }
  renderedView = null;
  renderOverlay();
}
/* 登记为最顶层（z-index 50）。Esc 走 overlayBack 逐层退回，栈空时它自己关闭弹层。 */
registerLayer({ id: "overlay", isOpen: overlayOpen, close: overlayBack, order: 50, modal: true });
/* 翻页：同一列表内前后跳 */
function modalStep(d) {
  const top = topView();
  if (!top || top.kind !== "detail") return;
  const n = (top.idx || 0) + d;
  if (n < 0 || n >= top.ids!.length) return;
  top.id = top.ids![n]; top.idx = n;
  renderOverlay(true);
  { const h = overlayHashOf(top); if (h) overlayHashReplace(h); }   /* 翻页原地换 hash，不加历史 */
  /* 方向感：内容沿翻页方向滑入（动画挂在 #detail 容器上，不与面板入场动画叠加） */
  const box = $("detail");
  if (box && box.classList) {
    box.classList.remove("pg-prev", "pg-next");
    void (box as HTMLElement).offsetWidth;   /* 重置动画：连续翻页也要每次都播 */
    box.classList.add(d > 0 ? "pg-next" : "pg-prev");
  }
}
/* 视图标签（返回钮文字）：概念名 / 卡牌名 */
function viewLabel(v) {
  if (!v) return "";
  if (v.kind === "term") return v.name;
  if (v.kind === "skill") { const s = skillOf(v.key); return s ? s.name : "技能"; }
  if (v.kind === "compare") return "卡牌对比";
  if (v.kind === "deckdiff") return "牌组对比";
  if (v.kind === "qr") return "分享码二维码";
  return nameOfId(v.id) || "上一页";
}
/* 弹层顶栏：返回（仅栈深 > 1 时出现）+ 自定义按钮组 + 关闭 */
function navBar(extra = "") {
  const prev = state.overlayStack.length > 1 ? state.overlayStack[state.overlayStack.length - 2] : null;
  const back = prev
    ? `<button class="lbtn tm-back" title="返回「${esc(viewLabel(prev))}」" data-act="back">‹ ${esc(viewLabel(prev))}</button>` : "";
  return `<div class="navbtns">${back}${extra}
      <button title="关闭 (Esc)" data-act="close">${ICON_X}</button></div>`;
}
/* 翻页控件：同级列表不足 2 张时不出现（避免"永远禁用"的误导），多张时显示位置「3/22」 */
function pagerHtml(v: Extract<OverlayEntry, { kind: "detail" }>): string {
  if (v.ids.length < 2) return "";
  return `<span class="pgbar" title="同一列表内翻页（← →）">
      <button title="上一张 (←)" ${v.idx <= 0 ? "disabled" : ""} data-act="step" data-d="-1">‹</button>
      <span class="pgnum">${v.idx + 1}/${v.ids.length}</span>
      <button title="下一张 (→)" ${v.idx >= v.ids.length - 1 ? "disabled" : ""} data-act="step" data-d="1">›</button>
    </span>`;
}
function renderDetailView(v) {
  const id = v.id;
  const rec = recordOfId(id);
  const c = rec && rec.kind === "char" ? rec : null;
  const e = rec && rec.kind === "card" ? rec : null;
  /* 只有带分享码 id 的条目能进牌组：对局实体（状态/召唤物/附加状态）与历史变体
     都不可构筑，给它们显示「加入牌组」只会点出一个失败的 toast */
  const joinTarget = c || e;
  const joinable = !!joinTarget && joinTarget.share != null;
  /* 主行动（加入牌组）文字化，一眼可读；复制链接降为次级 */
  const joinBtn = deckActionHtml(id, joinable, c ?? null);
  const cmpOn = compareState.ids.includes(id);
  const cmpBtn = joinable
    ? `<button class="lbtn${cmpOn ? " on" : ""}" data-cmp="${id}" data-cmp-label="对比" title="加入卡牌对比（最多 ${COMPARE_MAX} 张）">${cmpOn ? "✓ 已选" : "对比"}</button>` : "";
  /* 已选 2 张及以上时，详情里就能直接打开对比面板；返回仍回到这张卡 */
  const cmpOpenBtn = compareState.ids.length >= 2
    ? `<button class="lbtn" data-cmpopen="1" title="打开卡牌对比面板">${ICON_SWAP} ${compareState.ids.length}</button>` : "";
  const nav = navBar(`${pagerHtml(v)}${joinBtn}${cmpBtn}${cmpOpenBtn}<button class="lbtn${isFav(v.id) ? " on" : ""}" data-fav="${v.id}" aria-pressed="${isFav(v.id)}" title="${isFav(v.id) ? "取消收藏" : "收藏"}">${ICON_STAR} ${isFav(v.id) ? "已收藏" : "收藏"}</button><button class="lbtn" title="复制该卡链接" data-act="copyLink">${ICON_LINK}</button>`);
  let html;
  if (c) {
    const el = c.stats.element;
    const tags = c.stats.tagsRaw.filter(t => !t.startsWith("GCG_TAG_ELEMENT")).map(tagZh).filter(Boolean);
    html = `${nav}<div class="dimg" data-lb="${id}" title="点击查看大图">${cardArtHtml(id, { kind: "detail", alt: c.name })}</div>
      <div class="dinfo"><h2>${esc(c.name)}</h2>
      <div class="meta">${el ? `<span class="tagpill">${eleIcon(el)}${esc(ELE_ZH[el] || el)}</span>` : ""}${tags.map(t => `<span class="tagpill">${esc(t)}</span>`).join("")}<span class="tagpill">生命 ${c.stats.hp}</span><span class="tagpill">充能上限 ${enPips(c.stats.maxEnergy || 0)}</span><span class="tagpill">${esc(c.version || "")}</span></div>
      ${c.desc.story ? `<div class="dtext dstory">${esc(c.desc.story)}</div>` : ""}
      ${skillsHtml(id)}
      ${equipSkillsHtml(id)}
      ${charTalentChips(id)}${backlinkHtml(c.name, id)}</div>`;
  } else if (e) {
    const tags = e.stats.tags;
    const dreqs = e.reqs.deck;
    const eEl = e.stats.element;
    const rs = e.reqs.play;
    /* 统一「依赖与限制」：牌组限制（构筑门槛）与打出限制（对局中生效）同构呈现。
       deckChar 的角色名做成可跳转 chip，直接顺藤摸瓜到角色详情 */
    const reqRow = r => {
      const el = reqElement(r);
      const col = el ? (ELE_COLOR[el] || "var(--gold)") : R_STYLE[r.code];
      let txt = esc(r.label);
      if (r.code === "deckChar" && r.charId != null && r.name)
        txt = txt.replace(`「${esc(r.name)}」`, `<button class="blchip" data-goto="${r.charId}" title="查看角色详情">${esc(r.name)}</button>`);
      return `<div class="rrow"><span class="rpill" style="color:${col}">${el ? eleIcon(el) : ""}${esc(r.short)}</span><span class="rtxt">${txt}</span></div>`;
    };
    const reqBlock = (dreqs.length || rs.length) ? `<div class="rblock">
      ${dreqs.length ? `<div class="rgroup rgroup-deck"><div class="rhead"><b>牌组限制</b><span class="rghint">加入牌组需满足</span></div>${dreqs.map(reqRow).join("")}</div>` : ""}
      ${rs.length ? `<div class="rgroup rgroup-play"><div class="rhead"><b>打出限制</b><span class="rghint">对局中生效</span></div>${rs.map(reqRow).join("")}</div>` : ""}
    </div>` : "";
    const relChip = e.rel.relatedCharacterId != null
      ? `<div class="drel"><b>关联角色</b><span class="blchips"><button class="blchip" data-goto="${e.rel.relatedCharacterId}">${eEl ? eleIcon(eEl) : ""}${esc(nameOfId(e.rel.relatedCharacterId))}</button></span></div>` : "";
    html = `${nav}<div class="dimg" data-lb="${id}" title="点击查看大图">${cardArtHtml(id, { kind: "detail", alt: e.name })}</div>
      <div class="dinfo"><h2>${esc(e.name)}</h2>
      <div class="meta"><span class="tagpill">${esc(e.typeZh)}</span>${eEl ? `<span class="tagpill">${eleIcon(eEl)}${esc(ELE_ZH[eEl] || eEl)}</span>` : ""}${costHtml(e.stats.cost)}${tags.map(t => `<span class="tagpill">${esc(t)}</span>`).join("")}${e.rel.relatedCharacterId ? `<span class="tagpill">关联：${esc(nameOfId(e.rel.relatedCharacterId))}</span>` : ""}<span class="tagpill">${esc(e.version || "")}</span></div>
      ${e.domain === "field" ? `<div class="dnote">对局实体：由技能或卡牌效果在对局中生成，不可加入牌组。</div>` : ""}
      ${reqBlock}
      <div class="dtext">${linkify(esc(e.desc.effect.trim()))}</div>
      ${skillsHtmlCard(id)}
      ${relChip}${e.rel.relatedCharacterId != null ? charTalentChips(e.rel.relatedCharacterId, id, true) : ""}${backlinkHtml(e.name, id)}</div>`;
  } else html = nav;
  $("detail").innerHTML = html;
}
function copyCardLink(): void {
  const top = topView();
  if (!top || top.kind !== "detail") return;
  copyText(location.href.split("#")[0] + "#card=" + top.id)
    .then(() => toast("链接已复制（打开即显示该卡详情）"), () => toast("复制失败", true));
};
function draftToggleModal(): void {
  const top = topView();
  if (!top || top.kind !== "detail") return;
  const id = top.id;
  if (isCharId(id)) {
    /* 角色是唯一的（3 个槽，同一角色不重复），所以角色仍按开关处理 */
    if (draft.chars.includes(id)) draftRemoveChar(id); else draftAdd(id);
  } else {
    /* 卡牌：主按钮永远是"加入"，加满时由 draftAdd 给出明确提示 */
    draftAdd(id);
  }
  renderOverlay();
};
/* 详情里的次级「移出」：把这张牌的全部份数从当前牌组去掉 */
function draftRemoveFromDetail(): void {
  const top = topView();
  if (!top || top.kind !== "detail") return;
  if (isCharId(top.id)) draftRemoveChar(top.id); else draftRemoveCard(top.id);
  renderOverlay();
};
/* 弹层内的操作按钮：模板只输出 data-act，具体调用在这里分发。
   以前是 onclick="fn()" 配 window.fn——模板字符串能调到任何东西，
   等于把模块边界又打开了一次，重构时也没法靠类型发现遗漏。
   详情页的收藏钮也在这里就近分发（卡库瓦片的星标在 85-views 自己的委托里处理）。 */
$("detail").addEventListener("click", ev => {
  const lb = (ev.target as HTMLElement).closest("[data-lb]") as HTMLElement | null;
  if (lb) { showLightbox(Number(lb.dataset.lb)); return; }
  const favB = (ev.target as HTMLElement).closest("[data-fav]") as HTMLElement | null;
  if (favB) {
    const on = toggleFav(Number(favB.dataset.fav));
    favB.classList.toggle("on", on);
    favB.setAttribute("aria-pressed", String(on));
    favB.title = on ? "取消收藏" : "收藏";
    favB.innerHTML = `${ICON_STAR} ${on ? "已收藏" : "收藏"}`;
    return;
  }
  const b = (ev.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
  if (!b) return;
  switch (b.dataset.act) {
    case "back": overlayBack(); break;
    case "close": overlayClose(); break;
    case "step": modalStep(Number(b.dataset.d) || 1); break;
    case "copyLink": copyCardLink(); break;
    case "draftToggle": draftToggleModal(); break;
    case "draftRemove": draftRemoveFromDetail(); break;
  }
});
/* 反链跳转：详情/术语弹层内的「被引用」chips */
document.addEventListener("click", ev => {
  const g = (ev.target as HTMLElement).closest("[data-goto]");
  if (!g) return;
  ev.stopPropagation();
  showDetail(Number(g.dataset.goto));
});

/* ---------- 卡面灯箱：详情页点击卡面 → 全屏原尺寸查看 ----------
   图片地址与详情页同源（imgFull 同 id），浏览器已缓存，打开零等待。
   ←/→ 沿详情的同级列表翻页（与详情翻页键位一致），Esc / 点空白关闭。 */
/* 退场动画进行中又重开/再关：先 cancel 再摆正类名（与 overlay 同一契约） */
let cancelLbClose: (() => void) | null = null;
function showLightbox(refId: number): void {
  const top = topView();
  const ids = top && top.kind === "detail" ? top.ids : [refId];
  let box = $("lightbox");
  if (!box || !box.classList) { box = document.createElement("div"); box.id = "lightbox"; if (document.body.appendChild) document.body.appendChild(box); }
  cancelLbClose?.(); cancelLbClose = null;
  box.classList.remove("closing");
  box.innerHTML = `<img src="${imgFull(refId)}" alt="" width="420" height="720" decoding="async">
    <button class="lb-x" data-act="close" title="关闭 (Esc)">${ICON_X}</button>
    ${ids.length > 1 ? `<button class="lb-nav lb-prev" data-lbstep="-1" title="上一张 (←)">‹</button><button class="lb-nav lb-next" data-lbstep="1" title="下一张 (→)">›</button>` : ""}`;
  box.dataset.ids = ids.join(",");
  box.dataset.idx = String(Math.max(0, ids.indexOf(refId)));
  hideTip();
  /* 打开走 setModalLayer（类名 + 登记 + 锁三事成对）；关闭带退场动画，锁由其 onStart 释放 */
  setModalLayer("lightbox", box, true, { order: 55, close: closeLightbox });
}
function closeLightbox(): void {
  const box = $("lightbox");
  if (!box || !box.classList) return;
  cancelLbClose?.(); cancelLbClose = null;
  if (box.classList.contains("show")) {
    /* 退场动画：遮罩淡出（reduced-motion / 测试环境走瞬时路径），锁随退场开始释放 */
    cancelLbClose = animateExit({ el: box, openCls: "show", closingCls: "closing", anim: "lb-out", onStart: syncScrollLock });
    return;
  }
  box.classList.remove("closing");   /* 退场中被打断：就地结束 */
  syncScrollLock();
}
const lightboxOpen = (): boolean => {
  const box = $("lightbox");
  return !!(box && box.classList && box.classList.contains("show"));
};
/* 启动即登记（元素可以懒建，层表不懒）：Esc 在首次开灯箱前也认识这层 */
registerLayer({ id: "lightbox", isOpen: lightboxOpen, close: closeLightbox, order: 55, modal: true });
function lightboxStep(d: number): void {
  const box = $("lightbox");
  if (!box || !box.dataset || !box.dataset.ids) return;
  const ids = box.dataset.ids.split(",").map(Number);
  const idx = Math.min(ids.length - 1, Math.max(0, Number(box.dataset.idx) + d));
  if (ids[idx] == null || box.dataset.idx === String(idx)) return;
  box.dataset.idx = String(idx);
  const img = box.querySelector ? box.querySelector("img") : null;
  if (img) img.setAttribute("src", imgFull(ids[idx]));
}
/* 灯箱交互：按钮 / 空白点击都走 document 委托（灯箱挂在 body 上，不在 #detail 里） */
document.addEventListener("click", ev => {
  const box = $("lightbox");
  if (!box || !box.classList || !box.classList.contains("show")) return;
  const t = ev.target as HTMLElement;
  const stepBtn = t.closest && (t.closest("[data-lbstep]") as HTMLElement | null);
  if (stepBtn) { lightboxStep(Number(stepBtn.dataset.lbstep) || 0); return; }
  if (t.closest && t.closest("[data-act=close]")) { closeLightbox(); return; }
  if (t.closest && t.closest("#lightbox img")) return;   /* 点图片本身不关闭 */
  if (t.id === "lightbox") closeLightbox();               /* 点空白（遮罩）关闭 */
});

/* ---------- 帮助面板（快捷键与说明，复用详情弹层容器） ---------- */
function showHelp() {
  overlayHashClear();        /* 帮助不是视图栈的一层：清栈（连同已推的历史） */
  state.overlayStack = [];
  $("detail").innerHTML = `<div class="navbtns"><button title="关闭 (Esc)" data-act="close">${ICON_X}</button></div>
    <div class="dinfo"><h2>快捷键与说明</h2>
    <div class="dtext">
<b>快捷键</b>
1 / 2 / 3 / 4　切换 卡库浏览 / 牌组卡面 / 牌组列表 / 技能图鉴
/　聚焦卡库检索框（不在卡库时先切换过去）
?　打开本帮助（无弹层时）
Esc　逐层回退：灯箱 → 概念下钻（每次退一层）→ 关闭弹层 → 牌组管理面板 → 历史面板 → 下拉菜单
← / →　详情页翻页（同级列表内相邻项）；灯箱打开时切上一张 / 下一张
↑ ↓ ← →　卡库网格内移动焦点（焦点在网格上时生效），Enter 打开详情
Ctrl+P　打印当前列表视图

<b>页头</b>
· 右上角是全局动作图标钮（悬浮可看说明）：主题三态（跟随系统 / 浅色 / 深色，跟随系统时随系统实时切换）、刷新数据、本帮助。

<b>卡库浏览</b>
· 检索分两步：先按类别 / 元素 / 费用等筛选卡池，再在结果内按关键词搜索，两步互不干扰。
· 类别数字是「可构筑 / 不可构筑」双计数（如「队伍状态 0/234」），默认只列可构筑的牌（${poolStats.buildable} 张）。
· 对局中生成的实体与历史版本变体折叠在「对局实体与历史变体」分组里，点标题展开；排序旁的「显示不可构筑」开关可把它们平铺进来（选择记在本地）。
· 筛选与检索状态会记在地址栏里，复制链接即可把当前屏分享给他人。
· 卡块上的「⇄」把卡加入对比（最多 4 张）；对比面板的「相似卡」按同类同费给出替换候选。

<b>详情与概念</b>
· 点击卡面看大图：灯箱里 ← / → 沿同级列表翻页，Esc 或点空白关闭。详情页的翻页（‹ ›）翻的也是同级列表——从牌组进入按牌组顺序，从卡库进入按当前筛选结果。
· 卡文中的术语（如「感电」）可悬浮预览释义，点击进入概念页；释义里的术语继续点进去可逐层下钻，返回钮 / Esc 逐层退回。
· 概念页里的卡牌 / 角色条目可反向跳到详情；「被引用」列出引用了该概念的其它卡牌。
· 类型以数据源为准：装备 / 支援（场地、伙伴、道具由标签标出）/ 事件牌可入牌组；状态 / 队伍状态 / 召唤物 / 附加状态是对局中生成的实体，不入牌组。

<b>技能</b>
· 「技能图鉴」页签收录全部角色技能与装备牌特技：按所属分组、类型筛选，支持名字 / 拼音 / 所属检索；点行进技能页（链接可分享），点组头的所属名看卡牌详情。
· 角色详情列出全部技能（含被动与准备技能）：行尾是费用（元素骰 + 充能）；准备技能标「准备 n 轮」，并可跳到它的「准备中状态」。

<b>牌组</b>
· 「加入牌组」把卡牌加入底部牌组栏：同名卡 2 张（秘传整套限 1 张），按钮显示份数，加满变「已满」，「移出」一次清空。
· 限制分两组：牌组限制（加入前校验，管理面板列出缺口）与打出限制（对局中生效——秘传限 1、天赋须在场、武器限定等）；卡面左上角徽标是同一套信息的简写。
· 底部牌组栏可管理多套牌组，凑齐 3 角色 + 30 行动牌后「生成分享码」给他人导入；「牌组工具 → 加载示例牌组」一键载入示例。
· 牌组分享码的解析框在牌组页签（卡面 / 列表）上方的操作条里，粘贴即自动解析。
· 「牌组工具 → 牌组对比」比较两套分享码：粘贴两套分享码或「用当前」，并排看新增 / 移除 / 数量变化。

<b>数据</b>
· 卡牌数据来自 piovium 官方静态数据（简体中文），规则与术语释义来自 genshin-db 快照${dataOrigins.has("builtin")
  ? "；本页已内置一份数据快照，断网也能浏览与构筑，卡面图仍需联网"
  : "，由站点随构建产物提供，刷新页面即取最新"}。
</div></div>`;
  setOverlayOpen(true);
}

/* ---------- 概念交互：悬浮=预览，点击=前往（可逐层下钻） ----------
   心智模型只有一条：
   · 悬停任意术语 → 浮层预览释义（只读，不改变当前页面）；
   · 点击任意术语 → 进入概念页（若该名字只对应唯一一个卡牌/角色身份，则直接开详情）；
   · 概念页里的术语链接继续压栈 → 沿概念链下钻；返回钮 / Esc 逐层退回来源卡牌。
   早期实现有两种点击行为（卡文里就地展开、概念页里下钻），所以「深钻」只在部分
   界面生效；现在统一走 state.overlayStack，任意入口（卡文、卡名、检索、被引用）表现一致。 */
const tip = document.createElement("div");
tip.id = "tip";
document.body.appendChild(tip);
/* 悬浮预览只在"真正有指针悬停能力"的设备上启用。
   触摸设备点按会先合成一次 mousemove，把预览点亮；紧接着 click 打开概念页，
   预览却没人收掉 —— 结果就是一个正常大小的弹层，外加一个小一号、被屏幕边缘
   切掉一半的预览框（它的 z-index 比遮罩高，浮在最上层）。 */
/* 悬停能力只随设备变，不在每次 mousemove 里现查 matchMedia：
   缓存 MediaQueryList，系统切换悬停偏好时 matches 自动跟随。 */
let hoverMQL: { matches: boolean } | null | undefined;
function canHover() {
  try {
    if (hoverMQL === undefined) {
      hoverMQL = typeof matchMedia === "function" ? matchMedia("(hover: hover) and (pointer: fine)") : null;
    }
    return !hoverMQL || hoverMQL.matches;
  } catch { return true; }
}
let tipTerm: string | null = null;      /* 预览当前展示的术语名，用于避免重复重建 DOM */
function hideTip() { if (tip && tip.classList) { tip.classList.remove("show"); tipTerm = null; } }
/* 概念预览的按需截断：不硬编码行数——内容渲染后实测量一下，放不下才裁，
   二分找「还能放下的最长前缀」并以省略号收尾；装得下就原样展示。
   裁剪只动描述段（最后一个 <p>）——名称 / 类别标签是定位信息，不参与牺牲。
   截断若由「清空后续节点」达成，幸存文本也会补上省略号，不留无标记的断头。
   带牌面的条目若牌面自身就超出预算，先逐级缩小牌面（78 → 60 → 44 → 隐藏）
   再裁文本；框体自身的 padding 提供底部留白，裁剪发生在内容区，不顶满框底。 */
function clampTip(): void {
  const maxH = Math.round(innerHeight * 0.72);
  if (!isFinite(maxH) || maxH <= 0) return;
  tip.style.maxHeight = maxH + "px";
  /* 溢出以「内容实际高度 vs 盒内容区」判定：box-sizing:border-box 下 max-height
     约束的是盒整体，scrollHeight/clientHeight 都是内容区口径，二者才可比 */
  const overflow = () => tip.scrollHeight > tip.clientHeight + 1;
  if (!overflow()) return;
  const ps = tip.querySelectorAll("p");
  const lastP = ps.length ? ps[ps.length - 1] : null;
  if (!lastP) return;                   /* 没有描述段：退回原生裁剪 */
  const walker = document.createTreeWalker ? document.createTreeWalker(lastP, NodeFilter.SHOW_TEXT) : null;
  if (!walker) return;
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const origTexts = nodes.map(t => t.data);
  const arts = tip.querySelectorAll(".term-art");

  /* 一轮「装填」：按给定牌面宽度重排内容并裁描述段，返回是否装得下。
     artWidth=null 保持原状；0 表示隐藏牌面。 */
  const attempt = (artWidth: number | null): boolean => {
    arts.forEach(a => {
      const el = a as HTMLElement;
      if (artWidth == null) return;
      if (!artWidth) { el.style.display = "none"; return; }
      el.style.display = "";
      el.style.width = artWidth + "px";
    });
    nodes.forEach((t, i) => { t.data = origTexts[i]; });
    if (!overflow()) return true;
    let cutSomething = false;
    for (let i = nodes.length - 1; i >= 0 && overflow(); i--) {
      const t = nodes[i];
      const orig = origTexts[i] || "";
      if (!orig.trim()) continue;       /* 空白节点直接跳过，继续往前裁 */
      let lo = 0, hi = orig.length, best = -1;
      while (lo <= hi) {                /* 二分：连同省略号一起量，找到装得下的最长前缀 */
        const mid = (lo + hi) >> 1;
        t.data = orig.slice(0, mid) + "…";
        if (overflow()) hi = mid - 1; else { best = mid; lo = mid + 1; }
      }
      if (best < 0) { t.data = ""; cutSomething = true; continue; }  /* 连省略号都放不下：清空，往前裁 */
      t.data = best >= orig.length ? orig : orig.slice(0, best) + "…";
      cutSomething = cutSomething || best < orig.length;
      break;                            /* 本节点收尾：之后（更早）的文本保持原样 */
    }
    /* 截断若由「清空后续节点」达成，幸存文本要补省略号——否则是不带标记的断头 */
    if (cutSomething) {
      const kept = nodes.filter(t => t.data);
      const last = kept[kept.length - 1];
      if (last && !last.data.endsWith("…")) {
        const orig = origTexts[nodes.indexOf(last)];
        let lo = 0, hi = orig.length, best = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          last.data = orig.slice(0, mid) + "…";
          if (overflow()) hi = mid - 1; else { best = mid; lo = mid + 1; }
        }
        last.data = best > 0 ? orig.slice(0, best) + "…" : "…";
      }
    }
    return !overflow();
  };

  if (attempt(null)) return;
  for (const w of [60, 44, 0]) if (attempt(w)) return;
  /* 牌面隐藏、描述段裁完仍装不下（极端小窗）：接受原生裁剪 */
}
document.addEventListener("mousemove", ev => {
  /* 触摸设备没有悬停：不显示预览（触屏的"预览"由点击后的概念页承担）。
     弹层内不在此禁用——卡文里的术语在详情弹层里同样需要悬浮预览，
     真正要处理的是"弹层打开那一刻的残留"，由 setOverlayOpen 负责收起。 */
  if (!canHover()) { hideTip(); return; }
  const el = (ev.target as HTMLElement).closest ? (ev.target as HTMLElement).closest(".term") : null;
  if (!el) { hideTip(); return; }
  const termName = el.dataset.term;
  if (!termName) { hideTip(); return; }
  const entries = termEntries(termName);
  if (!entries.length) { hideTip(); return; }
  /* mousemove 会连续触发：只有换了术语才重建内容，避免每次移动都重写 DOM */
  if (tipTerm !== termName) {
    tipTerm = termName;
    tip.innerHTML = `<div class="tip-kind">${entries.map(e => KIND_ZH[e.kind] || e.kind).join(" / ")}</div>${termHtml(entries)}`;
  }
  tip.classList.add("show");
  clampTip();
  /* 四边钳制：以前只挡了右/下边界，靠屏幕右侧点时 x 会算成负数，
     预览框左半截跑到视口外，看起来像"被截断的第二个框"。 */
  const r = tip.getBoundingClientRect();
  const pad = 8;
  let x = ev.clientX + 16, y = ev.clientY + 18;
  if (x + r.width > innerWidth - pad) x = ev.clientX - r.width - 12;
  if (y + r.height > innerHeight - pad) y = ev.clientY - r.height - 12;
  x = Math.max(pad, Math.min(x, innerWidth - r.width - pad));
  y = Math.max(pad, Math.min(y, innerHeight - r.height - pad));
  tip.style.left = x + "px"; tip.style.top = y + "px";
});
/* 指针离开 / 页面滚动 / 触摸开始 → 收起预览（触摸开始就收，避免它跟着手指残留在屏幕上） */
document.addEventListener("touchstart", hideTip, { passive: true });
/* 滚动事件不冒泡，用捕获阶段在文档上兜住任意滚动容器 */
document.addEventListener("scroll", ev => {
  /* tip 内部滚动（读长释义）不算离开：目标是 tip 自身或其后代时不隐藏 */
  const t = ev.target as Node | null;
  if (t && typeof (tip as unknown as { contains?: (n: Node) => boolean }).contains === "function"
    && (tip as unknown as { contains: (n: Node) => boolean }).contains(t)) return;
  hideTip();
}, true);
/* 概念页：一个名字可能匹配多个条目（如「结晶」= 场地牌 + 反应术语），
   从上到下并列；带卡牌/角色身份的条目附「查看详情」直达其详情页 */
function renderTermView(v) {
  const name = v.name;
  const entries = termEntries(name);
  if (!entries.length) { overlayBack(); return; }
  const depth = state.overlayStack.filter(x => x.kind === "term").length;
  const depthTag = depth > 1 ? `<span class="tm-depth" title="概念下钻层级">${depth} 层</span>` : "";
  $("detail").innerHTML = `${navBar(depthTag)}
    <div class="dinfo"><h2>${esc(name)}</h2>
    <div class="meta">${entries.map(e => `<span class="tagpill">${KIND_ZH[e.kind] || e.kind}</span>`).join("")}</div>
    <div class="dexp">${termHtml(entries, true, name)}</div>
    ${backlinkHtml(name)}</div>`;
}
/* 打开 / 下钻概念页。弹层已开 → 压栈；同名连续点击不重复压栈 */
function showTermModal(name, fromHistory = false) {
  if (!termEntries(name).length) return;
  const top = topView();
  if (top && top.kind === "term" && top.name === name) return;
  if (!overlayOpen()) state.overlayStack = [];
  state.overlayStack.push({ kind: "term", name });
  const nt = topView();
  const h = overlayHashOf(nt);
  if (!fromHistory && h) { overlayHashPush(h); nt!.hpushed = true; }
  renderOverlay();
}
/* 概念点击路由（纯函数）：唯一身份（卡牌 / 角色）→ 直接开详情；
   唯一技能 → 直接开技能页；其余（含同名多义）→ 概念页并列 */
function termRoute(entries) {
  if (!entries || !entries.length) return "none";
  const only = entries.length === 1 ? entries[0] : null;
  if (!only) return "term";
  if (only.kind === "card" || only.kind === "char") return "detail";
  if (only.kind === "skill") return "skill";
  return "term";
}
/* 术语统一入口：按路由决定去向（唯一身份 → 详情 / 唯一技能 → 技能页 / 其余 → 概念页）。
   卡文术语、检索结果行、被引用 chip 都走这一条，避免"同一个名字在不同入口落到不同页面"。 */
function openTermName(name) {
  const entries = termEntries(name);
  if (!entries.length) return;
  const route = termRoute(entries);
  const first = entries[0];
  if (route === "detail" && first.id != null) showDetail(first.id);
  else if (route === "skill" && first.key) showSkill(first.key);
  else showTermModal(name);
}
/* 捕获阶段处理术语点击：避免触发行/卡片的点击（卡片 → 详情） */
document.addEventListener("click", ev => {
  const t = (ev.target as HTMLElement).closest ? (ev.target as HTMLElement).closest(".term") : null;
  if (!t) return;
  ev.stopPropagation();
  openTermName(t.dataset.term);
}, true);
/* 技能入口：角色详情里的技能行、概念页里的「查看技能」chip */
document.addEventListener("click", ev => {
  const el = (ev.target as HTMLElement).closest ? (ev.target as HTMLElement).closest("[data-skill]") : null;
  if (!el) return;
  ev.stopPropagation();
  showSkill(el.dataset.skill);
});
/* 点击遮罩空白处：关闭整个弹层（连同视图栈） */
$("overlay").addEventListener("click", ev => {
  if (ev.target === $("overlay")) overlayClose();
});

/* ---------- 牌面加载事件的统一入口 ----------
   load / error 不冒泡，但捕获阶段能在 document 上接住所有图片的加载结果。
   这里替代模板里的内联 onload/onerror：内联处理器引用的是全局函数，
   生产 IIFE 没有全局（P4 去全局化后残留，会抛 ReferenceError 兜底失效）。
   处理函数住在 model（数据语义），接线在这里（与其他 document 监听同处）。 */
document.addEventListener("load", ev => {
  const t = ev.target as HTMLImageElement | null;
  if (t && t.tagName === "IMG" && t.classList.contains("noart-icon")) artIconReady(t);
  /* 卡面图淡入：load 后加 .ld，配合 CSS 的 opacity 过渡（shimmer 占位在图到前打底） */
  if (t && t.tagName === "IMG" && t.classList.contains("card-img")) t.classList.add("ld");
}, true);
document.addEventListener("error", ev => {
  const t = ev.target as HTMLImageElement | null;
  if (!t || t.tagName !== "IMG") return;
  if (t.classList.contains("noart-icon")) { artIconFail(t); return; }
  artFallback(t);
}, true);
/* 弹层内方向键导航；Esc 统一由全局处理器逐层关闭（见文末快捷键区）。
   灯箱打开时 ←/→ 归灯箱翻页（99-main 的全局处理器负责）——这里同时再翻一次详情
   会触发整弹层的不可见全量重渲染（双触发事故）。 */
document.addEventListener("keydown", ev => {
  if (!$("overlay").classList.contains("show")) return;
  if (lightboxOpen()) return;
  if (ev.key === "ArrowLeft") modalStep(-1);
  if (ev.key === "ArrowRight") modalStep(1);
});
["view-grid", "view-list"].forEach(v => $(v).addEventListener("click", ev => {
  const el = (ev.target as HTMLElement).closest("[data-id]");
  if (el) showDetail(Number(el.dataset.id));
}));

export { backlinkHtml, charTalentChips, draftHas, deckActionHtml, topView, overlayOpen, setOverlayOpen, pagerContextFor, detailView, renderedView, renderOverlay, showDetail, overlayBack, overlayClose, modalStep, viewLabel, navBar, pagerHtml, renderDetailView, showHelp, showLightbox, closeLightbox, lightboxOpen, lightboxStep, tip, canHover, tipTerm, hideTip, renderTermView, showTermModal, termRoute, openTermName, syncOverlayToHash };
