/* 一次性迁移工具（已归档）：把 deck-viewer.js 按章节边界切成 src/ 下的有序模块。
   迁移已完成，保留仅供追溯切分规则；重跑会覆盖 src/ 下的模块，请勿在正常流程中执行。
   切分只按行范围，不重排代码——模块间的加载顺序与原始文件完全一致。 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ARCHIVE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(ARCHIVE, "..");
const lines = readFileSync(resolve(ARCHIVE, "deck-viewer.js"), "utf8").split(/\r?\n/);

const PLAN = [
  ["00-resources.js", "资源管理：数据源、图片地址、元素元数据与图标、本地存储键。所有外部资源只在这里声明。", [[157, 203]]],
  ["05-core.js", "核心工具与全局状态：DOM 查询、转义、提示条、弹层滚动锁、应用级状态。", [[1, 11]]],
  ["10-codec.js", "分享码编解码（移植自 sharing.ts，AGPL-3.0）。", [[12, 51]]],
  ["20-data.js", "数据加载：内置快照 → 本地缓存 → 现网，超时重试与单 flight。", [[53, 156]]],
  ["30-deps.js", "依赖模型：牌组限制 / 打出限制、费用拆分。", [[204, 355]]],
  ["35-state.js", "应用级可变状态（数据集合、当前牌组、视图栈）。", [[356, 365]]],
  ["40-concepts.js", "概念索引：补充库合并、术语匹配与链接化。", [[366, 490]]],
  ["45-pool.js", "全量卡池与版本索引（卡库/检索的数据基础）。", [[491, 544]]],
  ["50-backlinks.js", "反链索引与术语正文渲染。", [[545, 594]]],
  ["60-parse.js", "分享码 → 牌组解析流程与输入路由。", [[617, 710]]],
  ["70-search.js", "卡牌检索、最近搜索、输入建议（combobox）。", [[711, 1197]]],
  ["80-deck.js", "多牌组存储、草稿门面与牌组管理面板。", [[1198, 1348], [1804, 1901]]],
  ["85-views.js", "概览条与四个视图（卡面/列表/检索/卡库）渲染。", [[1349, 1803]]],
  ["90-detail.js", "详情弹层、弹层导航、帮助面板与概念交互。", [[1902, 2244]]],
  ["95-export.js", "导出：文本 / Markdown / 结构化 JSON / CSV。", [[2245, 2416]]],
  ["99-main.js", "事件绑定、视图切换、数据信息/刷新与启动路由。", [[2417, 2678]]],
];

mkdirSync(resolve(ROOT, "src"), { recursive: true });
for (const [file, desc, ranges] of PLAN) {
  const body = ranges.flatMap(([a, b]) => lines.slice(a - 1, b))
    .filter(l => l.trim() !== '"use strict";')
    .join("\n");
  const head = `/* 七圣召唤浏览器 · ${desc}\n   源码按领域拆分，由 src/sources.mjs 统一声明加载顺序；单文件版构建时按同一顺序内联。 */\n"use strict";\n\n`;
  writeFileSync(resolve(ROOT, "src", file), head + body + "\n");
  console.log("写出", file, `${body.split("\n").length} 行`);
}
