/* 运行时健壮性：数据包加载（三级回退 / 单 flight / 失败可重试 / 强制刷新）。
 *
 * 数据只有一份来源——构建期产出的 gi-data/dataset.{gz,br,json}。
 * 以前这里测的是「三份原始 JSON 的 localStorage 缓存与超时重试」，
 * 那层已经不存在了：缓存与重试的对象变成数据包本身，因此断言也随之改测
 * 真正还在的行为：回退顺序、并发合并、失败释放、刷新绕过 HTTP 缓存。 */
import zlib from "node:zlib";
import { createTest, readSources } from "./_env.mjs";

const DATA = readSources();

/* 可控 fetch：记录调用、可编程返回 / 抛错 */
const fetchCtl = { log: [], impl: async () => { throw new Error("unset"); }, reset() { this.log.length = 0; } };
const fetchStub = async (url, opts) => { fetchCtl.log.push(String(url)); return fetchCtl.impl(String(url), opts); };

const t = createTest({ data: DATA, fetch: fetchStub });
const { assert } = t;

/* 宿主注入（__DATASET_JSON）优先于网络：这一组要测的就是网络路径，先把它摘掉 */
const PAYLOAD = globalThis.__DATASET_JSON;
delete globalThis.__DATASET_JSON;

/** 模拟 gz 响应（body 走 DecompressionStream）与 json 响应 */
const GZ = (obj) => new Response(zlib.gzipSync(Buffer.from(JSON.stringify(obj), "utf8")));
const JSONRES = (obj) => ({ ok: true, json: async () => obj });

const harness = `
return (async () => {
  /* ===== 1. 首次加载：网络取包 → 派生索引就绪 ===== */
  fetchCtl.reset();
  fetchCtl.impl = async url => url.includes("dataset.gz") ? GZ(PAYLOAD) : JSONRES(PAYLOAD);
  await ensureData();
  const ds = dsStats();
  assert(!!ds && ds.total > 2000, "数据包加载：记录总数 " + (ds ? ds.total : 0));
  assert(charRecords().length > 100 && cardRecords().length > 1000, "记录索引：角色 " + charRecords().length + " / 卡牌 " + cardRecords().length);
  assert(pool.length > 1400, "卡池投影：" + pool.length + " 条");

  /* ===== 2. 单 flight：并发调用只取一次数据包 ===== */
  resetDataState();
  fetchCtl.reset();
  fetchCtl.impl = async url => url.includes("dataset.gz") ? GZ(PAYLOAD) : JSONRES(PAYLOAD);
  await Promise.all([ensureData(true), ensureData(true), ensureData(true)]);
  assert(fetchCtl.log.filter(u => u.includes("dataset.gz")).length === 1,
    "单 flight：3 个并发 ensureData 只取一次（实际 " + fetchCtl.log.filter(u => u.includes("dataset.gz")).length + " 次）");
  assert(dataReady === true, "加载成功后 dataReady 置位");

  /* ===== 3. 已就绪：不再发请求 ===== */
  fetchCtl.reset();
  await ensureData();
  assert(fetchCtl.log.length === 0, "已就绪：ensureData 不再发请求");

  /* ===== 4. 失败可重试：flight 释放，下次调用重新取 ===== */
  resetDataState();
  fetchCtl.reset();
  fetchCtl.impl = async () => { throw new Error("离线"); };
  let e1 = null;
  await ensureData(true).catch(e => { e1 = e; });
  assert(!!e1 && /数据包加载失败/.test(e1.message), "全路径失败：抛错而不是半套数据（" + (e1 ? e1.message : "") + "）");
  assert(dataReady === false, "失败后 dataReady 不置位（下次调用会重试）");
  fetchCtl.impl = async url => url.includes("dataset.gz") ? GZ(PAYLOAD) : JSONRES(PAYLOAD);
  await ensureData(true);
  assert(dataReady === true, "失败可重试：网络恢复后再次调用成功");

  /* ===== 5. 刷新：绕过 HTTP 缓存（URL 带时间戳） ===== */
  resetDataState();
  fetchCtl.reset();
  fetchCtl.impl = async url => url.includes("dataset.gz") ? GZ(PAYLOAD) : JSONRES(PAYLOAD);
  await ensureData(true);
  assert(fetchCtl.log.some(u => /dataset\\.gz\\?t=\\d+/.test(u)), "强制刷新：URL 带时间戳绕过 HTTP 缓存");
  assert(dataOrigins.has("network"), "来源如实记录：network（内置快照会记 builtin）");

  /* ===== 6. 三级回退：gz / br 不可用 → json ===== */
  resetDataState();
  fetchCtl.reset();
  fetchCtl.impl = async url => {
    if (url.includes("dataset.gz")) throw new Error("gz 不可用");
    if (url.includes("dataset.br")) throw new Error("br 不可用");
    if (url.includes("dataset.json")) return JSONRES(PAYLOAD);
    throw new Error("unexpected " + url);
  };
  await ensureData(true);
  const order = fetchCtl.log.map(u => (u.match(/dataset\\.(\\w+)/) || [])[1]).filter(Boolean);
  assert(order.join(">") === "gz>br>json", "回退顺序：gz → br → json（实际 " + order.join(">") + "）");
  assert(dataReady === true, "回退到 json 后成功加载");
})();
`;

await t.run(harness, { PAYLOAD, GZ, JSONRES, fetchCtl });
t.finish();
