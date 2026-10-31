/* src/ 应用源码 · 弹层导航验证：同级翻页上下文（任意入口）+ 视图栈（概念下钻/返回） */
import { createTest } from "./_env.mjs";

const t = createTest();
const { assert } = t;

const harness = `
return (async () => {
  /* 记录视图：卡池与索引都从这里取，测试断言的是同一份数据 */
  const chars = () => charRecords();
  const cards = () => cardRecords();
  const idOf = r => Number(r.key.slice(r.key.indexOf(":") + 1));
  const recByName = n => cards().find(r => r.name === n) || chars().find(r => r.name === n);
  await decodeAndRender(SAMPLE, { noHash: true });

  /* ===== 1. 卡面视图入口：翻页上下文 = 牌组内顺序 ===== */
  state.currentView = "grid";
  const deckIds = state.deckOrder.slice();
  assert(deckIds.length === 22, "牌组顺序索引：" + deckIds.length + " 项（3 角色 + 19 行动牌）");
  overlayClose();
  showDetail(deckIds[3]);
  /* 详情页的操作按钮：模板只输出 data-act，由 #detail 上的委托分发。
     以前是 onclick="fn()" 配 window.fn——模板字符串能调到任何东西，
     等于把模块边界重新打开，重构时也没法靠类型发现遗漏。 */
  const detailHtml = document.getElementById("detail").innerHTML;
  assert(/data-act="close"/.test(detailHtml), "详情页关闭按钮带 data-act（不依赖全局函数）");
  assert(/data-act="step"/.test(detailHtml), "详情页翻页按钮带 data-act");
  assert(!/onclick=/.test(detailHtml), "详情页不含内联 onclick");
  const t1 = topView();
  assert(t1.kind === "detail" && t1.ids.length === deckIds.length && t1.idx === 3,
    "卡面视图打开详情：翻页上下文 = 牌组顺序（位置 4/" + deckIds.length + "）");
  assert(pagerHtml(t1).includes("4/" + deckIds.length), "翻页控件显示当前位置「4/22」");
  modalStep(1);
  assert(topView().id === deckIds[4] && topView().idx === 4, "下一张：跳到牌组内后一张");
  modalStep(-1);
  assert(topView().id === deckIds[3] && topView().idx === 3, "上一张：回到原卡");
  overlayClose();
  showDetail(deckIds[0]);
  assert(state.overlayStack.length === 1 && topView().idx === 0, "第一张：idx=0（上一张按钮禁用）");
  modalStep(-1);
  assert(topView().idx === 0, "边界：第一张再上一张无效，不越界");

  /* ===== 2. 单张列表不渲染翻页控件（避免「永远禁用」的误导） ===== */
  assert(pagerHtml({ ids: [1], idx: 0 }) === "", "列表仅 1 项：不渲染翻页控件");

  /* ===== 3. 卡库浏览入口：翻页上下文 = 当前可见列表 ===== */
  overlayClose();
  state.currentView = "browse";
  Object.assign(browseState, { type: "", el: "", cost: "", energy: "", tag: "", ver: "", sort: "name", dir: 1 });
  const browseIds = browseVisibleIds();
  showDetail(browseIds[7]);
  assert(topView().ids.length === browseIds.length && topView().idx === 7,
    "卡库入口：翻页上下文 = 当前可见列表（" + browseIds.length + " 张，位置 8）");
  assert(!browseIds.some(id => !!recordOfId(id)?.flags.test), "卡库翻页列表不含测试卡");
  /* 默认视图只列可构筑的牌：不可构筑的实体/变体收在折叠分组里，不参与翻页 */
  assert(browseIds.every(id => shareOfId(id) != null),
    "卡库折叠态：翻页列表只含可构筑条目");
  assert(browseIds.length < pool.length, "卡库折叠态：可见列表小于全库（" + browseIds.length + "/" + pool.length + "）");

  /* ===== 4. 卡库检索态：翻页上下文 = 命中列表（仅卡牌/角色） ===== */
  overlayClose();
  state.currentView = "browse";
  searchState.q = "芙宁娜";
  searchState.results = [
    { kind: "card", id: deckIds[3] }, { kind: "char", id: deckIds[0] },
    { kind: "keyword", name: "无关概念条目" },
  ];
  showDetail(deckIds[0]);
  assert(topView().ids.length === 2 && topView().idx === 1,
    "检索态入口：翻页上下文 = 命中卡牌（概念条目不计入，位置 2/2）");
  modalStep(1);
  assert(topView().id === deckIds[0], "检索命中列表末项：下一张无效");
  searchState.q = ""; searchState.results = [];

  /* ===== 5. 回归：从卡库打开过详情后，卡面视图仍能翻页（旧实现被永久压成单张） ===== */
  overlayClose();
  state.currentView = "browse";
  showDetail(browseIds[3]);
  overlayClose();
  state.currentView = "grid";
  showDetail(deckIds[6]);
  assert(topView().ids.length === deckIds.length,
    "回归：卡库开过详情后，卡面视图翻页上下文不被污染（" + topView().ids.length + " 项）");

  /* ===== 6. 深链 #card=：id 在牌组内时同样可翻页 ===== */
  overlayClose();
  showDetail(deckIds[5]);
  assert(topView().ids.length === deckIds.length && topView().idx === 5,
    "深链进入详情：只要 id 在牌组内，翻页上下文同样成立");

  /* ===== 7. 反链 / 关联跳转：同列表内保留翻页；跨列表压栈 ===== */
  overlayClose();
  showDetail(deckIds[2]);
  showDetail(deckIds[9]);
  assert(state.overlayStack.length === 2 && topView().id === deckIds[9] && topView().ids.length === deckIds.length,
    "关联跳转同列表：压栈且保留翻页上下文");
  overlayBack();
  assert(state.overlayStack.length === 1 && topView().id === deckIds[2], "返回：回到上一张卡牌");
  showDetail(deckIds[2]);
  assert(state.overlayStack.length === 1, "重复打开同一张：不重复压栈");

  /* ===== 8. 概念下钻：卡牌详情 → 概念 → 更深概念 → 逐层返回 ===== */
  overlayClose();
  showDetail(deckIds[0]);
  showTermModal("出战角色");
  assert(state.overlayStack.length === 2 && topView().kind === "term", "卡牌详情 → 概念页：压栈");
  showTermModal("手牌");
  assert(state.overlayStack.length === 3, "概念页 → 更深概念：继续压栈");
  const termHtmlOut = String($("detail").innerHTML);
  assert(termHtmlOut.includes("navbtns") && termHtmlOut.includes("tm-depth"), "概念页：含顶栏与下钻层数指示");
  overlayBack();
  overlayBack();
  assert(state.overlayStack.length === 1 && topView().kind === "detail", "逐层返回：回到来源卡牌详情");
  overlayBack();
  assert(state.overlayStack.length === 0 && !$("overlay").classList.contains("show"), "栈空：关闭弹层");

  /* ===== 9. 空概念名兜底：不打开空页面 ===== */
  showTermModal("这个术语不存在xyz");
  assert(state.overlayStack.length === 0 && !$("overlay").classList.contains("show"), "未收录的概念名：不打开弹层");

  /* ===== 10. 多卡对比：选择上限、差异行、仅看差异 ===== */
  overlayClose();
  compareState.ids = [];
  assert(String(browseTile(browseFilter()[0])).includes("data-cmp"), "卡库卡块：含对比选择钮");
  const cmpIds = deckIds.slice(3, 7);   /* 牌组内前 4 张行动牌 */
  cmpIds.forEach(toggleCompare);
  assert(compareState.ids.length === 4, "对比选择：连续加入 4 张");
  assert($("compareBar").classList.contains("show") && String($("compareBar").innerHTML).includes("对比"),
    "对比栏：选择后出现且含对比按钮");
  toggleCompare(deckIds[7]);
  assert(compareState.ids.length === 4, "对比上限：第 5 张被拒绝");
  toggleCompare(cmpIds[0]);
  assert(compareState.ids.length === 3, "再次点击：移出对比");
  showCompare();
  assert(topView().kind === "compare" && state.overlayStack.length === 1, "打开对比面板：压入单层视图");
  const cmpHtml = String($("detail").innerHTML);
  assert(cmpHtml.includes("cmp-table") && cmpHtml.includes("仅看差异"), "对比面板：表格 + 仅看差异开关");
  const cmpRows = compareRows(cmpIds.slice(1));
  assert(cmpRows.some(r => r.diff), "对比字段：不同卡之间存在差异行");
  const sameLabel = cmpRows.find(r => !r.diff)?.label;
  topView().onlyDiff = true; renderOverlay();
  assert(sameLabel && !String($("detail").innerHTML).includes(">" + sameLabel + "<"),
    "仅看差异：相同字段被隐藏");

  /* ===== 10b. 相似卡替换建议 ===== */
  const srcId = cmpIds[1];
  const sims = similarCards(srcId, 5);
  assert(sims.length > 0 && sims.every(s => s.id !== srcId), "相似卡：返回候选且不含自身");
  assert(sims.every(s => {
    const a = pool.find(x => x.id === srcId), b = pool.find(x => x.id === s.id);
    return a && b && a.kind === b.kind && (a.kind === "char" || a.typeRaw === b.typeRaw);
  }), "相似卡：候选与源卡同类型");
  const swapTo = sims.find(s => !compareState.ids.includes(s.id));
  assert(!!swapTo, "相似卡：存在未在对比中的候选");
  topView().showSim = true; renderOverlay();
  const simHtml = String($("detail").innerHTML);
  assert(simHtml.includes("相似卡替换") && simHtml.includes("换入"), "对比面板：相似卡区块与换入按钮");
  assert(swapCompare(srcId, swapTo.id), "相似卡：换入成功");
  assert(compareState.ids.includes(swapTo.id) && !compareState.ids.includes(srcId), "相似卡：换入替换原卡");
  assert(topView().ids.includes(swapTo.id), "相似卡：换入后对比视图同步");
  overlayClose();
  compareState.ids = [cmpIds[1]];
  showCompare();
  assert(!overlayOpen(), "少于 2 张：不打开对比面板");

  /* ===== 10c. 对比入口与偏好 ===== */
  overlayClose();
  compareState.ids = [cmpIds[1], cmpIds[2]];
  showDetail(deckIds[0]);
  assert(String($("detail").innerHTML).includes("打开卡牌对比面板"),
    "详情顶栏：已选 2 张时出现对比面板入口");
  showCompare();
  assert(state.overlayStack.length === 2 && topView().kind === "compare",
    "从详情打开对比：压栈保留来源详情");
  overlayBack();
  assert(topView().kind === "detail" && topView().id === deckIds[0], "对比返回：回到来源详情");
  overlayClose();
  comparePrefs.onlyDiff = false;
  showCompare();
  topView().onlyDiff = true;
  comparePrefs.onlyDiff = true;
  overlayClose();
  showCompare();
  assert(topView().onlyDiff === true, "对比偏好：重新打开记住「仅看差异」");
  comparePrefs.onlyDiff = false;
  overlayClose();

  /* ===== 10d. 弹层滚动位置记忆 ===== */
  showDetail(deckIds[0]);
  $("detail").scrollTop = 180;
  renderOverlay();
  assert($("detail").scrollTop === 180, "重渲染：保留弹层滚动位置");
  modalStep(1);
  assert($("detail").scrollTop === 0, "详情翻页：滚动回到顶部");
  overlayClose();

  /* ===== 11. 牌组差异：同码无差异 / 换牌 / 换角色 ===== */
  overlayClose();
  assert(parseShareIds(SAMPLE).cardIds.length === 30, "解析复用：分享码 → 3 角色 + 30 张行动牌");
  const sameDiff = diffDecks(SAMPLE, SAMPLE);
  assert(sameDiff.added.length === 0 && sameDiff.removed.length === 0 && sameDiff.changed.length === 0 && sameDiff.charAdded.length === 0,
    "同码对比：无新增 / 移除 / 变化");
  const base = parseShareIds(SAMPLE);
  const used = new Set([...base.charIds, ...base.cardIds]);
  const altCard = cards().find(e => e.share != null && !used.has(idOf(e)) && !e.flags.test);
  const altCardIds = decodeRaw(SAMPLE).slice();
  /* 必须替换「只带 1 张」的行动牌：替换 2 张中的一张只会变成数量变化，不是移除 */
  const singleSlot = altCardIds.findIndex((sid, i) => i >= 3 && base.countMap.get(idOfShare(sid)) === 1);
  assert(singleSlot >= 3, "换牌用例：找到仅 1 张的行动牌槽位");
  altCardIds[singleSlot] = altCard.share;
  const altCode = encodeRaw(altCardIds);
  const cardDiff = diffDecks(SAMPLE, altCode);
  assert(cardDiff.added.length === 1 && cardDiff.removed.length === 1 && cardDiff.changed.length === 0,
    "换一张行动牌：新增 1 种 / 移除 1 种");
  const altChar = chars().find(c => c.share != null && !base.charIds.includes(idOf(c)) && !c.flags.test);
  const altCharIds = decodeRaw(SAMPLE).slice();
  altCharIds[2] = altChar.share;
  const charCode = encodeRaw(altCharIds);
  const charDiff = diffDecks(SAMPLE, charCode);
  assert(charDiff.charAdded.length === 1 && charDiff.charRemoved.length === 1,
    "换角色：角色差异按名字统计");
  state.overlayStack = [{ kind: "deckdiff", a: SAMPLE, b: altCode, res: cardDiff, err: "", showSame: false }];
  renderOverlay();
  const dd = String($("detail").innerHTML);
  assert(dd.includes("牌组差异对比") && dd.includes("行动牌差异") && dd.includes("费用曲线"),
    "差异面板：摘要 / 行动牌表 / 费用曲线");
  assert(dd.includes("新增 <b>1</b>") && dd.includes("移除 <b>1</b>"), "差异面板：新增与移除计数");
  topView().showSame = true; renderOverlay();
  assert(String($("detail").innerHTML).includes("只看差异"), "显示相同卡：切换按钮文案");
  overlayClose();

  /* ===== 12. 抽牌概率与费用曲线 ===== */
  const stats = oddsDeckStats();
  assert(stats.total === 30 && stats.byCost.length === 6 && stats.uniq.length > 0,
    "抽牌统计：30 张行动牌 / 6 档费用 / 关键牌列表");
  assert(hyperAtLeast(30, 2, 30, 1) === 1 && hyperAtLeast(30, 2, 0, 1) === 0,
    "超几何：抽满必中、不抽不中");
  const p5 = hyperAtLeast(30, 2, 5, 1), p7 = hyperAtLeast(30, 2, 7, 1), p9 = hyperAtLeast(30, 2, 9, 1);
  assert(p5 > 0 && p5 < 1 && p7 > p5 && p9 > p7, "超几何：概率随抽牌数单调上升");
  state.overlayStack = [{ kind: "odds", pick: stats.uniq[0].id }];
  renderOverlay();
  const od = String($("detail").innerHTML);
  assert(od.includes("费用曲线") && od.includes("起手 5 张") && od.includes("至少 1 张"),
    "抽牌面板：曲线 / 起手 / 概率表");
  assert(od.includes("data-oddspick") && od.includes("平均费用"), "抽牌面板：关键牌选择器与统计");
  assert(od.includes("回合模拟") && od.includes("可打出 · 含调和"), "抽牌面板：回合模拟区块（规则常量源自官方规则词条）");
  overlayClose();

  /* ===== 13. 回合模拟（蒙特卡洛，种子确定性） ===== */
  const pickCard = stats.uniq.find(x => x.count >= 2) || stats.uniq[0];
  const sim = simTurns({ total: 30, copies: pickCard.count, playCost: pickCard.playCost, seed: 7 });
  const sim2 = simTurns({ total: 30, copies: pickCard.count, playCost: pickCard.playCost, seed: 7 });
  assert(JSON.stringify(sim) === JSON.stringify(sim2), "模拟：同种子两次运行逐位一致（确定性）");
  /* turn0 = 起手 5 张：非秘传牌的到手率应落在超几何解析值 ±1.5%（2 万次抽样噪声 ≈ 0.35%） */
  const analytic0 = hyperAtLeast(30, pickCard.count, 5, 1);
  assert(Math.abs(sim.inHand[0] - analytic0) < 0.015,
    "模拟 vs 解析：起手到手率一致（模拟 " + sim.inHand[0].toFixed(3) + " / 解析 " + analytic0.toFixed(3) + "）");
  const analyticLast = hyperAtLeast(30, pickCard.count, 5 + sim.turns.length - 1 <= 30 ? (5 + (sim.turns.length - 1) * 2) : 30, 1);
  assert(Math.abs(sim.inHand[sim.turns.length - 1] - Math.min(1, analyticLast)) < 0.015,
    "模拟 vs 解析：末回合到手率一致");
  const mono = (arr) => arr.every((v, i) => i === 0 || v >= arr[i - 1] - 1e-9);
  assert(mono(sim.inHand) && mono(sim.playable), "曲线单调不降（手牌只增、关键牌不弃）");
  assert(sim.playable.every((v, i) => v >= sim.playableRaw[i] - 1e-9),
    "含调和的可打出率 ≥ 不调和（同一批骰子抽样，配对比较）");
  /* 秘传必在起手：playCost 带 GCG_COST_LEGEND 的牌到手率起手即 1 */
  const legendCard = stats.uniq.find(x => (x.playCost || []).some(pc => pc.type === "GCG_COST_LEGEND"));
  if (legendCard) {
    const simL = simTurns({ total: 30, copies: legendCard.count, playCost: legendCard.playCost, seed: 3 });
    assert(simL.inHand[0] === 1, "秘传必在起手（官方规则词条）：模拟起手到手率 = 1");
  }
  /* 纯秘传标记（0 骰费用）：在手即可打出——曾因 diceTotal>0 闸门被误判为永不可打出 */
  const simZ = simTurns({ total: 30, copies: 1, playCost: [{ type: "GCG_COST_LEGEND", count: 1 }], seed: 5 });
  assert(simZ.inHand[0] === 1 && simZ.playable[0] === 1 && simZ.playableRaw[0] === 1,
    "纯秘传标记（0 骰费用）：起手必带且在手即打出（两列同为 100%）");
  /* 重投（官方规则：投骰后每回合可重投一次）：同种子配对下，重投后的可打出率逐回合 ≥ 不重投 */
  const simR = simTurns({ total: 30, copies: 1, playCost: [{ type: "GCG_COST_DICE_PYRO", count: 3 }], seed: 11 });
  const simN = simTurns({ total: 30, copies: 1, playCost: [{ type: "GCG_COST_DICE_PYRO", count: 3 }], seed: 11, reroll: false });
  assert(simR.playable.every((v, i) => v >= simN.playable[i] - 1e-9)
    && simR.playableRaw.every((v, i) => v >= simN.playableRaw[i] - 1e-9),
    "重投（闲置骰全重投）：同种子配对下可打出率单调不降");
  assert(simR.playableRaw[simR.turns.length - 1] > simN.playableRaw[simN.turns.length - 1],
    "重投对元素需求牌有实质增益（末回合不调和列严格更高："
    + simR.playableRaw[simR.turns.length - 1].toFixed(3) + " > " + simN.playableRaw[simN.turns.length - 1].toFixed(3) + "）");
  /* parseCost：充能/秘传位不计骰子，元素与万能位归一 */
  const pc = parseCost([{ type: "GCG_COST_DICE_PYRO", count: 2 }, { type: "GCG_COST_ENERGY", count: 2 }, { type: "GCG_COST_DICE_VOID", count: 1 }]);
  assert(pc.diceTotal === 3 && pc.needs.PYRO === 2 && pc.needs.VOID === 1, "parseCost：充能位剔除、元素/万能归一");
  /* minTunes：万能先补缺口，剩余缺口就是最少调和数 */
  assert(minTunes({ PYRO: 1, VOID: 1 }, { PYRO: 2 }) === 0, "minTunes：万能补缺口");
  assert(minTunes({ HYDRO: 2 }, { PYRO: 1, CRYO: 1 }) === 2, "minTunes：双色全缺 = 2 次调和");

})();
`;

await t.run(harness);
t.finish();
