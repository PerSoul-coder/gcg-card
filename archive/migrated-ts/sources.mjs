/* 源码加载顺序的唯一声明。
   HTML 的 <script> 顺序、单文件构建的内联顺序、Node 测试的拼接顺序都以此为准，
   避免三处各写一份、改一处漏两处。 */
export const APP_SOURCES = [
  "src/00-resources.js",
  "src/05-core.js",
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

/* 应用脚本之前需要先就绪的资源脚本（拼音索引、补充概念库、官方元素图标） */
export const ASSET_SOURCES = [
  "gi-data/pinyin.js",
  "gi-data/concepts-extra.js",
  "gi-data/element-icons.js",
];
