/* 迁移桥（临时脚手架）。
 *
 * 作用：把已经迁到 TypeScript 的模块符号挂到 globalThis，让尚未迁移的旧脚本
 * 与测试 harness 继续以裸标识符访问（`esc(...)`、`pool`、`CHAR`）。
 *
 * 为什么需要它：旧代码是「20 个脚本共享一个全局词法作用域」，可变状态被跨文件赋值。
 * 逐个迁移时，模块内 `export let` 对外只读，未迁移的消费者无法写入。桥用
 * Object.defineProperty 提供 get/set 访问器，读写语义完全透明。
 *
 * 删除条件（硬性）：当 LEGACY_SOURCES 为空、且 tests 不再依赖裸全局时，
 * 删除本文件与 scripts/sources.mjs 里的 LEGACY_SOURCES，构建入口改为 src/main.ts。
 * 桥不是架构的一部分，只是迁移期的一次性接线。 */

import * as resources from "./core/resources";
import * as dom from "./core/dom";
import * as model from "./data/model";
import { state } from "./data/state";

const g = globalThis as unknown as Record<string, unknown>;

/** 把模块的具名导出原样暴露为全局（函数 / 常量 / 只读表）。 */
function expose(mod: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(mod)) {
    if (k === "default") continue;
    g[k] = v;
  }
}

/** 可变状态：以访问器形式暴露，旧代码的赋值语句能落到 state 对象的字段上。 */
export function defineMutable(name: string, get: () => unknown, set: (v: unknown) => void): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: false,
    get,
    set,
  });
}

expose(resources as unknown as Record<string, unknown>);
expose(dom as unknown as Record<string, unknown>);
expose(model as unknown as Record<string, unknown>);

/* 12 个可变状态字段：旧代码既有读取，也有整块赋值（20-data / 60-parse / 86-odds /
   88-compare / 90-detail / 99-main），必须走访问器，不能只暴露值。 */
const MUTABLE_KEYS = [
  "CHAR", "ENT", "KW", "shareMap", "idToShare",
  "charById", "charByName", "entById",
  "current", "currentView", "deckOrder", "overlayStack",
] as const;

for (const k of MUTABLE_KEYS) {
  defineMutable(
    k,
    () => state[k],
    (v) => { (state as unknown as Record<string, unknown>)[k] = v; },
  );
}
