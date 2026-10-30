/* 七圣召唤浏览器 · 详情弹层、弹层导航、帮助面板与概念交互。
   源码按领域拆分，由 src/sources.mjs 统一声明加载顺序；单文件版构建时按同一顺序内联。 */
"use strict";

/* ---------- 详情弹层（含限制、关联与反链导航） ---------- */
/* 反链 chips：引用该概念的其他卡牌/角色，点击跳转详情。
   同名多版本（如「增殖生命体」有火/水/草/雷四张状态牌）只出一个 chip——
   否则会并排出现四个一模一样的按钮，既分不清也没法选；代表条目优先取可构筑版本，
   title 里注明还有几个同名条目。 */
function backlinkHtml(name, selfId) {
  const b = backlinks.get(name);
  if (!b || !b.size) return "";
  /* 准备状态影子不进"被引用"：它只是技能自己的运行时标记，列出来会与技能同名同义 */
  const ids = [...b].filter(x => x !== selfId && !isShadowState(entById.get(x)));
  if (!ids.length) return "";
  const byName = new Map();      /* 卡片显示名 → { id, n } */
  for (const id of ids) {
    const t = charById.get(id) || entById.get(id);
    if (!t) continue;
    const cur = byName.get(t.name);
    if (!cur) byName.set(t.name, { id, n: 1, deckable: t.shareId != null });
    else {
      cur.n++;
      if (!cur.deckable && t.shareId != null) { cur.id = id; cur.deckable = true; }
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
/* 角色天赋牌 chips（卡牌详情中排除自身，避免自指） */
function charTalentChips(charId, excludeId) {
  const list = ENT.filter(x => x.relatedCharacterId === charId && (x.tags || []).includes("GCG_TAG_TALENT"));
  if (!list.length) return "";
  return `<div class="drel"><b>天赋牌</b><span class="blchips">` + list.map(x =>
    `<button class="blchip${x.id === excludeId ? " self" : ""}" data-goto="${x.id}" title="${esc(x.name)}${x.id === excludeId ? "（当前卡牌）" : ""}">${esc(x.name)}</button>`).join("") + `</span></div>`;
}
function draftHas(id) { return charById.has(id) ? draft.chars.includes(id) : draft.cards.has(id); }
/* 详情页的主行动：加入牌组。
   同名卡可以放 2 张（秘传 1 张，见 80-deck 的 copyLimit），所以这里不能做成
   「加入 / 移出」二选一——那只允许加 1 张。已加入时按钮写「再加一张 ×1/2」，
   加满才禁用；移出另作次级入口，一次清掉这张卡的全部份数。 */
function deckActionHtml(id, joinable, c) {
  if (!joinable) return "";
  if (c) {
    const has = draft.chars.includes(id);
    return `<button class="jbtn${has ? " in" : ""}" title="${has ? "点击移出当前牌组" : "加入当前牌组（共 3 个角色槽）"}" onclick="draftToggleModal()">${has ? "移出牌组" : "加入牌组"}</button>`;
  }
  const n = draft.cards.get(id) || 0, max = copyLimit(id);
  const add = n < max
    ? `<button class="jbtn${n ? " in" : ""}" title="加入当前牌组（同名上限 ${max} 张）" onclick="draftToggleModal()">${n ? `＋ 再加一张 ${n}/${max}` : "＋ 加入牌组"}</button>`
    : `<button class="jbtn in" disabled title="同名卡上限 ${max} 张，已加满">✓ 已满 ${n}/${max}</button>`;
  const out = n ? `<button class="lbtn" title="从当前牌组移出（共 ${n} 张）" onclick="draftRemoveFromDetail()">移出</button>` : "";
  return add + out;
}
/* ---------- 弹层导航模型 ----------
   弹层内部是一个「视图栈」，元素只有两种：
     · detail —— 卡牌 / 角色详情，自带同级翻页上下文（ids / idx）
     · term   —— 概念页；概念页里的术语链接继续压栈，可沿概念链一路深钻
   返回（‹ / Esc）逐层弹出：概念 → 来源概念 → … → 来源卡牌 → 关闭弹层。
   所有入口（卡面 / 列表 / 卡库 / 检索 / 深链 / 反链 chip / 术语链接）都走
   showDetail / showTermModal 这一条路径，因此翻页与下钻在任意界面表现一致。 */
function topView() { return overlayStack.length ? overlayStack[overlayStack.length - 1] : null; }
const overlayOpen = () => $("overlay").classList.contains("show");

/* 弹层的开关统一走这里：显示/隐藏 + 锁定背景滚动。
   只挂 fixed 遮罩是不够的——弹层滚到边界后滚动链会继续传给文档，
   于是"在弹层里上下滑，背景的卡面视图跟着动"。锁住文档滚动是最直接的断链方式，
   补偿 scrollbar 宽度避免锁定瞬间页面横向跳动。 */
function setOverlayOpen(open) {
  const ov = $("overlay");
  if (!ov || !ov.classList) return;
  const wasOpen = ov.classList.contains("show");
  ov.classList.toggle("show", open);
  const root = document.documentElement;
  if (root && root.classList) root.classList.toggle("ovl-lock", open);
  const body = document.body;
  if (body && body.style) {
    if (open && !wasOpen) {
      const sbw = root && typeof root.clientWidth === "number" ? window.innerWidth - root.clientWidth : 0;
      body.style.paddingRight = sbw > 0 ? sbw + "px" : "";
    } else if (!open) body.style.paddingRight = "";
  }
  if (open) hideTip();      /* 弹层盖上来时，残留的悬浮预览会浮在遮罩之上 */
}

/* 同级翻页列表：按打开入口推断——卡库 → 当前实际展示的卡牌（筛选结果或检索命中）；
   牌组 → 牌组内顺序。（旧实现把"牌组顺序"和"导航上下文"混成一个 modalList，
   从卡库/检索打开详情时会被压成单张，此后再从卡面视图打开详情也仍是单张。） */
function pagerContextFor(id) {
  if (currentView === "browse") {
    const ids = browseVisibleIds();
    if (ids.includes(id)) return ids;
  }
  return deckOrder.includes(id) ? deckOrder : [id];
}
function detailView(id, ids) {
  const list = ids && ids.length ? ids.slice() : [id];
  const i = list.indexOf(id);
  return { kind: "detail", id, ids: list, idx: i < 0 ? 0 : i };
}
/* 每个视图自己记住滚动位置：翻页 / 下钻后回到顶部，返回时回到原来的位置。
   旧实现每次 innerHTML 重建都会把弹层滚回顶部，返回对比面板后要重新往下找。 */
let renderedView = null;
/* resetScroll：翻页 / 换了一张卡时强制回到顶部；其余重渲染沿用视图自己的位置 */
function renderOverlay(resetScroll) {
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
  if (top.kind === "term") renderTermView(top);
  else if (top.kind === "skill") renderSkillView(top);
  else if (top.kind === "compare") renderCompareView(top);
  else if (top.kind === "deckdiff") renderDeckDiffView(top);
  else if (top.kind === "odds") renderOddsView(top);
  else renderDetailView(top);
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
function showDetail(id, ids) {
  id = Number(id);
  const top = topView();
  if (overlayOpen() && top && top.kind === "detail" && top.id === id) return;
  if (!overlayOpen()) overlayStack = [];
  overlayStack.push(detailView(id, ids || pagerContextFor(id)));
  renderOverlay();
}
function overlayBack() {
  overlayStack.pop();
  if (!overlayStack.length) { setOverlayOpen(false); return; }
  renderOverlay();
}
function overlayClose() { overlayStack = []; setOverlayOpen(false); }
/* 翻页：同一列表内前后跳 */
function modalStep(d) {
  const top = topView();
  if (!top || top.kind !== "detail") return;
  const n = top.idx + d;
  if (n < 0 || n >= top.ids.length) return;
  top.id = top.ids[n]; top.idx = n;
  renderOverlay(true);
}
window.overlayBack = overlayBack;
window.overlayClose = overlayClose;
window.modalStep = modalStep;
/* 视图标签（返回钮文字）：概念名 / 卡牌名 */
function viewLabel(v) {
  if (!v) return "";
  if (v.kind === "term") return v.name;
  if (v.kind === "skill") { const s = skillOf(v.key); return s ? s.name : "技能"; }
  if (v.kind === "compare") return "卡牌对比";
  if (v.kind === "deckdiff") return "牌组对比";
  if (v.kind === "odds") return "抽牌概率";
  const c = charById.get(v.id), e = entById.get(v.id);
  return (c && c.name) || (e && e.name) || "上一页";
}
/* 弹层顶栏：返回（仅栈深 > 1 时出现）+ 自定义按钮组 + 关闭 */
function navBar(extra = "") {
  const prev = overlayStack.length > 1 ? overlayStack[overlayStack.length - 2] : null;
  const back = prev
    ? `<button class="lbtn tm-back" title="返回「${esc(viewLabel(prev))}」" onclick="overlayBack()">‹ ${esc(viewLabel(prev))}</button>` : "";
  return `<div class="navbtns">${back}${extra}
      <button title="关闭 (Esc)" onclick="overlayClose()">✕</button></div>`;
}
/* 翻页控件：同级列表不足 2 张时不出现（避免"永远禁用"的误导），多张时显示位置「3/22」 */
function pagerHtml(v) {
  if (v.ids.length < 2) return "";
  return `<span class="pgbar" title="同一列表内翻页（← →）">
      <button title="上一张 (←)" ${v.idx <= 0 ? "disabled" : ""} onclick="modalStep(-1)">‹</button>
      <span class="pgnum">${v.idx + 1}/${v.ids.length}</span>
      <button title="下一张 (→)" ${v.idx >= v.ids.length - 1 ? "disabled" : ""} onclick="modalStep(1)">›</button>
    </span>`;
}
function renderDetailView(v) {
  const id = v.id;
  const c = charById.get(id), e = entById.get(id);
  /* 只有带分享码 id 的条目能进牌组：对局实体（状态/召唤物/附加状态）与历史变体
     都不可构筑，给它们显示「加入牌组」只会点出一个失败的 toast */
  const joinTarget = c || e;
  const joinable = !!joinTarget && joinTarget.shareId != null;
  /* 主行动（加入牌组）文字化，一眼可读；复制链接降为次级 */
  const joinBtn = deckActionHtml(id, joinable, c);
  const cmpOn = compareState.ids.includes(id);
  const cmpBtn = joinable
    ? `<button class="lbtn${cmpOn ? " on" : ""}" data-cmp="${id}" data-cmp-label="对比" title="加入卡牌对比（最多 ${COMPARE_MAX} 张）">${cmpOn ? "✓ 已选" : "对比"}</button>` : "";
  /* 已选 2 张及以上时，详情里就能直接打开对比面板；返回仍回到这张卡 */
  const cmpOpenBtn = compareState.ids.length >= 2
    ? `<button class="lbtn" data-cmpopen="1" title="打开卡牌对比面板">⇄ ${compareState.ids.length}</button>` : "";
  const nav = navBar(`${pagerHtml(v)}${joinBtn}${cmpBtn}${cmpOpenBtn}<button class="lbtn" title="复制该卡链接" onclick="copyCardLink()">复制链接</button>`);
  let html;
  if (c) {
    const el = charElement(c);
    const tags = c.tags.filter(t => !t.startsWith("GCG_TAG_ELEMENT")).map(tagZh).filter(Boolean);
    html = `${nav}<div class="dimg">${cardArtHtml(id, { kind: "detail", alt: c.name })}</div>
      <div class="dinfo"><h2>${esc(c.name)}</h2>
      <div class="meta">${el ? `<span class="tagpill">${eleIcon(el)}${esc(ELE_ZH[el] || el)}</span>` : ""}${tags.map(t => `<span class="tagpill">${esc(t)}</span>`).join("")}<span class="tagpill">生命 ${c.hp}</span><span class="tagpill">充能上限 ${enPips(c.maxEnergy)}</span><span class="tagpill">${esc(c.sinceVersion || "")}</span></div>
      ${c.storyText ? `<div class="dtext dstory">${linkify(esc(c.storyText.trim()))}</div>` : ""}
      ${skillsHtml(id)}
      ${charTalentChips(id)}${backlinkHtml(c.name, id)}</div>`;
  } else if (e) {
    const tags = e.tags.map(tagZh).filter(Boolean);
    const dreqs = deckReqsOf(e);
    const eEl = cardElement(e);
    const rs = restrictionsOf(e);
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
    const relChip = e.relatedCharacterId != null
      ? `<div class="drel"><b>关联角色</b><span class="blchips"><button class="blchip" data-goto="${e.relatedCharacterId}">${eEl ? eleIcon(eEl) : ""}${esc(charById.get(e.relatedCharacterId)?.name || e.relatedCharacterId)}</button></span></div>` : "";
    html = `${nav}<div class="dimg">${cardArtHtml(id, { kind: "detail", alt: e.name })}</div>
      <div class="dinfo"><h2>${esc(e.name)}</h2>
      <div class="meta"><span class="tagpill">${esc(typeZhOf(e))}</span>${eEl ? `<span class="tagpill">${eleIcon(eEl)}${esc(ELE_ZH[eEl] || eEl)}</span>` : ""}${costHtml(e.playCost)}${tags.map(t => `<span class="tagpill">${esc(t)}</span>`).join("")}${e.relatedCharacterId ? `<span class="tagpill">关联：${esc(charById.get(e.relatedCharacterId)?.name || e.relatedCharacterId)}</span>` : ""}<span class="tagpill">${esc(e.sinceVersion || "")}</span></div>
      ${isFieldEntity(e) ? `<div class="dnote">对局实体：由技能或卡牌效果在对局中生成，不可加入牌组。</div>` : ""}
      ${reqBlock}
      <div class="dtext">${linkify(esc((e.description || "").trim()))}</div>
      ${relChip}${e.relatedCharacterId != null ? charTalentChips(e.relatedCharacterId, id) : ""}${backlinkHtml(e.name, id)}</div>`;
  } else html = nav;
  $("detail").innerHTML = html;
}
window.copyCardLink = () => {
  const top = topView();
  if (!top || top.kind !== "detail") return;
  copyText(location.href.split("#")[0] + "#card=" + top.id)
    .then(() => toast("链接已复制（打开即显示该卡详情）"), () => toast("复制失败", true));
};
window.draftToggleModal = () => {
  const top = topView();
  if (!top || top.kind !== "detail") return;
  const id = top.id;
  if (charById.has(id)) {
    /* 角色是唯一的（3 个槽，同一角色不重复），所以角色仍按开关处理 */
    if (draft.chars.includes(id)) draftRemoveChar(id); else draftAdd(id);
  } else {
    /* 卡牌：主按钮永远是"加入"，加满时由 draftAdd 给出明确提示 */
    draftAdd(id);
  }
  renderOverlay();
};
/* 详情里的次级「移出」：把这张牌的全部份数从当前牌组去掉 */
window.draftRemoveFromDetail = () => {
  const top = topView();
  if (!top || top.kind !== "detail") return;
  if (charById.has(top.id)) draftRemoveChar(top.id); else draftRemoveCard(top.id);
  renderOverlay();
};
/* 反链跳转：详情/术语弹层内的「被引用」chips */
document.addEventListener("click", ev => {
  const g = ev.target.closest("[data-goto]");
  if (!g) return;
  ev.stopPropagation();
  showDetail(Number(g.dataset.goto));
});

/* ---------- 帮助面板（快捷键与说明，复用详情弹层容器） ---------- */
function showHelp() {
  overlayStack = [];   /* 帮助不是视图栈的一层：先清栈，关闭时不会退回旧页面 */
  $("detail").innerHTML = `<div class="navbtns"><button title="关闭 (Esc)" onclick="overlayClose()">✕</button></div>
    <div class="dinfo"><h2>快捷键与说明</h2>
    <div class="dtext">
<b>快捷键</b>
1 / 2 / 3　切换 卡面视图 / 列表视图 / 卡库浏览
/　聚焦卡库检索框（不在卡库时先切换过去）
Esc　逐层回退：概念下钻（每次退一层）→ 上一视图 → 关闭弹层 → 牌组管理 → 历史面板
← / →　详情页翻页（同级列表内相邻项）
Ctrl+P　打印当前列表视图

<b>使用说明</b>
· 顶部输入框只解析牌组分享码。卡牌检索在「卡库浏览」顶部：先按类别 / 元素 / 费用等筛选卡池，再在筛选结果内按关键词检索，两个阶段互不重置。
· 卡文中的术语（如「感电」「幻戏倒计时」）可悬浮预览释义；点击进入概念页，一个名字有多条解释时并列展示。
· <b>角色技能</b>全部列出（含被动技能与准备技能），技能行右侧是它的费用：元素骰 + 充能。点技能行看完整效果；准备技能会标出「准备 n 轮」，并可跳到它的「准备中状态」。
· <b>类型</b>以数据源为准：装备牌 / 支援牌（场地、伙伴、道具由标签额外标出）/ 事件牌 / 状态牌（挂在角色上）/ 队伍状态（挂在队伍上）/ 召唤物 / 附加状态。后四类是对局中生成的实体，不进入牌组；卡库里归入「对局实体与历史变体」折叠分组，并标为「不可构筑」。
· 概念页可逐层下钻：释义里的其它术语继续点进去，会在弹层内叠一层（顶部返回钮显示来源名称，多概念层时右侧标出层数）；返回钮或 Esc 逐层退回，直到回到最初那张卡牌。
· 概念页里的卡牌/角色条目自带「查看详情」，可反向从概念跳到具体卡牌；「被引用」则列出引用了该概念的其它卡牌。
· 详情页的翻页（‹ › / ← →）翻的是「同级列表」：从卡面/列表进入 → 牌组内顺序；从卡库进入 → 当前筛选结果或检索命中列表。
· 卡牌详情页的「被引用」可顺藤摸瓜引用该概念的卡牌；「加入牌组」把卡牌加入底部牌组。同名卡可放 2 张（秘传牌整套限 1 张）：按钮会显示当前份数（1/2），加满后变为「已满」，旁边的「移出」一次清空这张卡。
· <b>卡库默认只列可构筑的牌</b>（${poolStats.buildable} 张），对局中生成的状态 / 召唤物与历史版本变体收在底部的「对局实体与历史变体」分组里，点标题展开即可查数据；检索结果同样把不可构筑的命中折叠在该分组中。排序右侧的<b>「显示不可构筑」开关</b>可以把这些项直接平铺进来（选择记在本地），适合查对局实体数据。
· 类别筛选的数字是<b>「可构筑 / 不可构筑」双计数</b>（如「队伍状态 0/234」），一眼能看出这类里有没有能组进牌组的牌。卡库按页挂载、滑出视口多页后自动释放，长列表滑动不卡、内存不随滚动增长。
· <b>依赖与限制</b>统一在详情页分两组呈现：<b>牌组限制</b>（加入牌组前就要满足——需包含某角色、至少 2 名某元素/地区/阵营角色）与<b>打出限制</b>（对局中生效——秘传限 1、天赋须在场、武器限定、限打张数）。卡面左上角的徽标是同一套信息的简写，悬浮可看完整说明。
· 牌组限制会实时校验：不满足「才能加入牌组」的卡无法加入当前牌组，管理面板也会列出缺口（如「需要牌组中包含至少 2 名冰元素角色（当前 1）」）。
· 卡库浏览支持多维筛选，筛选状态会编码进地址栏（#b=...），复制链接即可分享当前视图。「显示不可构筑」开关也编在里面（u=1），对方打开就是同一屏；但链接只改这一屏，不会动对方本机的默认偏好。
· 卡块上的「⇄」把卡加入对比（最多 4 张）；对比面板的「相似卡」按同类型 / 同费用 / 标签重合给出替换候选，可直接换入对比。
· 「更多 → 牌组对比」比较两套分享码；「更多 → 抽牌概率」查看费用曲线与关键牌起手 / 前几回合的抽到概率（超几何分布，不含调度）。
· 底部牌组栏可管理多套牌组；凑齐 3 角色 + 30 行动牌后「生成分享码」，可复制给他人导入。

<b>数据来源</b>
卡牌数据来自 piovium 官方静态数据服务（static-data.piovium.org，v5 · 简体中文）${BUILTIN_DATA
  ? "，本单文件已内置一份数据快照，断网也能浏览与构筑；卡面图仍需联网，「更多 → 刷新数据」可拉取官方最新数据"
  : "，首次加载后缓存于浏览器本地，24 小时自动更新"}；规则与术语释义来自 genshin-db 静态快照。明显是测试用途的卡牌（名称含（test）/（Test）等标记，当前 ${poolStats.testFiltered} 张）不进入卡库与检索；与技能同名的「准备中状态」并入技能页（当前 ${poolStats.shadowFiltered} 个）。状态牌 / 队伍状态 / 附加状态在数据源里没有牌面，界面给它们同比例（420:720）的「卡壳」并叠上 128×128 的对局状态图标，卡壳本身用类型色与类型字标明这是对局实体、不是卡牌；极少数连图标都没有的（数据源缺图）只留 ◈ 卡壳。解码与编码逻辑移植自 genius-invokation @gi-tcg/assets-manager（AGPL-3.0）。
</div></div>`;
  setOverlayOpen(true);
}

/* ---------- 概念交互：悬浮=预览，点击=前往（可逐层下钻） ----------
   心智模型只有一条：
   · 悬停任意术语 → 浮层预览释义（只读，不改变当前页面）；
   · 点击任意术语 → 进入概念页（若该名字只对应唯一一个卡牌/角色身份，则直接开详情）；
   · 概念页里的术语链接继续压栈 → 沿概念链下钻；返回钮 / Esc 逐层退回来源卡牌。
   早期实现有两种点击行为（卡文里就地展开、概念页里下钻），所以「深钻」只在部分
   界面生效；现在统一走 overlayStack，任意入口（卡文、卡名、检索、被引用）表现一致。 */
const tip = document.createElement("div");
tip.id = "tip";
document.body.appendChild(tip);
/* 悬浮预览只在"真正有指针悬停能力"的设备上启用。
   触摸设备点按会先合成一次 mousemove，把预览点亮；紧接着 click 打开概念页，
   预览却没人收掉 —— 结果就是一个正常大小的弹层，外加一个小一号、被屏幕边缘
   切掉一半的预览框（它的 z-index 比遮罩高，浮在最上层）。 */
function canHover() {
  try {
    return !(typeof matchMedia === "function") || matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch { return true; }
}
let tipTerm = null;      /* 预览当前展示的术语名，用于避免重复重建 DOM */
function hideTip() { if (tip && tip.classList) { tip.classList.remove("show"); tipTerm = null; } }
document.addEventListener("mousemove", ev => {
  /* 触摸设备没有悬停：不显示预览（触屏的"预览"由点击后的概念页承担）。
     弹层内不在此禁用——卡文里的术语在详情弹层里同样需要悬浮预览，
     真正要处理的是"弹层打开那一刻的残留"，由 setOverlayOpen 负责收起。 */
  if (!canHover()) { hideTip(); return; }
  const el = ev.target.closest ? ev.target.closest(".term") : null;
  if (!el) { hideTip(); return; }
  const entries = termEntries(el.dataset.term);
  if (!entries.length) { hideTip(); return; }
  /* mousemove 会连续触发：只有换了术语才重建内容，避免每次移动都重写 DOM */
  if (tipTerm !== el.dataset.term) {
    tipTerm = el.dataset.term;
    tip.innerHTML = `<div class="tip-kind">${entries.map(e => KIND_ZH[e.kind] || e.kind).join(" / ")}</div>${termHtml(entries)}`;
  }
  tip.classList.add("show");
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
document.addEventListener("scroll", hideTip, true);
/* 概念页：一个名字可能匹配多个条目（如「结晶」= 场地牌 + 反应术语），
   从上到下并列；带卡牌/角色身份的条目附「查看详情」直达其详情页 */
function renderTermView(v) {
  const name = v.name;
  const entries = termEntries(name);
  if (!entries.length) { overlayBack(); return; }
  const depth = overlayStack.filter(x => x.kind === "term").length;
  const depthTag = depth > 1 ? `<span class="tm-depth" title="概念下钻层级">${depth} 层</span>` : "";
  $("detail").innerHTML = `${navBar(depthTag)}
    <div class="dinfo"><h2>${esc(name)}</h2>
    <div class="meta">${entries.map(e => `<span class="tagpill">${KIND_ZH[e.kind] || e.kind}</span>`).join("")}</div>
    <div class="dexp">${termHtml(entries, true, name)}</div>
    ${backlinkHtml(name)}</div>`;
}
/* 打开 / 下钻概念页。弹层已开 → 压栈；同名连续点击不重复压栈 */
function showTermModal(name) {
  if (!termEntries(name).length) return;
  const top = topView();
  if (top && top.kind === "term" && top.name === name) return;
  if (!overlayOpen()) overlayStack = [];
  overlayStack.push({ kind: "term", name });
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
  if (route === "detail") showDetail(entries[0].id);
  else if (route === "skill") showSkill(entries[0].key);
  else showTermModal(name);
}
/* 捕获阶段处理术语点击：避免触发行/卡片的点击（卡片 → 详情） */
document.addEventListener("click", ev => {
  const t = ev.target.closest ? ev.target.closest(".term") : null;
  if (!t) return;
  ev.stopPropagation();
  openTermName(t.dataset.term);
}, true);
/* 技能入口：角色详情里的技能行、概念页里的「查看技能」chip */
document.addEventListener("click", ev => {
  const el = ev.target.closest ? ev.target.closest("[data-skill]") : null;
  if (!el) return;
  ev.stopPropagation();
  showSkill(el.dataset.skill);
});
/* 点击遮罩空白处：关闭整个弹层（连同视图栈） */
$("overlay").addEventListener("click", ev => {
  if (ev.target === $("overlay")) overlayClose();
});
/* 弹层内方向键导航；Esc 统一由全局处理器逐层关闭（见文末快捷键区） */
document.addEventListener("keydown", ev => {
  if (!$("overlay").classList.contains("show")) return;
  if (ev.key === "ArrowLeft") window.modalStep(-1);
  if (ev.key === "ArrowRight") window.modalStep(1);
});
["view-grid", "view-list"].forEach(v => $(v).addEventListener("click", ev => {
  const el = ev.target.closest("[data-id]");
  if (el) showDetail(Number(el.dataset.id));
}));

