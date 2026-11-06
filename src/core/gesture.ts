/* core/gesture —— 全平台统一的指针语义引擎。
 *
 * 点击（click）、长按（触屏 480ms）、右键（contextmenu）、悬停（hover）四类
 * 手势过去散在各自模块里（90-detail 的 mousemove、93 的长按计时器…），每处
 * 都要自己处理一遍触屏/鼠标差异。这里收敛为一条状态机 + 一个注册表：
 *
 *   bindGestures(selector, { hover?, hoverend?, longpress?, contextmenu? })
 *
 * 引擎职责（消费方不再各自实现）：
 *   · 长按计时与取消（移动 >12px / 抬起 / 滚动 / pointercancel）；
 *   · 右键与 Android 长按原生 contextmenu 的竞态（先到先开，另一方闭嘴）；
 *   · 长按后 700ms 内合成 click 的吞咽（防菜单在指尖下被误点）；
 *   · 悬停能力判定 ((hover:hover) and (pointer:fine))，单例 MQL；
 *   · hover 连续派发（跟随光标）与 hoverend（离开目标）。
 * 注册表按序匹配（closest），先注册者赢——具体目标先注册。
 *
 * 点击不在引擎管辖内：click 由浏览器统一合成（触屏/鼠标同语义），各视图
 * 现有的事件委托已经是全平台一致的，迁移只有风险没有收益。
 *
 * 测试环境护栏：window 级监听与视口尺寸可能不存在（注入的 window 是空对象），
 * 一律 typeof 守卫 + 兜底。 */

export interface PointerCtx {
  x: number;
  y: number;
  /** closest 命中注册选择器的元素 */
  el: HTMLElement;
  event: Event;
}

export interface GestureHandlers {
  /** 指针悬停在目标上（仅 hover-capable 设备；mousemove 连续派发以跟随光标） */
  hover?: (ctx: PointerCtx) => void;
  /** 离开目标（移到非目标元素上时派发一次） */
  hoverend?: () => void;
  /** 触屏长按 480ms */
  longpress?: (ctx: PointerCtx) => void;
  /** 右键（鼠标 contextmenu；Android 长按的原生 contextmenu 也汇到这里） */
  contextmenu?: (ctx: PointerCtx) => void;
}

const LONG_MS = 480;
const MOVE_PX = 12;

interface Entry { sel: string; h: GestureHandlers }

const registry: Entry[] = [];
export function bindGestures(sel: string, h: GestureHandlers): void {
  registry.push({ sel, h });
}

/* ---------- 悬停能力：单例 MQL，随系统偏好实时变化 ---------- */

let hoverMQL: { matches: boolean } | null | undefined;
export function isHoverCapable(): boolean {
  try {
    if (hoverMQL === undefined) {
      hoverMQL = typeof matchMedia === "function" ? matchMedia("(hover: hover) and (pointer: fine)") : null;
    }
    return !hoverMQL || hoverMQL.matches;
  } catch (e) { return true; }
}

/* ---------- 引擎状态 ---------- */

let timer: number | undefined;
let startX = 0, startY = 0, lastTouch = 0;
let swallowUntil = 0;
/** 长按刚触发后的一小段窗口：原生 contextmenu 只压不开（竞态收口） */
let suppressUntil = 0;
let activeHover: Entry | null = null;

function hitOf(target: EventTarget | null): { entry: Entry; el: HTMLElement } | null {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return null;
  for (const e of registry) {
    const m = el.closest(e.sel);
    if (m) return { entry: e, el: m as HTMLElement };
  }
  return null;
}

const cancelTimer = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };

/* ---------- 右键：托管目标拦截，其余保留原生 ---------- */

document.addEventListener("contextmenu", ev => {
  const hit = hitOf(ev.target);
  if (!hit) return;
  ev.preventDefault();
  if (Date.now() < suppressUntil) return;   /* 长按已开过：只压原生 */
  cancelTimer();
  const h = hit.entry.h;
  if (!h.contextmenu && !h.longpress) return;
  const ctx = { x: (ev as MouseEvent).clientX, y: (ev as MouseEvent).clientY, el: hit.el, event: ev };
  if (h.contextmenu) h.contextmenu(ctx);
  else h.longpress && h.longpress(ctx);
});

/* ---------- 长按：pointerdown 起计时，移动/抬起/滚动/打断即取消 ---------- */

document.addEventListener("pointerdown", ev => {
  if (ev.pointerType === "touch") lastTouch = Date.now();
  const hit = hitOf(ev.target);
  if (!hit) return;
  const h = hit.entry.h;
  if (!h.longpress && !h.contextmenu) return;
  startX = ev.clientX; startY = ev.clientY;
  cancelTimer();
  timer = window.setTimeout(() => {
    timer = undefined;
    if (Date.now() - lastTouch > 2000) return;   /* 陈旧计时：指针会话早已结束 */
    try { navigator.vibrate && navigator.vibrate(12); } catch (e) {}
    suppressUntil = Date.now() + 600;            /* 原生 contextmenu 若随后到来，只压不开 */
    swallowUntil = Date.now() + 700;             /* 吞掉随后的合成 click */
    const fn = h.longpress || h.contextmenu;
    fn && fn({ x: startX, y: startY, el: hit.el, event: ev });
  }, LONG_MS);
}, true);
document.addEventListener("pointermove", ev => {
  if (timer === undefined) return;
  if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_PX) cancelTimer();
}, true);
document.addEventListener("pointerup", cancelTimer, true);
document.addEventListener("pointercancel", cancelTimer, true);
document.addEventListener("scroll", cancelTimer, true);

/* 长按后的合成 click 会落在菜单/瓦片上：窗口期内吞掉一次，防误触 */
document.addEventListener("click", ev => {
  if (Date.now() < swallowUntil) { ev.preventDefault(); ev.stopPropagation(); }
}, true);

/* ---------- 悬停：仅 hover-capable 设备；mousemove 连续派发以跟随光标 ---------- */

document.addEventListener("mousemove", ev => {
  if (!isHoverCapable()) return;
  const hit = hitOf(ev.target);
  if (hit && hit.entry.h.hover) {
    activeHover = hit.entry;
    hit.entry.h.hover({ x: (ev as MouseEvent).clientX, y: (ev as MouseEvent).clientY, el: hit.el, event: ev });
    return;
  }
  if (activeHover) {
    const h = activeHover.h;
    activeHover = null;
    h.hoverend && h.hoverend();
  }
});
