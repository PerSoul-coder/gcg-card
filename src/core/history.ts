/* 弹层栈 ↔ 浏览器历史桥。
 *
 * detail / term / skill 三类「可回退层」在打开时写入一条历史记录（#card= / #t= / #s=），
 * 浏览器返回键因此可以逐层关弹层、前进键重开——与用户对「后退」的直觉一致。
 * compare / odds / deckdiff 不是可回退层：它们不写历史，但整栈替换时会清掉
 * 已写的记录（overlayHashClear），保证 hash 与弹层栈一致。
 *
 * pushDepth 记录当前链上自己推了多少条：UI 关闭据此决定是 history.back()
 * （让 popstate 统一做差量同步）还是直接弹栈。测试环境没有 history.back /
 * window.addEventListener，此时一切退化为旧的即时行为——生产语义不变。 */

let pushDepth = 0;

/* history 的方法在测试 stub 里可能缺失，逐个做「存在才调用」的防护取用 */
type HistoryFn = ((...args: never[]) => void) | null;
function histFn<K extends "pushState" | "replaceState" | "back" | "go">(k: K): HistoryFn {
  try {
    const f = (history as unknown as Record<string, unknown>)[k];
    return typeof f === "function" ? (f as (...a: never[]) => void).bind(history) : null;
  } catch (e) { return null; }
}
const hasWindowListeners = (): boolean =>
  typeof window !== "undefined" && typeof window.addEventListener === "function";

/** 可回退层对应的历史 hash（不含 #）。不可回退层 / 空栈返回 null。 */
export function overlayHashOf(view: { kind: string; id?: number; name?: string; key?: string } | null | undefined): string | null {
  if (!view) return null;
  if (view.kind === "detail") return "card=" + view.id;
  if (view.kind === "term") return "t=" + encodeURIComponent(String(view.name ?? ""));
  if (view.kind === "skill") return "s=" + String(view.key ?? "");
  return null;
}

/** 解析 hash 指向的可回退层；不指向任何层时返回 null。入参是未解码的 hash 片段。 */
export function overlayHashParse(h: string):
  { kind: "detail"; id: number } | { kind: "term"; name: string } | { kind: "skill"; key: string } | null {
  if (h.startsWith("card=")) {
    const id = Number(h.slice(5));
    return Number.isFinite(id) && id > 0 ? { kind: "detail", id } : null;
  }
  if (h.startsWith("t=")) return { kind: "term", name: h.slice(2) };
  if (h.startsWith("s=")) return { kind: "skill", key: h.slice(2) };
  return null;
}

export const overlayPushDepth = (): number => pushDepth;

/** 打开可回退层时追加一条历史。前进重开（fromHistory）不调用——那条记录已经存在。 */
export function overlayHashPush(hash: string): void {
  pushDepth++;
  const push = histFn("pushState");
  if (push) { try { push({ gi: pushDepth } as never, "" as never, ("#" + hash) as never); } catch (e) {} }
}

/** 详情翻页等原地换内容：替换当前条目的 hash，不新增历史。 */
export function overlayHashReplace(hash: string): void {
  const rep = histFn("replaceState");
  if (rep) { try { rep({ gi: pushDepth } as never, "" as never, ("#" + hash) as never); } catch (e) {} }
}

/** UI 的「退一层」：委托给历史（popstate 里做真正的弹栈与渲染）。委托不了返回 false。 */
export function overlayHashBack(): boolean {
  if (pushDepth > 0 && hasWindowListeners()) {
    const back = histFn("back");
    if (back) { back(); return true; }
  }
  return false;
}

/** UI 的「全部关闭」：一次吞掉自己推过的整链（单个 popstate 完成同步）。 */
export function overlayHashCloseAll(): boolean {
  if (pushDepth > 0 && hasWindowListeners()) {
    const go = histFn("go");
    if (go) { go(-pushDepth as never); return true; }
  }
  return false;
}

/** popstate 完成一次弹栈后的记账。 */
export const overlayHashPop = (): void => { if (pushDepth > 0) pushDepth--; };

/** 前进重开：把「已存在的历史条目」重新认领回来（pushDepth 与真实深度保持一致）。 */
export const overlayHashAdopt = (): void => { pushDepth++; };

/** 整链作废（odds / deckdiff / 帮助等清栈动作）：计数归零；hash 若指向弹层则抹掉。 */
export function overlayHashClear(): void {
  pushDepth = 0;
  if (typeof location === "undefined") return;
  const h = location.hash.replace(/^#/, "");
  if (/^(card=|t=|s=)/.test(h)) {
    const rep = histFn("replaceState");
    if (rep) { try { rep(null as never, "" as never, (location.pathname + location.search) as never); } catch (e) {} }
  }
}
