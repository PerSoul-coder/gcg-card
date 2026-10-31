/* 七圣召唤 · 卡牌与牌组浏览器 —— Service Worker（PWA 壳，build-single 随单文件产出）。
 *
 * 策略：只拦「文档导航」请求，network-first——在线永远拿最新版。数据快照内联在
 * HTML 里，若用 cache-first 会把数据冻结在首次访问的那次部署；网络失败才回落到
 * 最近一次成功的 HTML（离线可整站打开，牌组数据在 localStorage、卡面缓存另有
 * 49-cache，离线体验完整）。
 *
 * 其余请求（卡面图源等）一概不接管：卡面离线缓存归应用的 49-cache（Cache Storage
 * 名 gi-card-art-v1），与本 SW 的壳缓存互不干扰。激活时清理旧壳缓存必须按
 * gi-shell- 前缀过滤——顺手全删会把应用自己的卡面缓存一起清掉。 */
const CACHE = "gi-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith("gi-shell-") && k !== CACHE).map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  /* 忽略查询串：同一页面只存一份壳（?e2e=1 之类不应各存一份） */
  const key = url.origin + url.pathname;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const copy = res.clone();
        void caches.open(CACHE).then((c) => c.put(key, copy));
      }
      return res;
    } catch (err) {
      const hit = await caches.match(key);
      if (hit) return hit;
      throw err;
    }
  })());
});
