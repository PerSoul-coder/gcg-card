/* src/ 应用源码 · 导出/限制/充能逻辑的 Node 端验证（DOM stub + 缓存数据） */
import { createTest } from "./_env.mjs";

const t = createTest();
const { assert } = t;

const harness = `
return (async () => {
  await decodeAndRender(SAMPLE);
  const all = state.current.order.flatMap(t => state.current.groups[t]);
  console.log("解析结果：", state.current.chars.map(c => c.name).join(" / "), "| 行动牌种类", all.length, "总张数", all.reduce((a,x)=>a+x.count,0));

  assert(state.current.chars.length === 3, "3 名角色");
  assert(all.length === 19 && all.reduce((a, x) => a + x.count, 0) === 30, "19 种 / 30 张行动牌");
  assert(all.every(x => Array.isArray(x.restrictions)), "每张卡都有 restrictions 数组");
  assert(all.every(x => Array.isArray(x.deckReqs)), "每张卡都有 deckReqs 数组（牌组限制）");
  assert(all.every(x => Number.isInteger(x.dice) && Number.isInteger(x.energy)), "费用拆分 dice/energy 完整");

  const withR = all.filter(x => x.restrictions.length);
  console.log("带打出限制的卡：", withR.map(x => x.name + " → " + x.restrictions.map(r => r.code + ":" + r.short).join("+")).join(" | "));

  const exp = buildExport();
  assert(exp.format === "gi-deck-export" && exp.actionCards.length === 19 && exp.characters.length === 3, "结构化导出：3 角色 + 19 行动牌");
  assert(exp.stats.totalCards === 30, "stats.totalCards = 30");
  console.log("stats:", JSON.stringify(exp.stats));
  assert(exp.actionCards.every(c => c.restrictions !== undefined && c.playCostRaw && c.image), "导出卡牌字段完整（限制/费用/图片）");
  assert(exp.characters.every(c => c.skills && c.maxEnergy != null && c.shareId != null), "导出角色字段完整（技能/充能/分享ID）");

  assert(deckText().includes("分享码"), "文本牌表含分享码");
  const md = deckMarkdown();
  assert(md.includes("| 数量 | 名称 | 费用 | 依赖限制") && md.includes("## 角色"), "Markdown 含依赖限制列");
  const csv = toCSV();
  assert(csv.startsWith("\\ufeff") && csv.split("\\n").length === 1 + 19, "CSV 含 BOM 且 19 数据行");
  assert(csv.includes("依赖限制"), "CSV 含依赖限制列");

})();
`;

await t.run(harness);
t.finish();
