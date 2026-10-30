/* src/ 应用源码 · 数据模型（类型分类 / 技能实体 / 卡面兜底）逻辑验证
   覆盖用户报告的四类问题：
   1) 准备技能只能看到状态牌、看不到技能效果；
   2) 队伍状态（ONSTAGE）被当成场地牌；
   3) 无卡面的实体请求图片 404（如纵阵武力统筹）；
   4) 技能费用（元素骰 + 充能）没有展示。 */
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
  await ensureData();
  const ent = id => recordOfId(id);

  /* ===== 1. 类型分类：唯一来源 ===== */
  const zh = id => (ent(id) || {}).typeZh || "";
  assert(TYPE_ZH.GCG_CARD_ONSTAGE === "队伍状态", "类型表：GCG_CARD_ONSTAGE → 队伍状态（不再是场地牌）");
  assert(zh(117) === "队伍状态", "激化领域（ONSTAGE）→ 队伍状态");
  assert(zh(113135) === "状态牌", "纵阵武力统筹（STATE）→ 状态牌");
  assert(TYPE_ZH.GCG_CARD_ASSIST === "支援牌", "类型表：GCG_CARD_ASSIST → 支援牌（不再叫援助牌）");
  const place = pool.find(x => x.id === 321001);
  assert(place && place.type === "支援牌" && place.tags.includes("场地"), "场地类支援牌：类型=支援牌，场地由 tag 表达");
  assert(!pool.some(x => x.type === "场地牌"), "卡池里不再有把对局状态标成「场地牌」的条目");
  assert(pool.filter(x => x.typeRaw === "GCG_CARD_ONSTAGE").every(x => x.domain === "field"), "ONSTAGE 全部归入 field 域（对局实体）");
  assert(TYPE_ZH.GCG_CARD_STATE === "状态牌" && TYPE_ZH.GCG_CARD_SUMMON === "召唤物", "状态牌 / 召唤物译名保持不变");

  /* ===== 2. 准备技能：可查看、且指向技能而不是同名状态 ===== */
  const beidou = chars().find(c => c.name === "北斗");
  const beidouId = idOf(beidou);
  const taChao = skillsOf(beidouId).find(s => s.name === "踏潮");
  assert(!!taChao, "北斗「踏潮」进入技能索引");
  assert(taChao.hidden === true && taChao.prepared === true, "踏潮是隐藏的准备技能（hidden + prepared）");
  assert(/造成3点雷元素伤害/.test(taChao.effect), "踏潮效果可读：" + taChao.effect);
  assert(taChao.stateId === 114055, "踏潮关联准备中状态实体 114055");
  const shadowEnt = ent(114055);
  assert(isShadowId(114055), "同名状态 114055 被识别为准备状态影子");
  assert(!termEntries("踏潮").some(e => e.kind === "card"), "踏潮 不再以状态牌身份占据概念名");
  assert(termRoute(termEntries("踏潮")) === "skill", "点击踏潮 → 技能页");
  assert(!pool.some(x => x.id === 114055), "准备状态不进卡池（不与技能抢名字）");
  assert(poolStats.shadowFiltered === cards().filter(r => r.flags.shadow).length && poolStats.shadowFiltered > 0,
    "准备状态计数：" + poolStats.shadowFiltered);

  const leiying = chars().find(c => c.name === "愚人众·雷萤术士");
  const ting = termEntries("霆电迸发");
  assert(ting.length === 1 && ting[0].kind === "skill", "霆电迸发 → 唯一技能条目");
  assert(/造成2点雷元素伤害/.test(ting[0].desc), "霆电迸发效果：造成2点雷元素伤害");

  /* ===== 3. 技能费用：元素骰 + 充能 ===== */
  const zhuolang = skillsOf(beidouId).find(s => s.name === "捉浪");
  assert(zhuolang.cost.some(c => c.type === "GCG_COST_DICE_ELECTRO" && c.count === 3), "捉浪：雷元素骰 ×3");
  const zhuoLei = skillsOf(beidouId).find(s => s.name === "斫雷");
  assert(zhuoLei.cost.some(c => c.type === "GCG_COST_ENERGY" && c.count === 3), "斫雷：充能 ×3");
  assert(/充能×3/.test(skillCostText(zhuoLei)), "费用文本含充能：" + skillCostText(zhuoLei));
  const rowHtml = skillRowHtml(zhuoLei);
  assert(/class="die en"/.test(rowHtml) && /data-skill=/.test(rowHtml), "技能行渲染充能图标且可点击");

  /* ===== 4. 角色详情：隐藏技能不再被过滤 ===== */
  showDetail(beidouId);
  const detailHtml = String(document.getElementById("detail").innerHTML || "");
  assert(detailHtml.includes("踏潮"), "角色详情列出准备技能「踏潮」");
  assert((detailHtml.match(/data-skill=/g) || []).length === skillsOf(beidouId).length,
    "北斗详情技能行数 = 技能索引条数（" + skillsOf(beidouId).length + "）");
  assert(!/【/.test(detailHtml), "技能标题不再用【】包裹（改为徽标 + 行块）");

  /* ===== 5. 技能页：压栈 / 费用 / 所属角色 / 准备状态 ===== */
  state.overlayStack = [];
  showSkill(taChao.key);
  assert(state.overlayStack.length === 1 && topView().kind === "skill" && topView().key === taChao.key,
    "showSkill 压入技能层");
  const skHtml = String(document.getElementById("detail").innerHTML || "");
  assert(skHtml.includes("踏潮") && skHtml.includes("需准备 1 个行动轮"), "技能页：名称 + 准备轮数徽标");
  assert(skHtml.includes("data-goto=\\"114055\\""), "技能页：通往准备中状态的入口");
  assert(skHtml.includes("data-goto=\\"1405\\""), "技能页：所属角色入口（北斗 1405）");
  showSkill(taChao.key);
  assert(state.overlayStack.length === 1, "重复点同一技能不重复压栈");
  state.overlayStack = [];

  /* ===== 6. 卡面兜底：无牌面实体输出同比例卡壳 + 状态图标 ===== */
  const art = cardArtHtml(113135, { kind: "detail" });
  assert(art.includes("noart") && !art.includes("/image/"), "纵阵武力统筹：已知缺图，连图标也不请求");
  assert(art.includes('data-kind="state"'), "卡壳带类型标记：" + (art.match(/data-kind="([^"]*)/) || [])[1]);
  assert(art.includes("状态牌"), "卡壳标明类型：" + (art.match(/noart-kind">([^<]*)/) || [])[1]);
  assert(art.includes("noart-detail"), "详情页卡壳走 detail 变体");
  const artCard = cardArtHtml(212111, { kind: "tile" });
  assert(artCard.includes("<img") && artCard.includes("/image/212111"), "有卡面的牌仍输出 <img>");
  assert(artCard.includes('width="420"') && artCard.includes('height="720"'), "真牌面仍写死 420×720 预留尺寸");

  /* 无牌面但状态图标可用：图标叠在卡壳上，不当作牌面 */
  const st = cardArtHtml(100, { kind: "tile" });
  assert(st.includes('data-kind="state"') && st.includes("noart-tile"), "状态牌：卡壳 + state 类型");
  assert(st.includes("noart-disc") && st.includes("/image/100"), "状态牌：请求 128×128 状态图标");
  assert(st.includes('class="noart-icon"') && st.includes('onerror="artIconFail(this)"'), "图标失败可降级");
  assert(!/class="noart[^"]*hasicon/.test(st), "初始不预设 hasicon（等图标真正到达）");
  assert(st.includes('width="128"') && st.includes('height="128"'), "图标写死 128×128，避免撑开卡壳");
  /* 类型 → 卡壳配色键：四类对局实体各自可辨 */
  const kindOf = id => (cardArtHtml(id).match(/data-kind="([^"]*)"/) || [])[1];
  const sampleOf = t => idOf(cards().find(e => e.typeRaw === t && !e.art.hasFace) || cards()[0]);
  assert(kindOf(100) === "state", "状态牌 → state");
  assert(kindOf(sampleOf("GCG_CARD_ATTACHMENT")) === "attach", "附加状态 → attach");
  assert(kindOf(sampleOf("GCG_CARD_ONSTAGE")) === "team", "队伍状态 → team");
  const summon = cards().find(e => e.typeRaw === "GCG_CARD_SUMMON");
  assert(!!summon && cardArtHtml(idOf(summon)).includes("<img"), "召唤物有真牌面，走牌面分支：" + (summon ? summon.name : "无样例"));
  /* 已知缺图的 4 个 id 都不发请求 */
  const noIcon = [113135, 116074, 303215, 303246].filter(id => cardArtHtml(id).includes("/image/"));
  assert(noIcon.length === 0, "4 个已知缺图 id 均不请求：" + noIcon.join(","));

  showDetail(113135);
  const zyHtml = String(document.getElementById("detail").innerHTML || "");
  assert(zyHtml.includes("noart") && !zyHtml.includes("/image/113135"), "详情页同样不请求缺失的卡面");
  assert(zyHtml.includes("对局实体：由技能或卡牌效果在对局中生成"), "详情页说明该实体不可加入牌组");
  state.overlayStack = [];

  /* ===== 7. 概念并列顺序：机制术语在技能之前 ===== */
  const hx = termEntries("幻戏").map(e => e.kind);
  assert(hx[0] === "keyword" && hx.includes("skill"), "同名时规则术语先于技能：" + hx.join("+"));

  /* ===== 8. 技能文本里的「技能：X」可下钻 ===== */
  const zhuolangDesc = zhuolang.effect;
  const linked = linkify(esc(zhuolangDesc));
  assert(linked.includes('data-term="踏潮"'), "捉浪卡文中的「准备技能：踏潮」被标记为可点击");

  /* ===== 9. 展示去重：被引用 chips 同名合并、单条目概念页不重复种类 ===== */
  const bl = backlinkHtml("草元素伤害");
  const labels = [...bl.matchAll(/class="blchip"[^>]*>([^<]+)</g)].map(m => m[1]);
  assert(labels.length > 3, "被引用 chips 渲染：" + labels.slice(0, 4).join("/") + "…（" + labels.length + "）");
  assert(new Set(labels).size === labels.length, "同名多版本只出一个 chip（" + labels.length + " 个标签均唯一）");
  assert(!labels.includes("踏潮"), "准备状态影子不出现在被引用的同名 chip 里");
  const oneKind = termHtml(termEntries("草元素伤害"), true, "草元素伤害");
  assert(!oneKind.includes("<small>术语</small>"), "单条目概念页正文不再重复「术语」（页头徽标已标）");

})();
`;

await t.run(harness);
t.finish();
