/* src/ 统一数据集 · 装备牌特技、叙事文本不链接、牌面统一
   覆盖用户报告：
   1) 某些特技（装备牌赋予的技能）不在牌库中，搜不到也点不动；
   2) 角色简介里的关键词被当成概念；
   3) 概念深钻里有牌面的牌不渲染牌面。
   反向验证：数据集统计与 Brotli 产物一致，避免"只测运行时、数据包坏了没人发现"。 */
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

  /* ===== 1. 装备牌特技进入技能索引 ===== */
  const yueSheng = skillsOfCard(113154).find(s => s.name === "跃升");
  assert(!!yueSheng, "驰轮车·跃升 的特技「跃升」进入技能索引");
  assert(yueSheng.ownerKind === "card" && yueSheng.ownerCardId === 113154, "跃升 归属卡牌 113154（不是角色）");
  assert(skillsOf(113154).length === 0, "角色技能查询不会返回卡牌特技");
  const zhuan = skillsOfCard(116102).find(s => s.name === "转转冲击");
  assert(!!zhuan && /岩元素伤害/.test(zhuan.effect), "转转冲击效果可读：" + (zhuan ? zhuan.effect.slice(0, 20) : "无"));

  /* ===== 2. 特技可被概念索引命中、可被卡文链接 ===== */
  const entries = termEntries("跃升");
  assert(entries.some(e => e.kind === "skill"), "跃升 进入概念索引（kind=skill）");
  assert(termRoute(entries) === "skill", "点击跃升 → 技能页");
  const linked = linkify(esc("特技：跃升"));
  assert(linked.includes('data-term="跃升"'), "卡文「特技：跃升」被标记为可点击");
  const linked2 = linkify(esc("特技：转转冲击"));
  assert(linked2.includes('data-term="转转冲击"'), "卡文「特技：转转冲击」被标记为可点击");

  /* 检索：特技不在牌库（pool）里，但必须能通过概念索引被搜到 */
  const hits = searchCards("跃升", { limit: 20 });
  assert(hits.some(r => r.kind === "concept" && r.name === "跃升"), "检索「跃升」返回结果（不再因不在牌库而丢失）");
  const hits2 = searchCards("转转冲击", { limit: 20 });
  assert(hits2.some(r => r.name === "转转冲击"), "检索「转转冲击」命中");

  /* ===== 3. 技能页有牌面（用所属卡牌作视觉锚点） ===== */
  state.overlayStack = [];
  showSkill(yueSheng.key);
  const skHtml = String(document.getElementById("detail").innerHTML || "");
  assert(skHtml.includes('class="dimg"') && skHtml.includes("/image/113154"), "技能页渲染所属卡牌牌面");
  assert(skHtml.includes("所属卡牌"), "技能页标注「所属卡牌」而不是「所属角色」");
  state.overlayStack = [];

  /* ===== 4. 角色简介不产生术语链接 ===== */
  const furina = chars().find(c => c.name === "芙宁娜") || chars()[0];
  showDetail(idOf(furina));
  const detailHtml = String(document.getElementById("detail").innerHTML || "");
  const story = (detailHtml.match(/<div class="dtext dstory">([\\s\\S]*?)<\\/div>/) || [])[1] || "";
  assert(!!story, "角色详情含简介区");
  assert(!story.includes('class="term"'), "简介区不产生概念链接");
  assert(!story.includes("data-term="), "简介区不含 data-term");

  /* 悬浮预览 / 概念页的角色简介同规则（下沉后的数据形状）：简介在 story 字段、
     desc 只装可链接文本——渲染端对 story 只转义不 linkify。
     （回归：tip 里角色简介被 linkify，叙事文本出现可点术语） */
  let storyChars = 0, badStory = "";
  for (const ch of DATASET.records) {
    if (ch.kind !== "char" || !ch.desc.story || !ch.linkable) continue;
    const e = termEntries(ch.name).find(x => x.kind === "char");
    if (!e) continue;
    storyChars++;
    if (!e.story || e.desc) { badStory = ch.name; break; }
  }
  assert(storyChars > 100 && !badStory,
    "角色概念条目全部走 story 字段且 desc 为空（" + storyChars + " 个" + (badStory ? "，首例异常：" + badStory : "") + "）");
  const mln = termEntries("玛拉妮").find(x => x.kind === "char");
  if (mln) {
    assert(!!mln.story && !termBodyHtml(mln, false, false).includes('class="term"'),
      "悬浮预览的角色简介不含术语链接（玛拉妮）");
  }

  /* ===== 5. 概念页牌面统一：有牌面的条目走 cardArtHtml ===== */
  const termView = termHtml(termEntries("跃升"), true);
  assert(termView.includes("term-art"), "概念页条目使用统一牌面容器");
  assert(termView.includes("/image/113154"), "概念页技能条目渲染所属卡牌牌面");

  /* ===== 6. 卡牌详情列出特技 ===== */
  showDetail(113154);
  const cardHtml = String(document.getElementById("detail").innerHTML || "");
  assert(cardHtml.includes("特技") && cardHtml.includes("跃升"), "卡牌详情列出特技「跃升」");

  /* ===== 6.5 特技是一等分类：tagZh=特技、角色详情聚合装备牌特技 ===== */
  const sharkSkill = DATASET.records.find(r => r.kind === "skill" && r.name === "鲨鲨冲浪板");
  assert(!!sharkSkill && sharkSkill.typeZh === "特技", "装备牌特技 tagZh=特技（鲨鲨冲浪板）");
  const vehicleSkill = DATASET.records.find(r => r.kind === "skill" && r.typeRaw === "GCG_SKILL_TAG_VEHICLE");
  assert(!!vehicleSkill && vehicleSkill.typeZh === "特技", "全部载具技能码 tagZh=特技");
  /* 角色专属装备牌的关联角色：构建期两级推导（出边点名 / id 结构），源数据缺省才生效 */
  const shark = DATASET.records.find(r => r.key === "card:112142");
  assert(!!shark && shark.rel.relatedCharacterId === 1214, "咬咬鲨鱼 → 玛拉妮（出边推导）");
  assert(shark && shark.stats.element === "HYDRO", "咬咬鲨鱼元素走关联角色回退（HYDRO，与天赋牌同链路）");
  for (const id of [113154, 113155, 113156]) {
    const c = DATASET.records.find(r => r.key === "card:" + id);
    assert(!!c && c.rel.relatedCharacterId === 1315, "驰轮车卡 " + id + " → 玛薇卡（出边推导）");
  }
  /* id 结构推导：角色专属卡 id = 1 + 角色id(4位) + 序号，覆盖出边没点名的特技牌 */
  const zhuxing = DATASET.records.find(r => r.key === "card:115102");
  assert(!!zhuxing && zhuxing.rel.relatedCharacterId === 1510, "竹星 → 1510 闲云（id 结构推导）");
  assert(zhuxing && zhuxing.stats.element === "ANEMO", "竹星元素走关联角色回退（ANEMO）");
  const zhuanzhuan = DATASET.records.find(r => r.key === "card:116102");
  assert(!!zhuanzhuan && zhuanzhuan.rel.relatedCharacterId === 1610, "冲天转转 → 1610 卡齐娜（id 结构推导）");
  /* 角色详情「特技」段：凡有关联特技的角色都聚合呈现，不限个别角色 */
  const mualani = equipSkillsHtml(1214);
  assert(mualani.includes("咬咬鲨鱼") && mualani.includes("鲨鲨冲浪板"), "玛拉妮角色详情聚合特技（咬咬鲨鱼·鲨鲨冲浪板）");
  const mavuika = equipSkillsHtml(1315);
  assert(mavuika.includes("驰轮车·跃升") && mavuika.includes("驰轮车·疾驰"), "玛薇卡角色详情聚合特技（驰轮车三件套）");
  const kachina = equipSkillsHtml(1610);
  assert(kachina.includes("冲天转转") && kachina.includes("转转冲击"), "卡齐娜角色详情聚合特技（冲天转转·转转冲击）");
  /* 通用装备（推导位不是真实角色）不得被硬凑关联：浪船系保持无归属 */
  const boat = DATASET.records.find(r => r.key === "card:313007");
  assert(!!boat && boat.rel.relatedCharacterId == null, "通用装备不硬凑关联角色（浪船·迅击炮）");
  /* 拼音写进记录别名：技能名覆盖，全拼/首字母运行时派生（无独立拼音索引文件） */
  const chengming = DATASET.records.find(r => r.name === "称名之刻");
  assert(!!chengming && chengming.aliases.pinyin === "cheng ming zhi ke", "拼音写进记录别名（称名之刻 → cheng ming zhi ke）");
  const pyOf = pinyinOf("称名之刻");
  assert(!!pyOf && pyOf.full === "chengmingzhike" && pyOf.initials === "cmzk", "拼音派生：全拼 chengmingzhike · 首字母 cmzk");
  const noPy = DATASET.records.filter(r => r.name && !r.aliases.pinyin);
  assert(noPy.length === 0, "全部记录拼音齐备（缺拼音记录数 0）");
  const pyNamed = skillsNamed("称名之刻");
  assert(pyNamed.length === 1, "技能可按名字检索");

  /* ===== 7. 概念索引：构建期判定，运行时只投影 ===== */
  assert(termIndex.size === DATASET.stats.conceptNames,
    "运行时概念索引规模与数据集一致：" + termIndex.size);
  const mirrorRec = DATASET.records.find(r => r.flags.mirror && r.name.length >= 2);
  assert(!!mirrorRec, "存在牌面文本副本记录（数据前提）");
  if (mirrorRec) {
    /* 副本之所以是「副本」，就是另有同名的身份记录承载展示；
       副本自身不进索引（静态断言已校验 key 级），名字仍要能被正文链接。 */
    const hasIdentity = DATASET.records.some(o => o !== mirrorRec && o.name === mirrorRec.name && !o.flags.mirror);
    assert(hasIdentity, "牌面副本必有同名身份记录承载展示：" + mirrorRec.name);
    assert(new RegExp(termRe.source).test(mirrorRec.name), "牌面文本副本仍可被正文链接：" + mirrorRec.name);
  }
  /* 反链来自构建期出边，不再运行时扫文本 */
  const bl = backlinks.get("跃升");
  assert(!!bl && bl.size > 0, "反链：跃升 被引用（出边来自构建期）");

})();
`;

await t.run(harness);
t.finish();
