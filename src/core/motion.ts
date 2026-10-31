/* 动效中枢：唯一拥有「退场动画生命周期」的地方。
 *
 * 完整生命周期此前只存在于 overlay 的关闭路径，是一段六步手工序列
 * （取消旧退场 → 挂 animationend → 摘 .show → 挂 .closing → 兜底定时器 →
 * 幂等收尾 + 同步滚动锁）。两轮事故都发生在这里：重写函数丢一行
 * classList.add("closing")，动画就再没播放过；收尾漏同步滚动锁，锁就永久卡死。
 * 手抄序列无法复用——第二个想要退场动画的浮层就得再赌一次运气。
 * 于是把这套经过实战检验的结构收敛成唯一实现，调用方只给类名与回调。
 *
 * 兜底时长不再与 CSS 双份硬编码（旧 overlay 是 TS 280ms ↔ CSS .18s 两份独立数字）：
 * 直接从 computed style 读动画总时长（duration + delay 逐个取最大），改 CSS 自动跟随。 */

/** 动效是否可用：reduced-motion 与测试环境（无 matchMedia）返回 false，
 *  调用方据此走瞬时路径——与 CSS 的 reduced-motion 归零语义一致，也不拖慢同步断言。 */
export function motionOK(): boolean {
  try {
    return typeof window.matchMedia === "function"
      && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) { return false; }
}

/* CSSOM 的时长/延迟带单位（s 或 ms——reduced-motion 归零写的是 .001ms），
   统一换算成毫秒；无单位按秒（CSSOM 缺省口径）。 */
function cssTimeToMs(v: string): number {
  const m = /^\s*([\d.]+)(ms|s)?\s*$/.exec(v || "");
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  return m[2] === "ms" ? n : n * 1000;
}

/* 元素上所有 animation 的总时长（duration + delay 逐个取最大，秒 → 毫秒）。
   多重动画（如 toast 的 tin + tout 延迟退场）取最长的一条。
   读不到（测试 stub / 元素未挂载）返回 fallback。 */
export function animationTotalMs(el: HTMLElement, fallback = 400): number {
  try {
    const gcs = typeof window !== "undefined"
      ? (window as unknown as { getComputedStyle?: (e: HTMLElement) => { animationDuration?: string; animationDelay?: string } | null }).getComputedStyle
      : null;
    const cs = typeof gcs === "function" ? gcs(el) : null;
    if (!cs) return fallback;
    const durs = String(cs.animationDuration || "").split(",");
    const dels = String(cs.animationDelay || "").split(",");
    let max = -1;
    for (let i = 0; i < durs.length; i++) {
      const d = cssTimeToMs(durs[i]);
      if (!Number.isFinite(d)) continue;
      const w = cssTimeToMs(dels[i] || "0s");
      const total = d + (Number.isFinite(w) ? w : 0);
      if (total > max) max = total;
    }
    return max >= 0 ? Math.ceil(max) : fallback;
  } catch (e) { return fallback; }
}

export interface ExitOptions {
  el: HTMLElement;
  /** 立刻摘除的「打开态」类：摘除即层算关闭（isOpen 谓词读它，滚动锁随之释放） */
  openCls: string;
  /** 退场动画类：自带 display 保持可见；动画结束（或兜底）由本函数摘除 */
  closingCls: string;
  /** 只认这个 keyframes 名的 animationend——子元素更早结束的退场动画会冒泡上来，
   *  不守卫名字会把长退场提前掐断 */
  anim: string;
  /** 退场开始（openCls 已摘、closingCls 已挂）：此刻释放滚动锁正合适 */
  onStart?: () => void;
  /** 收尾（closingCls 已被本函数摘除，幂等至多一次）：跟随动画结束的清理放这里 */
  onDone?: () => void;
}

/**
 * 退场动画：摘 openCls → 挂 closingCls → 等 animationend（或兜底定时器）→
 * 摘 closingCls → onDone()。返回 cancel()。
 * - reduced-motion / 元素不可用：瞬时路径——两个类都摘，onStart/onDone 同步触发；
 * - cancel() 只解绑回调、不动类名——「退场中重开」由调用方先 cancel 再自己摆正类名。
 */
export function animateExit(o: ExitOptions): () => void {
  const el = o.el;
  const instant = () => {
    if (el && el.classList) { el.classList.remove(o.openCls); el.classList.remove(o.closingCls); }
    o.onStart?.();
    o.onDone?.();
  };
  if (!el || !el.classList || !motionOK()) { instant(); return () => {}; }
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  function cleanup(): void {
    el.removeEventListener("animationend", onEnd);
    if (timer != null) { clearTimeout(timer); timer = null; }
  }
  function fin(): void {
    if (done) return;
    done = true;
    cleanup();
    el.classList.remove(o.closingCls);
    o.onDone?.();
  }
  function onEnd(ev: AnimationEvent): void {
    if (ev.animationName !== o.anim || ev.target !== el) return;
    fin();
  }
  el.addEventListener("animationend", onEnd);
  el.classList.remove(o.openCls);
  el.classList.add(o.closingCls);
  /* 兜底：动画总时长 + 80ms 余量（animationend 因元素复用/后台节流丢失时也能收尾） */
  timer = setTimeout(fin, animationTotalMs(el) + 80);
  o.onStart?.();
  return () => {
    if (done) return;
    done = true;
    cleanup();
  };
}
