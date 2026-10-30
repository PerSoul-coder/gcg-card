/* 全局声明的集中处。
 *
 * 只登记"运行时确实存在、但不是模块导出"的东西：单文件版注入的内嵌数据、
 * 以及 Node 测试注入的数据集。业务模块不要在这里加临时变量——那就退回全局作用域了。 */

/** Node 测试注入的统一数据集（见 tests/test-lib.mjs）。 */
declare var __DATASET_JSON: unknown;

interface Window {
  /** 启动流程是否已完整跑过一次：错误兜底据此区分「初始化就挂了」与「运行期偶发错误」。 */
  __giBooted?: boolean;
  /** 单文件版内嵌的统一数据集（未压缩 JSON）。 */
  BUILTIN_DATASET?: unknown;
  /** 单文件版内嵌的统一数据集（gzip base64，浏览器原生可解）。 */
  BUILTIN_DATASET_GZ_B64?: string;
  /** 单文件版内嵌的统一数据集（brotli base64，归档格式）。 */
  BUILTIN_DATASET_B64?: string;
}

/* lib.dom 只把 dataset 声明在 HTMLElement / SVGElement 上，但 closest() 返回的是
   Element——实践中 HTML 与 SVG 元素都有 dataset。这里补上，避免每处调用都做断言。 */
interface Element {
  readonly dataset: DOMStringMap;
}
