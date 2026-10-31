/* 20-data.ts —— 数据加载与派生索引装配。
 *
 * 打开页面只做一件事：把构建期产出的数据集读进来，然后一次性编译成运行时索引
 * （记录表 → 技能索引 → 概念索引 → 卡池 → 反链）。所有判定已在构建期完成，
 * 这里不再有"原始快照 + 启发式兜底"的第二条路径。
 *
 * 单 flight：并发调用（解析 / 切视图 / 深链同时触发）只发一次请求，失败不缓存、
 * 下次调用可重试；「刷新数据」通过 resetDataState 强制重新拉取。 */

import { loadDataset, DATASET_ORIGIN } from "./07-dataset";
import { buildRecordIndex } from "./data/records";
import { buildSkillIndex } from "./47-skills";
import { buildTermIndex } from "./40-concepts";
import { buildPool } from "./45-pool";
import { buildBacklinks } from "./50-backlinks";
import { setStatus } from "./core/dom";

/* 数据就绪后的界面刷新回调（牌组摘要 / 数据信息行）。
   数据层不反向 import 视图层与牌组层——那会成环，而循环导入下 esbuild
   的模块拆序不受控：视图层可能先于本模块求值，顶层启动就会踩到
   未初始化的绑定（P4 曾因此 boot 即崩：dataOrigins 尚未赋值）。
   由视图层在这里注册，loadData 完成后统一触发。 */
const readyHooks: Array<() => void> = [];
export function onDataReady(fn: () => void): void {
  readyHooks.push(fn);
}

/** 本次加载实际用到的来源，供数据信息行展示。 */
export const dataOrigins = new Set<string>();
export const ORIGIN_ZH: Record<string, string> = {
  builtin: "内置快照 · 离线可用",
  network: "站点数据包",
};

export let dataReady = false;
let dataFlight: Promise<void> | null = null;

/** 重置加载状态（供「刷新数据」使用）。 */
export function resetDataState(): void {
  dataReady = false;
  dataFlight = null;
}

export function ensureData(forceNetwork = false): Promise<void> {
  if (dataReady && !forceNetwork) return Promise.resolve();
  if (!dataFlight) {
    dataFlight = loadData(forceNetwork).finally(() => { dataFlight = null; });
  }
  return dataFlight;
}

async function loadData(forceNetwork = false): Promise<void> {
  dataOrigins.clear();
  if (forceNetwork) setStatus(`<span class="spin"></span>正在从站点重新获取数据包…`);
  else setStatus(`<span class="spin"></span>正在载入卡牌数据…`);

  const ds = await loadDataset(forceNetwork);
  if (!ds) throw new Error("数据包加载失败，请检查网络后重试");
  dataOrigins.add(DATASET_ORIGIN);

  buildRecordIndex();    /* id / 分享码 / 角色卡牌分组：所有查表的唯一入口 */
  buildSkillIndex();     /* 技能索引：角色技能与装备牌特技同源 */
  buildTermIndex();      /* 概念索引：只读 dataset.terms */
  buildPool();           /* 卡池：记录投影 */
  buildBacklinks();      /* 反链：只读出边（refs） */
  for (const fn of readyHooks) fn();
  dataReady = true;
  /* 载入完成即清状态行：此前「正在载入卡牌数据…」永不清理，spinner 一直转，
     看起来像没加载完。来源与规模由 dataInfo 行常驻展示；失败路径由调用方写错误。 */
  setStatus("");
}
