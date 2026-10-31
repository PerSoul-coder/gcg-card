/* 测试专用导出面（仅测试构建使用，不进入浏览器产物）。
 *
 * 回归测试以「裸标识符」断言应用内部状态（pool、SKILLS、termIndex…）。
 * 与其为了测试在生产代码里制造全局，不如在这里显式列出一条导出面，
 * 由测试加载器挂到自己的作用域里。生产入口 src/main.ts 完全不知道这份文件存在。
 *
 * 新增模块时在这里补一行 export *，是测试要维护的唯一清单。 */

import "./main"; /* 先执行应用启动（等价于浏览器里的加载顺序） */

export * from "./core/dom";
export * from "./core/resources";
export * from "./core/layers";
export * from "./core/motion";
export * from "./core/history";
export * from "./data/model";
export * from "./data/state";
export * from "./data/records";
export * from "./types";
export * from "./07-dataset";
export * from "./10-codec";
export * from "./20-data";
export * from "./30-deps";
export * from "./40-concepts";
export * from "./44-mechs";
export * from "./45-pool";
export * from "./47-skills";
export * from "./50-backlinks";
export * from "./60-parse";
export * from "./70-search";
export * from "./80-deck";
export * from "./85-views";
export * from "./88-compare";
export * from "./90-detail";
export * from "./95-export";
export * from "./96-share";
export * from "./97-qr";
export * from "./98-textimport";
export * from "./49-cache";
export * from "./51-pwa";
export * from "./46-recent";
export * from "./99-main";
