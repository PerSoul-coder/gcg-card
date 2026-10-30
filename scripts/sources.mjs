/* 构建期源码清单。
 *
 * 应用入口是一个真正的 ESM 图，模块之间的依赖写在各自的 import 里——
 * 这里不再维护"加载顺序"，也不需要把旧脚本拼接进来。 */

/** 应用入口（TypeScript，ESM 依赖图）。 */
export const APP_ENTRY = "src/main.ts";
