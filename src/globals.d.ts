/* 全局声明的集中处。
 *
 * 只登记"运行时确实存在、但不是模块导出"的东西：单文件版注入的内嵌数据、
 * 以及 Node 测试注入的数据集。业务模块不要在这里加临时变量——那就退回全局作用域了。 */

/** Node 测试注入的统一数据集（见 tests/test-lib.mjs）。 */
declare var __DATASET_JSON: unknown;

interface Window {
  /** 单文件版内嵌的原始数据快照（characters / entities / keywords）。 */
  BUILTIN_DATA?: Record<string, unknown>;
  /** 单文件版内嵌的统一数据集（未压缩 JSON）。 */
  BUILTIN_DATASET?: unknown;
  /** 单文件版内嵌的统一数据集（gzip base64，浏览器原生可解）。 */
  BUILTIN_DATASET_GZ_B64?: string;
  /** 单文件版内嵌的统一数据集（brotli base64，归档格式）。 */
  BUILTIN_DATASET_B64?: string;
}
