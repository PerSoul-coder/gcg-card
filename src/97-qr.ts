/* 97-qr.ts —— 分享码二维码：扫码直达（URL 深链）。
   QR 生成用 vendored qrcode-generator（vendor/qrcode/，MIT）；渲染为内联 SVG
   （白底深色模块 + 静区，crispEdges 保证锯齿不糊）。弹层走标准栈（kind "qr"，
   不写历史，与 deckdiff 同类整屏层）。
   内容恒为本页地址 + 分享码的深链（与复制单卡链接同原理）：站点版扫码直接打开；
   单文件版日后托管到网站，同一份 HTML 的扫码内容自然就是线上地址，无需分协议降级。 */
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

/** 二维码内容：本页地址（去旧 hash）+ 分享码深链。 */
export function qrContent(href: string, code: string): string {
  return href.split("#")[0] + "#" + code;
}

export function renderQrView(): void {
  const cur = state.current!;
  const content = qrContent(location.href, cur.code);
  const hint = `二维码内容是本页地址 + 分享码的深链，扫码打开即自动解析这套牌组；下方文本也可直接复制使用。`;
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
