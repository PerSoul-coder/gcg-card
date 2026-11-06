/* core/menu —— 弹出菜单组件：层级化菜单系统，根层与子级同一套面板样式。
 *
 * 规格是纯数据（CtxMenu/CtxItem，见 types.ts）：run 执行、children 子级、
 * checked 勾选态、danger 危险色、hint 右侧弱化说明、sep 分隔线。
 *
 * 交互全平台一条路：
 *   · 子级展开 —— 悬停（有指针设备，120ms 防抖）与点按（触屏）都走 openChild；
 *     子级就近飞出（右侧优先，靠边自动翻左），不做移动端专属的钻入式导航——
 *     两端同一套渲染与定位逻辑，才是真正的统一。
 *   · 键盘全程可达 —— ↑↓ 移动（跳过分隔线/禁用项），→/Enter 开子级或执行，
 *     ←/Esc 逐层返回，Home/End 跳转；活动项真实 focus，读屏跟随。
 *   · 视口四边钳制；同一时刻至多一个菜单实例；点外面/滚动/改窗口/路由变化收起。
 *
 * 信息密度契约：子级用于收纳「同族操作」，根层保持一屏可扫（≤7 项）；
 * 勾选列固定宽度，标签永远对齐——整齐本身就是降噪。 */

import type { CtxItem, CtxMenu } from "../types";
import { esc } from "./dom";

interface LevelState { el: HTMLElement; items: CtxItem[]; pinned: boolean }
let levels: LevelState[] = [];                                   /* 0 = 根层（恒 pinned） */
let active: number[] = [];                                       /* 每层键盘/悬停焦点下标 */
let closeHooks: Array<() => void> = [];
let onCloseCb: (() => void) | null = null;
/* 子级两种展开状态独立建模：
   · auto（悬停展开）——暂态：指针离开菜单即收（带宽限），悬停别的行也收；
   · pinned（点击/键盘展开）——钉住：指针离开不收，直到悬停别的行、
     Esc 逐层、或再点一次父行（明确收起）。点击 auto 子级的父行 = 转钉住。 */
let hoverTimer: number | undefined;      /* 自动展开防抖 */
let leaveTimer: number | undefined;      /* 离开菜单的收起宽限 */

export const menuOpen = (): boolean => levels.length > 0;

export function closeMenu(): void {
  cancelTimers();
  for (const fn of closeHooks) fn();
  closeHooks = [];
  for (const l of levels) l.el.remove();
  levels = [];
  active = [];
  const cb = onCloseCb;
  onCloseCb = null;
  if (cb) cb();
}

function cancelTimers(): void {
  if (hoverTimer !== undefined) { clearTimeout(hoverTimer); hoverTimer = undefined; }
  if (leaveTimer !== undefined) { clearTimeout(leaveTimer); leaveTimer = undefined; }
}

/* ---------- 构建 ---------- */

export function openMenuAt(x: number, y: number, spec: CtxMenu, onClose?: () => void): void {
  closeMenu();
  onCloseCb = onClose || null;
  const el = buildLevel(spec.items, spec.title || "");
  document.body.appendChild(el);
  levels.push({ el, items: spec.items, pinned: true });   /* 根层恒钉住 */
  active.push(-1);
  placeAt(el, x, y);
  attachDismiss();
  /* 键盘起点：首条可点条目（读屏与方向键都有一个明确的落点） */
  setActive(0, nearestActivable(0, 0, 1));
}

function buildLevel(items: CtxItem[], title: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "cmenu";
  if (!levels.length) el.id = "ctxmenu";
  el.setAttribute("role", "menu");
  el.innerHTML = (title ? `<div class="cmenu-title">${esc(title)}</div>` : "") +
    items.map((it, i) => {
      if (it.sep) return `<div class="cmenu-sep" role="separator"></div>`;
      const cls = (it.danger ? " danger" : "") + (it.disabled ? " disabled" : "") + (it.checked ? " checked" : "");
      const caret = it.children && it.children.length ? `<span class="cmenu-caret" aria-hidden="true">▸</span>` : "";
      const hint = it.hint ? `<span class="cmenu-hint">${esc(it.hint)}</span>` : "";
      return `<button class="cmenu-row${cls}" role="menuitem"` +
        ` data-mi="${i}" aria-haspopup="${it.children && it.children.length ? "menu" : "false"}"` +
        `${it.disabled ? " disabled" : ""}>` +
        `<span class="cmenu-check" aria-hidden="true">${it.checked ? "✓" : ""}</span>` +
        `<span class="cmenu-label">${esc(it.label)}</span>${hint}${caret}</button>`;
    }).join("");
  el.addEventListener("click", ev => {
    const b = (ev.target as HTMLElement).closest("[data-mi]") as HTMLElement | null;
    if (!b) return;
    /* 层号在 push 进 levels 栈时才确定，点击时按 el 反查 */
    const li = levels.findIndex(l => l.el === el);
    if (li >= 0) activate(li, Number(b.dataset.mi));
  });
  /* 悬停展开子级（auto 暂态）：有指针设备的加速路径；触屏走点按（pinned）。
     进入面板先撤收起宽限；120ms 防抖防扫过即开 */
  el.addEventListener("mouseenter", ev => {
    if (leaveTimer !== undefined) { clearTimeout(leaveTimer); leaveTimer = undefined; }
    const b = (ev.target as HTMLElement).closest("[data-mi]") as HTMLElement | null;
    if (!b) return;
    const li = levels.findIndex(l => l.el === el);
    if (li < 0) return;
    const idx = Number(b.dataset.mi);
    setActive(li, idx, false);
    const it = levels[li].items[idx];
    if (it && it.children && it.children.length && !it.disabled) {
      if (hoverTimer !== undefined) clearTimeout(hoverTimer);
      hoverTimer = window.setTimeout(() => {
        hoverTimer = undefined;
        /* 悬停目标被键盘操作改变时不再自动展开；已开（钉住）不重开 */
        if (levels[li] && active[li] === idx && (!levels[li + 1] || openedFrom[li + 1] !== idx)) openChild(li, idx, false);
      }, 120);
    } else {
      trimTo(li);   /* 悬停到普通行：更深的子级一律收（钉住也不跨行留存） */
    }
  }, true);
  /* 指针离开面板：自动展开的子级宽限后收起；点击（钉住）的子级不受影响 */
  el.addEventListener("mouseleave", () => { scheduleLeaveCollapse(); }, true);
  return el;
}

/* openedFrom[l] = 第 l 层是由第 l-1 层的哪个条目打开的（悬停防抖与修剪用） */
const openedFrom: Array<number | undefined> = [];

function openChild(levelIdx: number, itemIdx: number, pinned: boolean): void {
  const parent = levels[levelIdx];
  if (!parent) return;
  const it = parent.items[itemIdx];
  if (!it || !it.children || !it.children.length) return;
  /* 已在该子级：不重开 */
  if (levels[levelIdx + 1] && openedFrom[levelIdx + 1] === itemIdx) return;
  trimTo(levelIdx);
  const row = parent.el.querySelector(`[data-mi="${itemIdx}"]`) as HTMLElement | null;
  const el = buildLevel(it.children, "");
  document.body.appendChild(el);
  levels.push({ el, items: it.children, pinned });
  openedFrom[levelIdx + 1] = itemIdx;
  active.push(-1);
  const r = row ? row.getBoundingClientRect() : { right: 0, top: 0, left: 0 };
  placeAt(el, r.right + 2, r.top - 4, row);
  setActive(levelIdx + 1, nearestActivable(levelIdx + 1, 0, 1));
}

/* 修剪到第 levelIdx 层（含）：更深的子级全部关闭 */
function trimTo(levelIdx: number): void {
  cancelTimers();
  while (levels.length > levelIdx + 1) {
    const l = levels.pop();
    if (l) l.el.remove();
    active.pop();
    openedFrom.pop();
  }
}

/* 指针离开菜单：宽限 280ms（跨面板间隙/斜向移动不闪收），到期从顶往下收掉
   连续的 auto 子级——pinned 子级与其下的层级原样保留。挂起的 auto 展开一并撤销 */
function scheduleLeaveCollapse(): void {
  if (hoverTimer !== undefined) { clearTimeout(hoverTimer); hoverTimer = undefined; }
  if (leaveTimer !== undefined) clearTimeout(leaveTimer);
  leaveTimer = window.setTimeout(() => {
    leaveTimer = undefined;
    let top = levels.length - 1;
    while (top > 0 && !levels[top].pinned) top--;
    if (top < levels.length - 1) trimTo(top);
  }, 280);
}

/* ---------- 定位：四边钳制 + 子级就近翻边 ---------- */

function vw(): number { try { return Number(window && window.innerWidth) || 375; } catch (e) { return 375; } }
function vh(): number { try { return Number(window && window.innerHeight) || 667; } catch (e) { return 667; } }
function rectOf(el: HTMLElement): { width: number; height: number } {
  try {
    const r = el.getBoundingClientRect();
    if (r && r.width) return { width: r.width, height: r.height };
  } catch (e) {}
  return { width: 220, height: 160 };
}

function placeAt(el: HTMLElement, x: number, y: number, anchorRow?: HTMLElement | null): void {
  const { width, height } = rectOf(el);
  let lx = x, ly = y;
  /* 子级：右侧放不下就翻到锚行左侧 */
  if (anchorRow) {
    const anchor = anchorRow.getBoundingClientRect();
    if (Number(anchor.right) && lx + width > vw() - 8) lx = Number(anchor.left) - width - 2;
  }
  if (lx + width > vw() - 8) lx = Math.max(8, vw() - width - 8);
  if (ly + height > vh() - 8) ly = Math.max(8, vh() - height - 8);
  el.style.left = Math.max(8, lx) + "px";
  el.style.top = Math.max(8, ly) + "px";
}

/* ---------- 激活与键盘 ---------- */

function activable(li: number, i: number): boolean {
  const it = levels[li] && levels[li].items[i];
  return !!it && !it.sep && !it.disabled;
}
function nearestActivable(li: number, from: number, dir: 1 | -1): number {
  const items = levels[li].items;
  let i = from;
  for (let n = 0; n < items.length; n++) {
    if (activable(li, i)) return i;
    i = (i + dir + items.length) % items.length;
  }
  return -1;
}

function setActive(li: number, idx: number, focus = true): void {
  if (!levels[li]) return;
  active[li] = idx;
  const rows = [...levels[li].el.querySelectorAll("[data-mi]")];
  rows.forEach(r => (r as HTMLElement).classList.remove("active"));
  if (idx < 0) return;
  const row = rows[idx] as HTMLElement | undefined;
  if (!row) return;
  row.classList.add("active");
  if (focus && typeof row.focus === "function") row.focus({ preventScroll: true } as FocusOptions);
}

function activate(li: number, idx: number): void {
  const it = levels[li] && levels[li].items[idx];
  if (!it || it.sep || it.disabled) return;
  if (it.children && it.children.length) {
    /* 点击/键盘 = 明确意图，与悬停的 auto 暂态分开：
       · 子级未开 → 开成 pinned；
       · 子级是 auto（悬停开的）→ 转为 pinned（不是收起）；
       · 子级已 pinned → 再点 = 明确收起。 */
    const existing = levels[li + 1] && openedFrom[li + 1] === idx ? levels[li + 1] : null;
    if (existing) {
      if (existing.pinned) trimTo(li);
      else existing.pinned = true;
    } else openChild(li, idx, true);
    return;
  }
  closeMenu();
  if (it.run) it.run();
}

function attachDismiss(): void {
  const onDown = (ev: Event) => {
    const t = ev.target as Node | null;
    if (t && levels.some(l => { try { return l.el.contains(t); } catch (e) { return false; } })) return;
    closeMenu();
  };
  const onScroll = () => closeMenu();
  const onKey = (ev: KeyboardEvent) => {
    if (!levels.length) return;
    const li = levels.length - 1;
    if (ev.key === "Escape") {
      ev.preventDefault(); ev.stopPropagation();
      if (li > 0) trimTo(li - 1); else closeMenu();
      return;
    }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const dir = ev.key === "ArrowDown" ? 1 : -1;
      const cur = active[li] < 0 ? (dir === 1 ? -1 : 0) : active[li];
      setActive(li, nearestActivable(li, (cur + dir + levels[li].items.length) % levels[li].items.length, dir as 1 | -1));
      return;
    }
    if (ev.key === "Home" || ev.key === "End") {
      ev.preventDefault();
      setActive(li, nearestActivable(li, ev.key === "Home" ? levels[li].items.length - 1 : 0, ev.key === "Home" ? -1 : 1));
      return;
    }
    if (ev.key === "ArrowRight") {
      ev.preventDefault();
      const idx = active[li];
      const it = idx >= 0 ? levels[li].items[idx] : null;
      /* 键盘开子级 = 明确意图 → pinned */
      if (it && it.children && it.children.length) openChild(li, idx, true);
      return;
    }
    if (ev.key === "ArrowLeft") {
      if (li > 0) { ev.preventDefault(); trimTo(li - 1); const p = openedFrom[li]; if (p != null) setActive(li - 1, p); }
      return;
    }
    /* Enter/Space 不在键盘层处理：活动项是真实 focus 的 button，
       原生按键行为派发 click → 层内 click 监听 → activate，这里再调就是双触发 */
    if (ev.key === "Tab") closeMenu();
  };
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("scroll", onScroll, true);
  document.addEventListener("keydown", onKey, true);
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("resize", closeMenu, { once: true });
    window.addEventListener("hashchange", closeMenu, { once: true });
  }
  closeHooks.push(() => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("scroll", onScroll, true);
    document.removeEventListener("keydown", onKey, true);
  });
}
