/* 统一数据集的加载、解码与索引。
 *
 * ========== 为什么要有这一层 ==========
 * 四份来源（角色 / 实体 / 关键词 / 补充概念）在原始数据里字段各异，过去靠运行时
 * 的 nameKey、descMirrors、正则匹配等启发式逐处猜测。现在由 scripts/build-dataset.mjs
 * 在构建期归一化为同一种 Record（见 src/types.ts 的契约），判定一次算好。
 * 运行时只读——不再在每个界面重复判断。
 *
 * 加载优先级：
 *   1) Node 测试注入的 __DATASET_JSON（避免 file:// 与 fetch 差异）；
 *   2) 单文件版内联的压缩包（gzip 优先，浏览器原生可解）；
 *   3) 多文件版 gi-data/dataset.gz → .br → .json；
 *   4) 任一步失败返回 null，调用方回退到原始快照索引，页面不会因数据包问题白屏。 */

import type { Dataset, GcgRecord } from "./types";
import { isDataset } from "./types";
import { state } from "./data/state";
import { DATASET_GZ_URL, DATASET_BR_URL, DATASET_JSON_URL } from "./core/resources";
import { nameKey } from "./data/model";

let DATASET: Dataset | null = null;
let DATASET_READY = false;

const dsIndex = {
  byKey: new Map<string, GcgRecord>(),
  byKind: new Map<string, GcgRecord[]>(),
  byDomain: new Map<string, GcgRecord[]>(),
  byNorm: new Map<string, GcgRecord[]>(),
};

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

async function loadDataset(): Promise<Dataset | null> {
  if (DATASET_READY) return DATASET;

  let host: unknown = datasetFromHost();
  if (!host && typeof window !== "undefined") {
    if (window.BUILTIN_DATASET_GZ_B64) host = await decodeBinaryBase64(window.BUILTIN_DATASET_GZ_B64, "gzip");
    if (!host && window.BUILTIN_DATASET_B64) host = await decodeBinaryBase64(window.BUILTIN_DATASET_B64, "brotli");
  }
  if (isDataset(host)) {
    DATASET = host;
    DATASET_READY = true;
    buildDatasetIndex();
    return DATASET;
  }

  for (const url of [DATASET_GZ_URL, DATASET_BR_URL, DATASET_JSON_URL]) {
    try {
      const j = await readDatasetResponse(await fetch(url), url);
      if (isDataset(j)) {
        DATASET = j;
        DATASET_READY = true;
        buildDatasetIndex();
        return DATASET;
      }
    } catch {
      /* 依次降级：gz → br → json，全失败返回 null 由调用方兜底 */
    }
  }
  return null;
}

function buildDatasetIndex(): void {
  dsIndex.byKey.clear();
  dsIndex.byKind.clear();
  dsIndex.byDomain.clear();
  dsIndex.byNorm.clear();
  if (!DATASET) return;
  for (const r of DATASET.records) {
    if (!r || !r.key) continue;
    dsIndex.byKey.set(r.key, r);
    pushTo(dsIndex.byKind, r.kind, r);
    pushTo(dsIndex.byDomain, r.domain, r);
    const nk = r.aliases?.norm || r.name;
    if (nk) pushTo(dsIndex.byNorm, nk, r);
  }
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

const dsReady = (): boolean => DATASET_READY;
const dsByKey = (key: string): GcgRecord | null => dsIndex.byKey.get(key) || null;
const dsRecords = (kind: string): GcgRecord[] => dsIndex.byKind.get(kind) || [];
const dsSkills = (): GcgRecord[] => dsIndex.byKind.get("skill") || [];
const dsByName = (name: string): GcgRecord[] => dsIndex.byNorm.get(nameKey(name)) || [];
const dsStats = () => DATASET?.stats || null;

/* 数字 id（卡牌/角色）→ 统一 key；技能用自身 key */
const dsKeyOfId = (id: number): string =>
  (state.charById.has(id) ? "char:" : "card:") + id;

export {
  DATASET, DATASET_READY, dsIndex, datasetFromHost, decodeBinaryBase64, readDatasetResponse,
  loadDataset, buildDatasetIndex, dsReady, dsByKey, dsRecords, dsSkills, dsByName, dsStats, dsKeyOfId,
};
