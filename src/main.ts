/* 应用入口。
 *
 * 这里显式列出所有模块，用途有两个：固定"模块顶层副作用"的先后顺序，
 * 以及在最后一个副作用位置触发应用启动（boot）。
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
import "./44-mechs";
import "./45-pool";
import "./46-recent";
import "./47-skills";
import "./50-backlinks";
import "./60-parse";
import "./70-search";
import "./80-deck";
import "./85-views";
import "./88-compare";
import "./90-detail";
import "./95-export";
import "./96-share";
import "./97-qr";
import "./98-textimport";
import "./49-cache";
import { boot } from "./99-main";

/* 启动必须是最后一个顶层副作用：入口模块体在所有依赖模块体之后求值，
   此时 dataOrigins 等模块级绑定已初始化完毕。启动若放在循环导入环内
   某个模块的顶层，打包拆序后就会踩到未初始化的绑定（P4 的 boot 即崩）。 */
boot();
