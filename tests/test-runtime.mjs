/* src/ 应用源码 · 运行时健壮性验证：缓存 TTL / 结构校验 / 超时 / 重试 / 单 flight */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppSource } from "./test-lib.mjs";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = {};
for (const cat of ["characters", "entities", "keywords"])
  DATA[cat] = JSON.parse(fs.readFileSync(path.join(here, `gi-data/${cat}.json`), "utf8")).data;
const conceptsExtra = JSON.parse(
  fs.readFileSync(path.join(here, "gi-data/concepts-extra.js"), "utf8")
    .replace(/^export const CONCEPTS_EXTRA = /, "").replace(/;\s*$/, ""));

let fails = 0;
const assert = (cond, msg) => { if (cond) console.log("  ok:", msg); else { console.error("  FAIL:", msg); fails++; } };

/* 可控 localStorage */
const store = new Map();
const localStorageStub = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
/* 可控 fetch：记录调用、可编程返回/抛错/挂起 */
const fetchCtl = { log: [], impl: async () => { throw new Error("unset"); }, reset() { this.log.length = 0; } };
const fetchStub = async (url, opts) => { fetchCtl.log.push(url); return fetchCtl.impl(url, opts); };

function makeEl(reg, id) {
  const s = id ? { _id: id } : {};
  return new Proxy(s, {
    get(t, k) {
      if (k === "classList") return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === "style" || k === "dataset") return {};
      if (k in t) return t[k];
      if (k === "addEventListener" || k === "removeEventListener") return () => {};
      if (k === "appendChild" || k === "remove" || k === "click" || k === "focus" || k === "setAttribute" || k === "scrollIntoView" || k === "insertAdjacentHTML") return () => {};
      if (k === "closest" || k === "querySelector") return () => null;
      if (k === "querySelectorAll") return () => [];
      if (k === "value") return "";
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const elCache = new Map();
const documentStub = {
  getElementById: id => { if (!elCache.has(id)) elCache.set(id, makeEl(true, id)); return elCache.get(id); },
  createElement: () => makeEl(false),
  addEventListener: () => {},
  querySelector: () => makeEl(false),
  querySelectorAll: () => [],
  body: { appendChild: () => {}, dataset: {} },
};

const logic = readAppSource();

const harness = `
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  /* 等启动时的首次加载（必然失败：初始 impl 抛错）settle，再开始计数 */
  await sleep(80); fetchCtl.reset();

  /* ===== 1. 缓存：roundtrip / TTL / 旧版接纳 / 结构校验 ===== */
  writeCache("entities", DATA.entities, 1000);
  const hit = readCache("entities", 1000);
  assert(hit && hit.data.length === DATA.entities.length, "缓存 roundtrip（写后读得回）");
  assert(readCache("entities", 1000) !== null, "同时刻读取有效");
  assert(readCache("entities", 1000 + 24 * 3600 * 1000 - 1000) !== null, "TTL 边界内仍有效");
  assert(readCache("entities", 1000 + 24 * 3600 * 1000 + 1) === null, "超过 24h TTL → 过期重拉");
  store.set("gi-viewer-CHS-latest-entities", JSON.stringify(DATA.entities));
  const legacy = readCache("entities", 5000);
  assert(legacy && legacy.data.length === DATA.entities.length, "旧版裸数组缓存平滑接纳（不强制老用户重拉）");
  store.set("gi-viewer-CHS-latest-entities", JSON.stringify({ v: 1, at: 1, data: [] }));
  assert(readCache("entities", 2) === null, "空 data → 视为无效");
  store.set("gi-viewer-CHS-latest-entities", "{ 坏 JSON");
  assert(readCache("entities", 2) === null, "坏 JSON → 视为无效（不抛错）");
  store.set("gi-viewer-CHS-latest-entities", JSON.stringify({ v: 99, at: 1, data: DATA.entities }));
  assert(readCache("entities", 2) === null, "未知版本号 → 视为无效");

  /* ===== 2. fetchJson 超时 ===== */
  /* 桩遵循 abort 信号（真实浏览器 fetch 也是如此）：挂起请求在超时后被 reject */
  fetchCtl.impl = (url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener("abort", () => reject(new Error("aborted by timeout")));
  });
  let timeoutErr = null;
  await fetchJson("http://x/test", 30).catch(e => { timeoutErr = e; });
  assert(timeoutErr !== null, "fetchJson 超时即 reject（网络挂起不会永久转圈）");

  /* ===== 3. fetchCategory：失败重试一次即成功 ===== */
  let calls = 0;
  fetchCtl.impl = async () => {
    calls++;
    if (calls === 1) throw new Error("网络抖动");
    return { ok: true, json: async () => ({ data: DATA.keywords }) };
  };
  store.delete("gi-viewer-CHS-latest-keywords");
  const kw = await fetchCategory("keywords");
  assert(kw.length === DATA.keywords.length && calls === 2, "fetchCategory 抖动后重试一次成功（2 次尝试）");
  assert(store.has("gi-viewer-CHS-latest-keywords"), "成功后写缓存");

  /* ===== 4. 持续失败：抛错、不写缓存 ===== */
  calls = 0;
  fetchCtl.impl = async () => { calls++; throw new Error("持续离线"); };
  store.delete("gi-viewer-CHS-latest-keywords");
  let catErr = null;
  await fetchCategory("keywords").catch(e => { catErr = e; });
  assert(catErr && calls === 2, "持续失败：重试一次后抛出（共 2 次尝试）");
  assert(!store.has("gi-viewer-CHS-latest-keywords"), "失败不写缓存");
  assert(/keywords/.test(String(catErr && catErr.message)), "错误信息带类别名");

  /* ===== 5. 单 flight：并发调用只发一次请求 ===== */
  fetchCtl.reset();
  fetchCtl.impl = async url => {
    const cat = ["characters", "entities", "keywords"].find(c => url.endsWith("/" + c));
    return { ok: true, json: async () => ({ data: DATA[cat] }) };
  };
  for (const c of ["characters", "entities", "keywords"]) store.delete("gi-viewer-CHS-latest-" + c);
  resetDataState();
  await Promise.all([ensureData(), ensureData(), ensureData()]);
  assert(fetchCtl.log.length === 3, "单 flight：3 个并发 ensureData 只发起 3 次请求（实际 " + fetchCtl.log.length + "）");
  assert(dataReady === true, "加载成功后 dataReady 置位");

  /* ===== 6. 已就绪：直接返回，零请求 ===== */
  fetchCtl.reset();
  await ensureData();
  assert(fetchCtl.log.length === 0, "已就绪：ensureData 不再发请求");

  /* ===== 7. 失败的 flight 不驻留，下次可重试 ===== */
  fetchCtl.reset();
  fetchCtl.impl = async () => { throw new Error("又断了"); };
  /* 清掉缓存，否则 fetchCategory 命中缓存直接返回、根本不会发请求 */
  for (const c of ["characters", "entities", "keywords"]) store.delete("gi-viewer-CHS-latest-" + c);
  resetDataState();
  let e1 = null, e2 = null;
  await ensureData().catch(e => { e1 = e; });
  await ensureData().catch(e => { e2 = e; });
  assert(e1 && e2, "失败可重试：两次调用都按预期 reject");
  assert(dataFlight === null, "失败后 flight 已释放（不驻留坏 promise）");
  assert(fetchCtl.log.length === 12, "两次失败调用各 3 类 × 2 次尝试 = 12 次请求（实际 " + fetchCtl.log.length + "）");

  /* ===== 8. 恢复数据，避免影响后续可能的断言 ===== */
  fetchCtl.reset();
  fetchCtl.impl = async url => {
    const cat = ["characters", "entities", "keywords"].find(c => url.endsWith("/" + c));
    return { ok: true, json: async () => ({ data: DATA[cat] }) };
  };
  for (const c of ["characters", "entities", "keywords"]) store.delete("gi-viewer-CHS-latest-" + c);
  resetDataState();
  await ensureData();
  assert(dataReady === true, "恢复：重新加载成功");

  console.log(getFails() ? "\\\\n存在失败项" : "\\\\n全部通过");
  process.exit(getFails() ? 1 : 0);
})().catch(e => { console.error("执行异常:", e); process.exit(1); });
`;

await new Function(
  "document", "window", "localStorage", "location", "history", "fetch", "navigator", "assert", "getFails", "CONCEPTS_EXTRA", "DATA", "store", "fetchCtl",
  logic + harness,
)(
  documentStub, {}, localStorageStub,
  { hash: "" }, { replaceState() {} },
  fetchStub, { clipboard: {} }, assert, () => fails, conceptsExtra, DATA, store, fetchCtl,
);
