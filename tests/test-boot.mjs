/* 启动冒烟：boot 由 main.ts 在所有模块体求值后调用（最后一个顶层副作用）。
 *
 * P4 曾因循环导入拆序（20-data ⇄ 99-main）导致 99-main 顶层启动先于
 * 20-data 的模块级绑定初始化执行，boot 即崩（dataOrigins undefined），
 * 且被 routeHash 自己的 catch 吞成一条状态栏文案——运行时 harness 都
 * 直接调 ensureData，永远测不到这条真实路径，14/14 全绿而应用是死的。
 * 这里在源码求值后等启动落地，断言：默认视图就位、数据就绪、无失败状态。 */
import { createTest } from "./_env.mjs";

const t = createTest();
const { assert } = t;

const harness = `
return (async () => {
  /* boot 在源码求值（main.ts 末尾）时已开始；给它的异步链几个宏任务落地 */
  await new Promise(r => setTimeout(r, 50));
  assert(document.body.dataset.view === "browse",
    "boot 完成：默认进入卡库视图（实际 " + document.body.dataset.view + "）");
  const status = (document.getElementById("status") || {}).textContent || "";
  assert(status.indexOf("加载失败") < 0 && status.indexOf("初始化失败") < 0,
    "boot 完成：无失败状态（" + status.slice(0, 80) + "）");
  assert(dataReady === true, "boot 完成：数据已就绪");
})();
`;

await t.run(harness);
t.finish();
