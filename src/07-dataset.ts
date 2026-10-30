/* 07-dataset.ts —— 统一数据集的加载与解码。
 *
 * ========== 数据只有一份 ==========
 * 四份来源（角色 / 实体 / 关键词 / 补充概念）在原始数据里字段各异，过去靠运行时
 * 的 nameKey、descMirrors、正则匹配等启发式逐处猜测。现在由 scripts/build-dataset.mjs
 * 在构建期归一化为同一种记录（见 src/types.ts 的契约），判定一次算好，运行期只读。
 *
 * 因此**运行时不再下载原始三份 JSON**：站点提供的 gi-data/dataset.{gz,br,json} 就是
 * 全部数据。要更新牌库，重跑 `npm run build:dataset` 并重新部署——而不是让每个访客
 * 每次打开页面都自己归一化一遍。
 *
 * 加载优先级：
 *   1) 宿主注入（Node 测试的 __DATASET_JSON / 单文件版的 window.BUILTIN_DATASET）；
 *   2) 单文件版内联的压缩包（gzip 优先，浏览器原生可解）；
 *   3) 多文件版 gi-data/dataset.gz → .br → .json；
 *   4) 全失败返回 null，由调用方报错——不再有"回退到原始快照"这条第二路径。 */

import type { Dataset, GcgRecord, TermGroup } from "./types";
import { isDataset } from "./types";
import { DATASET_GZ_URL, DATASET_BR_URL, DATASET_JSON_URL } from "./core/resources";

let DATASET: Dataset | null = null;
let DATASET_READY = false;
/** 本次数据来自哪里：builtin（内联/注入）或 network（站点数据包）。 */
let DATASET_ORIGIN: "builtin" | "network" | "none" = "none";

const byKey = new Map<string, GcgRecord>();
const byKind = new Map<string, GcgRecord[]>();

function datasetFromHost(): Dataset | null {
  try {
    if (typeof __DATASET_JSON !== "undefined" && isDataset(__DATASET_JSON)) return __DATASET_JSON;
    if (typeof window !== "undefined" && isDataset(window.BUILTIN_DATASET)) return window.BUILTIN_DATASET;
  } catch {
    /* 宿主注入的数据格式不符：当作没有，走常规加载 */
  }
  return null;
}

/* 单文件版：压缩包以 base64 内联，file:// 下也能解（不需要 fetch） */
async function decodeBinaryBase64(b64: string, fmt: "gzip" | "brotli"): Promise<unknown> {
  if (typeof DecompressionStream !== "function") return null;
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    /* brotli 不在 CompressionFormat 类型定义里：浏览器尚未实现，保留为归档回退路径 */
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt as unknown as CompressionFormat));
    return JSON.parse(await new Response(stream).text());
  } catch {
    return null;
  }
}

async function readDatasetResponse(res: Response, url: string): Promise<unknown> {
  if (!res || !res.ok) throw new Error("HTTP " + (res && res.status));
  const fmt = /\.gz(\?|$)/.test(url) ? "gzip" : /\.br(\?|$)/.test(url) ? "brotli" : null;
  if (fmt) {
    if (typeof DecompressionStream !== "function" || !res.body || typeof Response !== "function")
      throw new Error("当前浏览器不支持 " + fmt + " 解压");
    const stream = res.body.pipeThrough(new DecompressionStream(fmt as unknown as CompressionFormat));
    return JSON.parse(await new Response(stream).text());
  }
  return res.json();
}

function adopt(ds: Dataset, origin: "builtin" | "network"): Dataset {
  DATASET = ds;
  DATASET_READY = true;
  DATASET_ORIGIN = origin;
  buildDatasetIndex();
  return ds;
}

/** 加载数据集。force=true 时跳过内联/注入，直接回站点取最新包（「刷新数据」用）。 */
async function loadDataset(force = false): Promise<Dataset | null> {
  if (DATASET_READY && !force) return DATASET;

  if (!force) {
    const host = datasetFromHost();
    if (isDataset(host)) return adopt(host, "builtin");
    if (typeof window !== "undefined") {
      let inline: unknown = null;
      if (window.BUILTIN_DATASET_GZ_B64) inline = await decodeBinaryBase64(window.BUILTIN_DATASET_GZ_B64, "gzip");
      if (!inline && window.BUILTIN_DATASET_B64) inline = await decodeBinaryBase64(window.BUILTIN_DATASET_B64, "brotli");
      if (isDataset(inline)) return adopt(inline, "builtin");
    }
  }

  /* 刷新时加时间戳参数，绕过 HTTP 缓存，确保真的拿到新包 */
  const bust = force ? `?t=${Date.now()}` : "";
  for (const url of [DATASET_GZ_URL, DATASET_BR_URL, DATASET_JSON_URL]) {
    try {
      const j = await readDatasetResponse(await fetch(url + bust), url);
      if (isDataset(j)) return adopt(j, "network");
    } catch {
      /* 依次降级：gz → br → json，全失败返回 null 由调用方提示 */
    }
  }
  return null;
}

function buildDatasetIndex(): void {
  byKey.clear();
  byKind.clear();
  if (!DATASET) return;
  for (const r of DATASET.records) {
    if (!r || !r.key) continue;
    byKey.set(r.key, r);
    const list = byKind.get(r.kind);
    if (list) list.push(r);
    else byKind.set(r.kind, [r]);
  }
}

const dsReady = (): boolean => DATASET_READY;
const dsByKey = (key: string): GcgRecord | null => byKey.get(key) || null;
const dsSkills = (): GcgRecord[] => byKind.get("skill") || [];
const dsStats = () => DATASET?.stats || null;
/** 概念索引：名字 → 有序条目（收录 / 去重 / 排序已在构建期完成）。 */
const dsTerms = (): TermGroup[] => DATASET?.terms || [];

export {
  DATASET, DATASET_READY, DATASET_ORIGIN, datasetFromHost, decodeBinaryBase64, readDatasetResponse,
  loadDataset, buildDatasetIndex, dsReady, dsByKey, dsSkills, dsStats, dsTerms,
};
