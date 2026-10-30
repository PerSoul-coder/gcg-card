/* src/ 应用源码 · 导出/限制/充能逻辑的 Node 端验证（DOM stub + 缓存数据） */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppSource } from "./test-lib.mjs";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHAR = JSON.parse(fs.readFileSync(path.join(here, "gi-data/characters.json"), "utf8")).data;
const ENT = JSON.parse(fs.readFileSync(path.join(here, "gi-data/entities.json"), "utf8")).data;

let fails = 0;
const assert = (cond, msg) => { if (cond) console.log("  ok:", msg); else { console.error("  FAIL:", msg); fails++; } };

function makeEl(reg, id) {
  const store = id ? { _id: id } : {};
  return new Proxy(store, {
    get(t, k) {
      if (k === "classList") return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === "style") return {};
      if (k === "dataset") return {};
      if (k in t) return t[k];
      if (k === "addEventListener" || k === "removeEventListener") return () => {};
      if (k === "appendChild" || k === "remove" || k === "click" || k === "focus" || k === "setAttribute") return () => {};
      if (k === "closest" || k === "querySelector") return () => null;
      if (k === "querySelectorAll") return () => [];
      if (k === "value") return "";
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const elCache = new Map();
const documentStub = {
  getElementById: id => { if (!elCache.has(id)) elCache.set(id, makeEl(true, id)); return elCache.get(id); },
  createElement: () => makeEl(false),
  addEventListener: () => {},
  querySelector: () => makeEl(false),
  querySelectorAll: () => [],
  body: { appendChild: () => {} },
};
const windowStub = {};
const localStorageStub = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const fetchStub = async url => {
  const cat = url.endsWith("/characters") ? CHAR : ENT;
  return { ok: true, json: async () => ({ data: cat }) };
};

const logic = readAppSource();
const harness = `
;(async () => {
  await decodeAndRender(SAMPLE);
  const all = current.order.flatMap(t => current.groups[t]);
  console.log("解析结果：", current.chars.map(c => c.name).join(" / "), "| 行动牌种类", all.length, "总张数", all.reduce((a,x)=>a+x.count,0));

  assert(current.chars.length === 3, "3 名角色");
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

  console.log(getFails() ? "\\n存在失败项" : "\\n全部通过");
  process.exit(getFails() ? 1 : 0);
})().catch(e => { console.error("执行异常:", e); process.exit(1); });
`;

await new Function(
  "document", "window", "localStorage", "location", "history", "fetch", "navigator", "assert", "getFails",
  logic + harness,
)(
  documentStub, windowStub, localStorageStub,
  { hash: "" }, { replaceState() {} },
  fetchStub, { clipboard: {} }, assert, () => fails,
);
