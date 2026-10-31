/* core/image.ts —— 图片加载的 Promise 化基建。
   消费者：分享图导出等「把 N 张卡面全部加载完再绘制」的场景。图源（piovium
   静态服务）已实测返回 Access-Control-Allow-Origin: *，crossOrigin=anonymous
   可保 canvas 不被污染、toBlob 可用；任何一张失败都解析为 null，由调用方画
   「卡壳」占位，不让单张 404 拖垮整次导出。
   卡面离线缓存（49-cache，https/localhost）：命中 Cache Storage 直接用（离线
   可看），未命中直连加载、成功后被动回填——缓存只是增强，失败全程静默回落。 */
import { cacheArt, cacheGet } from "../49-cache";

function rawLoad(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let done = false;
    const finish = (v: HTMLImageElement | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    img.onload = () => finish(img.naturalWidth > 0 ? img : null);
    img.onerror = () => finish(null);
    /* 极端情况下 onload/onerror 都不触发（缓存怪癖）：8s 超时兜底 */
    setTimeout(() => finish(null), 8000);
    img.src = url;
  });
}

/** 加载单张图；失败（404 / 断网 / CORS 拒绝）解析为 null 而不是 reject。 */
export async function loadImage(url: string): Promise<HTMLImageElement | null> {
  const blob = await cacheGet(url);
  if (blob) {
    const u = URL.createObjectURL(blob);
    try { return await rawLoad(u); } finally { URL.revokeObjectURL(u); }
  }
  const img = await rawLoad(url);
  if (img) void cacheArt(url);
  return img;
}

/** 并发加载多张，按入参顺序返回结果（失败的槽位是 null）。 */
export async function loadImages(urls: string[]): Promise<Array<HTMLImageElement | null>> {
  return Promise.all(urls.map(loadImage));
}
