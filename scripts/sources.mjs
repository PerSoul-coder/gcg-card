/* 构建期源码清单（迁移期唯一声明处）。
 *
 * 迁移完成后，LEGACY_SOURCES 会清空，应用程序入口只剩 src/main.ts；
 * 届时本文件只保留 ASSET_SOURCES。 */

/** 应用入口（TypeScript）。 */
export const APP_ENTRY = "src/bridge.ts";

/** 尚未迁移到 TypeScript 的旧脚本，按原加载顺序拼接在入口包之后。
 *  每迁移一个模块，就从这里删一行——这是迁移进度的唯一事实来源。 */
export const LEGACY_SOURCES = [
  "src/07-dataset.js",
  "src/10-codec.js",
  "src/12-model.js",
  "src/20-data.js",
  "src/30-deps.js",
  "src/35-state.js",
  "src/40-concepts.js",
  "src/45-pool.js",
  "src/47-skills.js",
  "src/50-backlinks.js",
  "src/60-parse.js",
  "src/70-search.js",
  "src/80-deck.js",
  "src/85-views.js",
  "src/86-odds.js",
  "src/88-compare.js",
  "src/90-detail.js",
  "src/95-export.js",
  "src/99-main.js",
];

/** 应用脚本之前需要先就绪的资源脚本（拼音索引、补充概念库、官方元素图标）。 */
export const ASSET_SOURCES = [
  "gi-data/pinyin.js",
  "gi-data/concepts-extra.js",
  "gi-data/element-icons.js",
];
