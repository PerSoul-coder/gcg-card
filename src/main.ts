/* 应用入口。
 *
 * 这里显式列出所有模块，用途只有一个：固定"模块顶层副作用"的先后顺序。
 * 模块之间的数据依赖由各自的 import 决定，不依赖这份清单——
 * 换句话说，漏写某个模块不会导致它不被打包（它会被依赖图拉进来），
 * 只可能影响顶层副作用的相对次序。
 *
 * 顺序沿用重构前的加载顺序，保证事件监听注册、索引构建等行为的相对次序不变。 */

import "./07-dataset";
import "./10-codec";
import "./20-data";
import "./30-deps";
import "./40-concepts";
import "./45-pool";
import "./47-skills";
import "./50-backlinks";
import "./60-parse";
import "./70-search";
import "./80-deck";
import "./85-views";
import "./86-odds";
import "./88-compare";
import "./90-detail";
import "./95-export";
import "./99-main";
