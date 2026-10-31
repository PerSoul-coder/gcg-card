/* 51-pwa.ts —— PWA 注册（仅安全上下文；file:// 单文件版 / 无 sw.js 的部署自动跳过）。
 *
 * Service Worker 只管「文档导航 network-first + 离线回落最近成功的 HTML」（pwa/sw.js）：
 * 在线永远拿最新版，数据快照内联在 HTML 里随部署一起更新；卡面缓存仍归 49-cache，
 * 两者的 Cache Storage 互不重叠。注册失败（无 sw.js 的单文件部署 / 不支持的浏览器）
 * 静默跳过——PWA 只是托管场景的增强，绝不能反过来影响应用本体。
 *
 * 版本感知：sw.js 用 skipWaiting，新版本可能在页面 register() 挂上 updatefound
 * 监听之前就完成接管（本地毫秒级，真实网络下也会发生）——所以以 controllerchange
 * 为准：页面求值时已有旧控制器、随后控制器易主，即「新版本已就绪」，给一条
 * 可点击的刷新提示（首装的 claim 因求值时无控制器而不误报）。另外「回到标签页」
 * 时顺手 update() 一次，长开不关的页签也能发现新部署。 */
import { actionToast } from "./core/dom";

export function registerPwa(): void {
  try {
    if (typeof isSecureContext === "undefined" || !isSecureContext) return;
    if (!("serviceWorker" in navigator)) return;
    /* 求值时刻的控制器快照：此后 controllerchange = 版本更替（首装时为空 → 不提示） */
    const hadController = !!navigator.serviceWorker.controller;
    let notified = false;
    const notify = () => {
      if (notified || !navigator.serviceWorker.controller) return;
      notified = true;
      actionToast("发现新版本", "刷新更新", () => location.reload());
    };
    navigator.serviceWorker.addEventListener("controllerchange", notify);
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").then(reg => {
        if (reg.waiting) notify(); /* 兜底：更新已装好但尚未接管 */
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => { if (nw.state === "installed") notify(); });
        });
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void reg.update().catch(() => { /* 离线/瞬断：忽略 */ });
        });
      }).catch(() => { /* 无 sw.js（单文件部署）：PWA 只是增强 */ });
    });
  } catch (e) { /* PWA 只是增强 */ }
}

registerPwa();
