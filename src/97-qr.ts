/* 97-qr.ts —— 分享码二维码：扫码直达（URL 深链）或取码粘贴（file:// 降级）。
   QR 生成用 vendored qrcode-generator（vendor/qrcode/，MIT）；渲染为内联 SVG
   （白底深色模块 + 静区，crispEdges 保证锯齿不糊）。弹层走标准栈（kind "qr"，
   不写历史，与 deckdiff 同类整屏层）。 */
import { $, esc, toast } from "./core/dom";
import { ICON_X } from "./core/resources";
import { dataReady, ensureData } from "./20-data";
import { state } from "./data/state";
import { renderOverlay, setOverlayOpen } from "./90-detail";
import { overlayHashClear } from "./core/history";
import qrcode from "../vendor/qrcode/qrcode.js";

/** 文本 → 内联 SVG（白底 + 静区 4 模块，尺寸固定，由 CSS 缩放展示）。 */
export function qrSvg(text: string, size = 264): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const cell = size / (n + quiet * 2);
  let path = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      path += `M${((c + quiet) * cell).toFixed(2)},${((r + quiet) * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
    }
  }
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="分享码二维码"><rect width="${size}" height="${size}" fill="#ffffff"/><path d="${path}" fill="#12161d"/></svg>`;
}

export function renderQrView(): void {
  const cur = state.current!;
  /* http(s)：编「本页地址 + #分享码」深链，扫码直接打开并解析；
     file://：本页地址不可分享，降级为裸分享码（对方复制后粘贴解析） */
  const isHttp = location.protocol === "http:" || location.protocol === "https:";
  const content = isHttp ? `${location.origin}${location.pathname}#${cur.code}` : cur.code;
  const hint = isHttp
    ? `用手机扫码即可打开当前页面并自动解析这套牌组；二维码内容是本页地址 + 分享码深链。`
    : `当前是单文件离线版，页面地址不可分享——二维码内容是分享码本体，扫码后把文本粘贴到牌组页签的解析框即可。`;
  $("detail").innerHTML = `<div class="navbtns"><button title="关闭 (Esc)" data-act="close">${ICON_X}</button></div>
    <div class="dinfo"><h2>分享码二维码</h2>
    <div class="qr-view">${qrSvg(content)}
      <p class="qr-hint">${esc(hint)}</p>
      <p class="qr-code mono">${esc(content)}</p></div></div>`;
  setOverlayOpen(true);
}
export function showQr(): void {
  if (!dataReady) {
    ensureData().then(showQr).catch((e: Error) => toast("数据加载失败：" + e.message, true));
    return;
  }
  if (!state.current) { toast("请先解析一个牌组", true); return; }
  overlayHashClear();   /* 整屏弹层不写历史：与 deckdiff 同类 */
  state.overlayStack = [{ kind: "qr", scrollTop: 0, cmpLeft: 0 }];
  renderOverlay();
}
