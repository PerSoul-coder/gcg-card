/* src/07-dataset.js —— 由 scripts/_convert.mjs 从旧脚本转换（迁移中间态）。 */
import { state } from "./data/state";
import { DATASET_GZ_URL, DATASET_BR_URL, DATASET_JSON_URL } from "./core/resources";
import { nameKey } from "./data/model";
let DATASET = null;
let DATASET_READY = false;
const dsIndex = {
  byKey: new Map(),
  byKind: new Map(),
  byDomain: new Map(),
  byNorm: new Map(),
};

function datasetFromHost() {
  try {
    if (typeof __DATASET_JSON !== "undefined" && __DATASET_JSON) return __DATASET_JSON;
    if (typeof window !== "undefined" && window.BUILTIN_DATASET) return window.BUILTIN_DATASET;
  } catch (e) {}
  return null;
}

/* 单文件版：压缩包以 base64 内联，file:// 下也能解（不需要 fetch） */
async function decodeBinaryBase64(b64, fmt) {
  if (typeof DecompressionStream !== "function") return null;
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt));
    return JSON.parse(await new Response(stream).text());
  } catch (e) {
    return null;
  }
}

async function readDatasetResponse(res, url) {
  if (!res || !res.ok) throw new Error("HTTP " + (res && res.status));
  const fmt = /\.gz(\?|$)/.test(url) ? "gzip" : /\.br(\?|$)/.test(url) ? "brotli" : null;
  if (fmt) {
    if (typeof DecompressionStream !== "function" || !res.body || typeof Response !== "function")
      throw new Error("当前浏览器不支持 " + fmt + " 解压");
    /* brotli 不在 CompressionFormat 类型定义里：浏览器尚未实现，保留为归档回退路径；
       不支持时由上层 catch 吞掉并降级到 json。 */
    const stream = res.body.pipeThrough(new DecompressionStream(fmt as unknown as CompressionFormat));
    return JSON.parse(await new Response(stream).text());
  }
  return res.json();
}

async function loadDataset() {
  if (DATASET_READY) return DATASET;
  let host = datasetFromHost();
  if (!host && typeof window !== "undefined") {
    if (window.BUILTIN_DATASET_GZ_B64) host = await decodeBinaryBase64(window.BUILTIN_DATASET_GZ_B64, "gzip");
    if (!host && window.BUILTIN_DATASET_B64) host = await decodeBinaryBase64(window.BUILTIN_DATASET_B64, "brotli");
  }
  if (host && Array.isArray(host.records) && host.records.length) {
    DATASET = host;
    DATASET_READY = true;
    buildDatasetIndex();
    return DATASET;
  }
  for (const url of [DATASET_GZ_URL, DATASET_BR_URL, DATASET_JSON_URL]) {
    try {
      const res = await fetch(url);
      const j = await readDatasetResponse(res, url);
      if (j && Array.isArray(j.records) && j.records.length) {
        DATASET = j;
        DATASET_READY = true;
        buildDatasetIndex();
        return DATASET;
      }
    } catch (e) {}
  }
  return null;
}

function buildDatasetIndex() {
  dsIndex.byKey.clear();
  dsIndex.byKind.clear();
  dsIndex.byDomain.clear();
  dsIndex.byNorm.clear();
  if (!DATASET || !DATASET.records) return;
  for (const r of DATASET.records) {
    if (!r || !r.key) continue;
    dsIndex.byKey.set(r.key, r);
    const bk = dsIndex.byKind.get(r.kind);
    if (bk) bk.push(r); else dsIndex.byKind.set(r.kind, [r]);
    const bd = dsIndex.byDomain.get(r.domain);
    if (bd) bd.push(r); else dsIndex.byDomain.set(r.domain, [r]);
    const nk = (r.aliases && r.aliases.norm) || r.name;
    if (nk) {
      const bn = dsIndex.byNorm.get(nk);
      if (bn) bn.push(r); else dsIndex.byNorm.set(nk, [r]);
    }
  }
}

const dsReady = () => DATASET_READY;
const dsByKey = key => dsIndex.byKey.get(key) || null;
const dsRecords = kind => dsIndex.byKind.get(kind) || [];
const dsSkills = () => dsIndex.byKind.get("skill") || [];
const dsByName = name => dsIndex.byNorm.get(nameKey(name)) || [];
const dsStats = () => (DATASET && DATASET.stats) || null;
/* 数字 id（卡牌/角色）→ 统一 key；技能用自身 key */
const dsKeyOfId = id => (state.charById && state.charById.has(id) ? "char:" : "card:") + id;

export { DATASET, DATASET_READY, dsIndex, datasetFromHost, decodeBinaryBase64, readDatasetResponse, loadDataset, buildDatasetIndex, dsReady, dsByKey, dsRecords, dsSkills, dsByName, dsStats, dsKeyOfId };
