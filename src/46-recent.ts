/* 46-recent.ts —— 最近查看的卡：跨会话的低摩擦记忆条。
   showDetail 打开卡牌时前插 id（去重、上限 12），数据就绪后 prune 掉失效 id
   （与 favs 同口径）。渲染是卡库页签顶部的一条小缩略横带，点击重开详情
   （data-goto 复用 90-detail 的全局委托）。不参与筛选逻辑，也不写地址栏。 */
import { STORAGE_KEYS, imgFull } from "./core/resources";
import { esc } from "./core/dom";
import { recordOfId } from "./data/records";

const MAX = 12;
let items: number[] = [];

export function loadRecentCards(): void {
  items = [];
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.recentCards) || "[]");
    if (Array.isArray(raw)) items = raw.filter(x => Number.isFinite(x)).map(Number).slice(0, MAX);
  } catch (e) { /* 损坏的本地存储按空处理（favs 同款降级） */ }
}
function save(): void {
  try { localStorage.setItem(STORAGE_KEYS.recentCards, JSON.stringify(items)); } catch (e) {}
}
/** 前插一条（去重）；不进池的 id 直接忽略。 */
export function pushRecentCard(id: number): void {
  id = Number(id);
  if (!Number.isFinite(id) || !recordOfId(id)) return;
  items = [id, ...items.filter(x => x !== id)].slice(0, MAX);
  save();
}
export const recentCards = (): number[] => [...items];
/** 数据就绪后清掉失效 id（池里已不存在的卡）。 */
export function pruneRecentCards(): void {
  const n = items.length;
  items = items.filter(id => recordOfId(id));
  if (items.length !== n) save();
}
/** 测试隔离用。 */
export function resetRecent(): void { items = []; }

/** 就地刷新卡库页签顶部的横带：已有节点替换，首次产生记录时补插到浏览视图顶部。 */
export function refreshRecentStrip(): void {
  const el = document.getElementById("recentStrip");
  if (el) { el.outerHTML = rcStripHtml(); return; }
  const host = document.getElementById("view-browse");
  if (host && !host.querySelector(".rc-strip")) host.insertAdjacentHTML("afterbegin", rcStripHtml());
}

/** 卡库页签顶部的小横带（无记录返回空串，不占位）。 */
export function rcStripHtml(): string {
  if (!items.length) return "";
  return `<div class="rc-strip" id="recentStrip"><span class="rc-title">最近查看</span>` +
    items.map(id => {
      const r = recordOfId(id);
      const name = r?.name || `#${id}`;
      return `<button class="rc-card" data-goto="${id}" title="${esc(name)}">` +
        `<img src="${imgFull(id)}" loading="lazy" decoding="async" alt="${esc(name)}"></button>`;
    }).join("") + `</div>`;
}
