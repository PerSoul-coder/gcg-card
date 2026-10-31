/* 核心工具：DOM 查询、转义、提示条、剪贴板。 */
import { animationTotalMs } from "./motion";

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as unknown as T;

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/* ---------- 状态条 / 提示条 / 剪贴板 ---------- */
export function setStatus(msg: string, cls = ""): void {
  const s = $("status");
  s.innerHTML = msg;
  s.className = cls;
}

/* 提示条：最多同时 3 条（超出先撤最早一条），避免连续加入卡牌时堆满屏幕遮住内容 */
const TOAST_MAX = 3;
export function toast(msg: string, err = false): void {
  const box = $("toasts");
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = msg;
  if (box && box.appendChild) box.appendChild(t);
  /* HTMLCollection 是活集合：撤掉最早一条后长度即刻更新 */
  const kids = box && box.children;
  if (kids && typeof kids.length === "number") {
    for (let guard = 0; kids.length > TOAST_MAX && guard < 50; guard++) {
      const first = kids[0] as HTMLElement | undefined;
      if (!first || first === t || typeof first.remove !== "function") break;
      first.remove();
    }
  }
  /* 存活期从 CSS 现读（tin 入场 + tout 延迟退场的总时长；.err 走更长的 --toast-life），
     此前是 JS 2600ms ↔ CSS 2.4s 两份独立硬编码，改任一侧都会错位 */
  setTimeout(() => t.remove(), animationTotalMs(t, 2800) + 80);
}

/* 剪贴板：优先 async Clipboard API；file:// 等场景可能拒权或缺失，
   退回 textarea + execCommand 兜底（两路都失败才拒绝，调用方各自决定提示）。 */
export function copyText(t: string): Promise<void> {
  const clip = navigator.clipboard;
  if (clip && typeof clip.writeText === "function") {
    return clip.writeText(t).catch(() => copyViaExecCommand(t));
  }
  return copyViaExecCommand(t);
}
function copyViaExecCommand(t: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    ok ? resolve() : reject(new Error("复制失败"));
  });
}
