/* src/ 技能图鉴（牌组工具 → 技能图鉴）· 卡面灯箱
   覆盖：全量/类型过滤/名字与拼音与所属检索、图鉴打开与行进技能页、灯箱开关。 */
import { createTest } from "./_env.mjs";

const t = createTest();
const { assert } = t;

const harness = `
return (async () => {
  const idOf = r => Number(r.key.slice(r.key.indexOf(":") + 1));
  await ensureData();

  /* ===== 1. 数据层：全量 / 类型过滤 / 检索 ===== */
  skillIdxState.tag = ""; skillIdxState.q = "";
  assert(SKILLS.length > 500, "技能总量（角色技能 + 特技）：" + SKILLS.length);
  assert(skillIdxMatches().length === SKILLS.length, "无过滤时全量");
  skillIdxState.tag = "GCG_SKILL_TAG_VEHICLE";
  assert(skillIdxMatches().length > 0 && skillIdxMatches().every(s => s.ownerKind === "card"), "特技过滤：全部来自装备牌");
  skillIdxState.tag = "hidden";
  assert(skillIdxMatches().length > 0 && skillIdxMatches().every(s => s.hidden), "隐藏过滤：全是隐藏技能");
  skillIdxState.tag = "";
  skillIdxState.q = "称名之刻";
  assert(skillIdxMatches().some(s => s.name === "称名之刻"), "名字检索命中（称名之刻）");
  skillIdxState.q = "chengmingzhike";
  assert(skillIdxMatches().some(s => s.name === "称名之刻"), "拼音全拼检索命中");
  skillIdxState.q = "cmzk";
  assert(skillIdxMatches().some(s => s.name === "称名之刻"), "拼音首字母检索命中");
  skillIdxState.q = "芙宁娜";
  assert(skillIdxMatches().length > 0 && skillIdxMatches().every(s => s.ownerName.includes("芙宁娜")), "所属角色检索");
  skillIdxState.q = "";

  /* ===== 2. 图鉴视图 ===== */
  showSkillIdx();
  assert(topView() && topView().kind === "skillidx", "整栈替换：skillidx 在栈顶");
  const html = String($("detail").innerHTML || "");
  assert(html.includes("技能图鉴") && html.includes("data-skidxtag"), "视图渲染：标题 + 类型 chips");
  /* stub 无 DOM 树：分块挂载写进 #skillIdxList（独立元素），行内容单独断言 */
  const listHtml = String($("skillIdxList").innerHTML || "");
  assert(listHtml.includes("data-skill") && listHtml.includes("skidx-art"), "分组挂载：技能行 + 所属牌面组头");
  showSkill(skillIdxMatches()[0].key);
  assert(topView().kind === "skill", "图鉴行 → 技能页压栈");
  overlayClose();
  assert(!overlayOpen(), "关闭图鉴");

  /* ===== 3. 卡面灯箱 ===== */
  const rec = cardRecords().find(r => r.kind === "card" && r.share != null);
  showDetail(idOf(rec));
  assert(String($("detail").innerHTML || "").includes('data-lb="' + idOf(rec) + '"'), "详情卡面带灯箱入口");
  showLightbox(idOf(rec));
  const box = $("lightbox");
  assert(!!box.classList.contains("show"), "灯箱打开");
  assert(String(box.innerHTML).includes("<img"), "灯箱含大图");
  lightboxStep(1);   /* 同级只有 1 张时保持不动（幂等） */
  closeLightbox();
  assert(!box.classList.contains("show"), "灯箱关闭");
  overlayClose();
  assert(!overlayOpen(), "关闭详情");
})();

`;

await t.run(harness);
t.finish();
