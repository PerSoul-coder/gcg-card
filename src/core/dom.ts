/* 核心工具：DOM 查询、转义、提示条、剪贴板。 */

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
  setTimeout(() => t.remove(), 2600);
}

export function copyText(t: string): Promise<void> {
  return navigator.clipboard.writeText(t);
}
