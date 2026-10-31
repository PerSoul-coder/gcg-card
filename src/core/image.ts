/* core/image.ts —— 图片加载的 Promise 化基建。
   目前唯一消费者是分享图导出（95-export 的 canvas 绘制）：把 N 张卡面
   「全部加载完再绘制」这件事收口在这里。图源（piovium 静态服务）已实测
   返回 Access-Control-Allow-Origin: *，crossOrigin=anonymous 可保 canvas
   不被污染、toBlob 可用；任何一张失败都解析为 null，由调用方画「卡壳」占位，
   不让单张 404 拖垮整次导出。 */

/** 加载单张图；失败（404 / 断网 / CORS 拒绝）解析为 null 而不是 reject。 */
export function loadImage(url: string): Promise<HTMLImageElement | null> {
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

/** 并发加载多张，按入参顺序返回结果（失败的槽位是 null）。 */
export async function loadImages(urls: string[]): Promise<Array<HTMLImageElement | null>> {
  return Promise.all(urls.map(loadImage));
}
