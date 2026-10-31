/**
 * 浮层层级管理。
 *
 * 此前 Esc 的关闭顺序硬编码在入口里：
 *   overlay → draftPanel → histPanel → exportMenu
 * 新增一层就得记得改那一处；漏了就会出现「Esc 关不掉」或「关错层」，
 * 而「更多」菜单（histPanel 的同级下拉）确实一直没被覆盖。
 *
 * 现在每一层自己登记三件事：怎么判断打开、怎么关闭、在哪一层。
 * Esc 只问一句「最上面那层是谁」。
 *
 * 锁文档滚动也归这里：只有 labeled modal 的层才锁。
 * 之前的实现把历史面板（文档流内）与对比栏（常驻浮条）也算进去，
 * 结果是「选中过对比卡之后整页再也滚不动」——常驻浮条不是模态层。
 */

export interface LayerSpec {
  /** 语义 id，用于调试与测试断言 */
  id: string;
  /** 当前是否打开 */
  isOpen: () => boolean;
  /** 关闭这一层（包含它自己的清理副作用） */
  close: () => void;
  /** 层序：数值越大越靠上，与 CSS 的 z-index 对应，便于对照排查 */
  order: number;
  /** 模态层：打开期间锁住文档滚动。常驻浮条（对比栏）与文档流内面板（历史）不要设 */
  modal?: boolean;
}

const specs = new Map<string, LayerSpec>();

/** 登记一层。同一 id 重复登记会覆盖（模块重复初始化时幂等）。 */
export function registerLayer(spec: LayerSpec): void {
  specs.set(spec.id, spec);
}

/**
 * 模态浮层的成对开关：类名切换 + 层登记 + 滚动锁同步，三件事一个函数做完。
 * 「改 modal 层的类名必须跟一次 syncScrollLock」此前纯靠约定散在多个调用点，
 * 漏一处即复现滚动锁卡死（见文件头旧事故）——现在结构上不可能漏。
 * 带退场动画的层（overlay / lightbox）关闭不适用：它们的类名分两步变化
 * （退场开始即算关闭），锁由 core/motion animateExit 的 onStart 释放；打开可用本函数。
 */
export function setModalLayer(
  id: string,
  el: { classList?: { toggle(c: string, f: boolean): void; contains(c: string): boolean } } | null,
  open: boolean,
  opts: { order: number; close: () => void },
): void {
  if (el && el.classList) el.classList.toggle("show", open);
  registerLayer({
    id,
    isOpen: () => !!(el && el.classList && el.classList.contains("show")),
    close: opts.close,
    order: opts.order,
    modal: true,
  });
  syncScrollLock();
}

/** 当前打开的层，自顶向下。 */
export function openLayers(): LayerSpec[] {
  const open: LayerSpec[] = [];
  for (const s of specs.values()) {
    try {
      if (s.isOpen()) open.push(s);
    } catch {
      /* 层还在初始化（元素未就绪）时不算打开 */
    }
  }
  return open.sort((a, b) => b.order - a.order);
}

/**
 * 关闭最上面一层。返回是否真的关掉了什么——
 * 调用方据此决定「Esc 已消费」还是「继续往下传」。
 */
export function closeTopLayer(): boolean {
  const top = openLayers()[0];
  if (!top) return false;
  top.close();
  syncScrollLock();
  return true;
}

/* ---------- 滚动锁 ---------- */

let locked = false;
let savedPadding = "";

/**
 * 按当前打开的模态层同步文档滚动锁。
 * 补偿 scrollbar 宽度：锁定瞬间滚动条消失会让页面横向跳一下，
 * 补同宽的 padding-right 正好抵消。宽度必须在加锁前读，加锁后 clientWidth 会变。
 */
export function syncScrollLock(): void {
  const should = openLayers().some(s => s.modal);
  if (should === locked) return;
  const root = typeof document !== "undefined" ? document.documentElement : null;
  const body = typeof document !== "undefined" ? document.body : null;

  if (should) {
    const sbw = root && typeof root.clientWidth === "number" && typeof window !== "undefined"
      ? window.innerWidth - root.clientWidth : 0;
    if (root && root.classList) root.classList.add("layer-lock");
    if (body && body.style) {
      savedPadding = body.style.paddingRight || "";
      if (sbw > 0) body.style.paddingRight = sbw + "px";
    }
  } else {
    if (root && root.classList) root.classList.remove("layer-lock");
    if (body && body.style) body.style.paddingRight = savedPadding;
  }
  locked = should;
}
