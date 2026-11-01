/* 49-cache.ts —— 卡面离线缓存 + 统一资源缓存管理界面。
   卡面图来自静态数据源 CDN（需联网）；这里把它们存进浏览器的 Cache Storage：
   看过的卡被动回填（core/image.ts 在加载成功后调 cacheArt），管理界面里可一键
   全量预缓存 / 清除，并给出用量估计。仅 https / localhost 可用（Cache API 的
   安全上下文要求）；file:// 单文件版自动降级为直连，界面里明说。
   缓存只是增强：任何一步失败都静默回落直连，不拖垮图片加载。 */
import { $, esc, toast } from "./core/dom";
import { ICON_X } from "./core/resources";
import { imgFull } from "./core/resources";
import { pool } from "./45-pool";
import { state } from "./data/state";
import { renderOverlay, setOverlayOpen } from "./90-detail";
import { overlayHashClear } from "./core/history";

/* v2：一次性作废 v1 的全部旧图——CDN 素材更新后 Cache Storage 命中优先的旧条目
   永不刷新（cache.add 对已有 key 秒过），用户端因此残留过时的旧比例牌面。
   升版即全员重新拉取（看过的卡被动回填 + 可重新全量预缓存）。 */
export const CACHE_NAME = "gi-card-art-v2";

export function cacheAvailable(): boolean {
  let ok = false;
  try { ok = typeof caches !== "undefined" && typeof caches.open === "function"; } catch (e) { ok = false; }
  /* 非安全上下文（http:// 外网 / file://）下 caches 可能存在但行为受限，直接视为不可用 */
  try { if (typeof isSecureContext !== "undefined" && !isSecureContext) ok = false; } catch (e) {}
  return ok;
}
async function openCache(): Promise<Cache | null> {
  if (!cacheAvailable()) return null;
  try { return await caches.open(CACHE_NAME); } catch (e) { return null; }
}

/** 被动回填：图片加载成功后调用。已缓存则跳过；失败静默。 */
export async function cacheArt(url: string): Promise<void> {
  const c = await openCache();
  if (!c) return;
  try {
    if (await c.match(url)) return;
    await c.add(url);
  } catch (e) { /* 配额 / 网络失败：缓存只是增强 */ }
}
/** 优先从缓存取（离线可用）；未命中 / 不可用返回 null，调用方回落直连。 */
export async function cacheGet(url: string): Promise<Blob | null> {
  const c = await openCache();
  if (!c) return null;
  try {
    const hit = await c.match(url);
    return hit ? await hit.blob() : null;
  } catch (e) { return null; }
}
export async function cachedArtCount(): Promise<number> {
  const c = await openCache();
  if (!c) return 0;
  try { return (await c.keys()).length; } catch (e) { return 0; }
}
export async function clearArtCache(): Promise<void> {
  try { await caches.delete(CACHE_NAME); } catch (e) {}
}
/** 卡面 URL 全集（去重）。 */
export function artUrls(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of pool) {
    const u = imgFull(x.id);
    if (!seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}
/** 全量预缓存：并发 worker 爬取，onProgress(done, total, failed)；返回 abort 函数。
    已缓存的条目秒过（match 命中不重新下载），所以重复执行是增量式的。 */
export function cacheAllArt(onProgress: (done: number, total: number, failed: number) => void, concurrency = 6): () => void {
  const urls = artUrls();
  const total = urls.length;
  let done = 0, failed = 0, aborted = false, i = 0;
  void (async () => {
    const c = await openCache();
    if (!c || !total) { onProgress(total, total, total); return; }
    const worker = async () => {
      while (!aborted) {
        const k = i++;
        if (k >= total) return;
        const u = urls[k];
        try { if (!(await c.match(u))) await c.add(u); } catch (e) { failed++; }
        done++;
        onProgress(done, total, failed);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  })();
  return () => { aborted = true; };
}

/* ---------- 管理界面（overlay kind "cache"，不写历史，与 qr / textimport 同类） ---------- */
let abortCaching: (() => void) | null = null;

export function showCacheManager(): void {
  overlayHashClear();
  state.overlayStack = [{ kind: "cache", scrollTop: 0, cmpLeft: 0 }];
  renderOverlay();
}

function fmtMB(n: number): string {
  return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
}
async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage || 0, quota: e.quota || 0 };
  } catch (e) { return null; }
}
export function renderCacheView(): void {
  const ok = cacheAvailable();
  const total = artUrls().length;
  $("detail").innerHTML = `<div class="navbtns"><button title="关闭 (Esc)" data-act="close">${ICON_X}</button></div>
    <div class="dinfo ti-view"><h2>资源缓存</h2>
    ${ok ? `
    <p class="ti-hint">卡面图来自静态数据源 CDN（平时需要联网）。这里把它们存进浏览器的 Cache Storage：<b>看过的卡会自动缓存</b>，也可以一键全量预缓存——之后断网也能看卡面。数据快照内置于应用包，不需要缓存。</p>
    <div class="ti-sec">状态</div>
    <div class="ti-row">已缓存卡面：<b id="cacheCount">…</b> / ${total}</div>
    <div class="ti-row" id="cacheStorage">存储用量：…</div>
    <div class="ti-progress" id="cacheProgWrap" hidden>
      <div class="ti-bar"><div class="ti-fill" id="cacheFill"></div></div>
      <span id="cacheProgText"></span>
    </div>
    <div class="ti-acts" style="justify-content:flex-start">
      <button class="primary" data-cache="all" id="cacheAllBtn">缓存全部卡面（${total} 张）</button>
      <button data-cache="stop" id="cacheStopBtn" hidden>停止</button>
      <button data-cache="clear">清除卡面缓存</button>
    </div>`
    : `
    <p class="ti-hint">当前环境<b>不支持缓存</b>：Cache Storage 需要 https 或 localhost（file:// 单文件版不可用）。卡面图保持联网加载即可，应用本身与数据快照不受影响。</p>`}
    </div>`;
  setOverlayOpen(true);
  if (!ok) return;
  void (async () => {
    const n = await cachedArtCount();
    const el = $("cacheCount");
    if (el) el.textContent = String(n);
    const est = await storageEstimate();
    const st = $("cacheStorage");
    if (st) st.textContent = est && est.quota
      ? `存储用量：约 ${fmtMB(est.usage)}（本站可用配额约 ${fmtMB(est.quota)}）`
      : "存储用量：浏览器未提供估计值";
  })();
}

/* 管理按钮委托（data-cache）；关闭走 90-detail 通用的 data-act="close" */
document.addEventListener("click", ev => {
  const b = (ev.target as HTMLElement).closest("[data-cache]") as HTMLElement | null;
  if (!b) return;
  const act = b.dataset.cache;
  if (act === "all") {
    if (abortCaching) return;
    const wrap = $("cacheProgWrap"), fill = $("cacheFill"), text = $("cacheProgText"), stop = $("cacheStopBtn"), allBtn = $("cacheAllBtn");
    if (wrap) wrap.hidden = false;
    if (stop) stop.hidden = false;
    if (allBtn) (allBtn as HTMLButtonElement).disabled = true;
    abortCaching = cacheAllArt((done, total, failed) => {
      if (fill) fill.style.width = total ? Math.round(done / total * 100) + "%" : "100%";
      if (text) text.textContent = `${done} / ${total}${failed ? `（失败 ${failed}）` : ""}`;
      if (done >= total) {
        abortCaching = null;
        if (wrap) wrap.hidden = true;
        if (stop) stop.hidden = true;
        if (allBtn) (allBtn as HTMLButtonElement).disabled = false;
        void cachedArtCount().then(n => { const el = $("cacheCount"); if (el) el.textContent = String(n); });
        toast(failed ? `预缓存完成：${total - failed} 成功 / ${failed} 失败` : "全部卡面已缓存，断网也能看卡面了");
      }
    });
  } else if (act === "stop") {
    if (abortCaching) { abortCaching(); abortCaching = null; }
    if ($("cacheProgWrap")) $("cacheProgWrap").hidden = true;
    if ($("cacheStopBtn")) $("cacheStopBtn").hidden = true;
    if ($("cacheAllBtn")) ($("cacheAllBtn") as HTMLButtonElement).disabled = false;
  } else if (act === "clear") {
    void (async () => {
      await clearArtCache();
      const n = await cachedArtCount();
      const el = $("cacheCount");
      if (el) el.textContent = String(n);
      toast("卡面缓存已清除");
    })();
  }
});
