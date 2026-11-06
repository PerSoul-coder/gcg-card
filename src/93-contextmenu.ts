/* 93-contextmenu —— 长按（触屏）与右键（鼠标）的统一上下文菜单。
 *
 * 一个注册表 + 一个触发器，两种指针汇入同一套操作：
 *   · 触发器 —— pointerdown 起 480ms 长按计时（触屏），contextmenu 事件（鼠标
 *     右键；Android 长按也走这里）。谁先到谁开，另一方闭嘴（见下）。
 *   · 目标注册表 —— hitOf(el) 认领目标并给出菜单（纯数据）或「概念预览」。
 *     扩展操作 = 注册表加一个分支，分发逻辑不动。
 *
 * 概念链接（.term）不走菜单：长按 / 右键 = 悬浮预览，与桌面 hover 同一条
 * showTipAt 路径——「逻辑上与触屏长按同等对待」的就是它。
 *
 * 与原生生态的相处：
 *   · Android 长按会先触发原生 contextmenu → preventDefault + 自己开菜单，
 *     同时取消 480ms 计时器；若计时器先到，contextmenu 只压原生不再开一次。
 *   · iOS Safari（<16 不发 contextmenu）靠计时器开菜单；
 *     -webkit-touch-callout:none（CSS）压掉系统的「存储图像」呼出。
 *   · 长按开菜单后 700ms 内的合成 click 被吞掉一次，避免菜单在指尖下被误点。
 *   · 非托管目标不拦截 contextmenu：浏览器原生的图片/文本菜单原样保留。 */

import { recordOfId } from "./data/records";
import type { CtxItem, CtxMenu } from "./types";
import { showDetail, openTermName, hideTip, showTipAt } from "./90-detail";
import { toggleCompare, syncCompareUI, compareState } from "./88-compare";
import { toggleFav, isFav } from "./45-pool";
import {
  decks, activeDeckId, draftAdd, toggleCore, isCore, setActiveDeckById,
  beginRenameDeck, beginEditNote, duplicateDeck, deleteDeckById,
} from "./80-deck";
import { renderCardShareCanvas } from "./96-share";
import { download, fileStamp } from "./95-export";
import { toast, copyText, esc } from "./core/dom";

/* ---------- 菜单壳：构建 / 定位 / 关闭 ---------- */

let menuEl: HTMLElement | null = null;
let current: CtxMenu | null = null;
let openedAt = 0;

export function closeCtxMenu(): void {
  if (menuEl) { menuEl.remove(); menuEl = null; current = null; }
}

export function openCtxMenu(x: number, y: number, menu: CtxMenu): void {
  closeCtxMenu();
  current = menu;
  const el = document.createElement("div");
  el.id = "ctxmenu";
  let vi = 0;   /* 可点条目在 items 里的下标（分隔线不占） */
  el.innerHTML = (menu.title ? `<div class="ctx-title">${esc(menu.title)}</div>` : "") +
    menu.items.map(it =>
      it.sep ? `<div class="ctx-sep"></div>`
             : `<button data-ci="${vi++}"${it.danger ? ` class="danger"` : ""}>${esc(it.label)}</button>`).join("");
  el.addEventListener("click", ev => {
    const b = (ev.target as HTMLElement).closest("[data-ci]") as HTMLElement | null;
    if (!b) return;
    const it = current && current.items[Number(b.dataset.ci)];
    closeCtxMenu();
    if (it && it.run) it.run();
  });
  document.body.appendChild(el);
  menuEl = el;
  openedAt = Date.now();
  /* 四边钳制：光标/指尖处放不下就往回锚，绝不超出视口。
     视口尺寸走 window（测试注入的 window 可能是空对象 → 兜底值），不用裸全局 */
  const vw = Number(window && window.innerWidth) || 375;
  const vh = Number(window && window.innerHeight) || 667;
  const r = el.getBoundingClientRect();
  const rw = Number(r && r.width) || 220, rh = Number(r && r.height) || 160;
  let lx = x, ly = y;
  if (lx + rw > vw - 8) lx = x - rw;
  if (ly + rh > vh - 8) ly = y - rh;
  el.style.left = Math.max(8, lx) + "px";
  el.style.top = Math.max(8, ly) + "px";
}

/* ---------- 菜单内容：目标 → 纯数据 ---------- */

/* 卡池条目（卡库瓦片 / 列表行 / 详情里的关联跳转）：一套通用操作 */
function poolMenu(id: number): CtxMenu | null {
  const rec = recordOfId(id);
  if (!rec || !rec.name) return null;
  const items: CtxItem[] = [];
  items.push({ label: "查看详情", run: () => showDetail(id) });
  items.push({
    label: compareState.ids.includes(id) ? "移出对比" : "加入对比",
    run: () => { toggleCompare(id); syncCompareUI(); },
  });
  if (rec.share != null && rec.flags.deckable) items.push({ label: "加入牌组", run: () => draftAdd(id) });
  items.push({ label: isCore(id) ? "取消核心牌" : "设为核心牌", run: () => { toggleCore(id); } });
  items.push({ label: isFav(id) ? "取消收藏" : "收藏", run: () => { toggleFav(id); } });
  items.push({ sep: true, label: "" });
  items.push({ label: "复制该卡链接", run: () => {
    copyText(location.href.split("#")[0] + "#card=" + id)
      .then(() => toast("链接已复制（打开即显示该卡详情）"), () => toast("复制失败", true));
  } });
  items.push({ label: "单卡分享图（PNG）", run: () => {
    toast("正在生成单卡分享图…");
    void (async () => {
      const canvas = await renderCardShareCanvas(rec, { href: location.href });
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("canvas 导出失败");
      download(`gi-card-${fileStamp().replace("gi-deck-", "")}.png`, blob, "image/png");
      toast("单卡分享图已下载");
    })().catch(e => toast("单卡分享图生成失败：" + (e as Error).message, true));
  } });
  return { title: rec.name, items };
}

/* 牌组列表行：管理面板里那些按钮的直达入口 */
function deckRowMenu(id: number): CtxMenu | null {
  const d = decks.find(x => x.id === id);
  if (!d) return null;
  const items: CtxItem[] = [];
  if (id !== activeDeckId) items.push({ label: "设为当前牌组", run: () => setActiveDeckById(id) });
  items.push({ label: "重命名", run: () => beginRenameDeck(id) });
  items.push({ label: "备注（对局思路 / 起手要素）", run: () => beginEditNote(id) });
  items.push({ label: "创建副本", run: () => { if (duplicateDeck(id)) toast("已复制为新牌组"); } });
  if (decks.length > 1) items.push({ label: "删除", danger: true, run: () => { deleteDeckById(id); toast("牌组已删除"); } });
  return { title: d.name, items };
}

/* 概念瓦片（检索结果里的概念卡）：与点击同路，外加复制名称 */
function conceptTileMenu(name: string): CtxMenu | null {
  if (!name) return null;
  return { title: name, items: [
    { label: "查看概念页", run: () => openTermName(name) },
    { label: "复制名称", run: () => copyText(name).then(() => toast("已复制"), () => toast("复制失败", true)) },
  ] };
}

/* 目标认领：从事件目标向上找最近的托管元素。顺序即优先级——
   内联概念链接最具体，其次是概念瓦片、牌组行、池条目。 */
function hitOf(target: EventTarget | null): CtxMenu | { preview: string } | null {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return null;
  const term = el.closest(".term[data-term]") as HTMLElement | null;
  if (term && term.dataset.term) return { preview: term.dataset.term };
  const stile = el.closest(".tile.stile[data-term]") as HTMLElement | null;
  if (stile) return conceptTileMenu(stile.dataset.term || "");
  const row = el.closest("[data-deck]");
  if (row && !el.closest("button") && !el.closest("input")) return deckRowMenu(Number((row as HTMLElement).dataset.deck));
  const goto = el.closest("[data-goto]") as HTMLElement | null;
  if (goto) return poolMenu(Number(goto.dataset.goto));
  const pool = el.closest("[data-id]") as HTMLElement | null;
  if (pool) return poolMenu(Number(pool.dataset.id));
  return null;
}

/* ---------- 触发器 ---------- */

const LONG_MS = 480, MOVE_PX = 12;
let timer = 0, startX = 0, startY = 0, lastTouch = 0, swallowUntil = 0;

/* 鼠标右键（+Android 长按的原生 contextmenu） */
document.addEventListener("contextmenu", ev => {
  const hit = hitOf(ev.target);
  if (!hit) return;                       /* 非托管目标：原生右键原样保留 */
  ev.preventDefault();
  if (Date.now() - openedAt < 600) return; /* 长按已开过：只压原生，不开第二次 */
  if (timer) { clearTimeout(timer); timer = 0; }  /* Android：contextmenu 先到，取消计时器 */
  if ("preview" in hit) { hideTip(); showTipAt(hit.preview, ev.clientX, ev.clientY); return; }
  openCtxMenu(ev.clientX, ev.clientY, hit);
});

/* 触屏长按：按住不动 480ms 触发；移动 / 抬起 / 滚动 / 系统打断即取消 */
document.addEventListener("pointerdown", ev => {
  if (ev.pointerType === "touch") lastTouch = Date.now();
  const hit = hitOf(ev.target);
  if (!hit) return;
  startX = ev.clientX; startY = ev.clientY;
  if (timer) clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = 0;
    if (Date.now() - lastTouch > 2000) return;   /* 陈旧计时：指针会话早已结束 */
    try { navigator.vibrate && navigator.vibrate(12); } catch (e) {}
    if ("preview" in hit) { hideTip(); showTipAt(hit.preview, startX, startY); }
    else openCtxMenu(startX, startY, hit);
    swallowUntil = Date.now() + 700;             /* 吞掉随后的合成 click */
  }, LONG_MS);
}, true);
document.addEventListener("pointermove", ev => {
  if (!timer) return;
  if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_PX) { clearTimeout(timer); timer = 0; }
}, true);
document.addEventListener("pointerup", () => { if (timer) { clearTimeout(timer); timer = 0; } }, true);
document.addEventListener("pointercancel", () => { if (timer) { clearTimeout(timer); timer = 0; } }, true);

/* 长按后的合成 click 会落在菜单/瓦片上：窗口期内吞掉一次，防误触 */
document.addEventListener("click", ev => {
  if (Date.now() < swallowUntil) { ev.preventDefault(); ev.stopPropagation(); }
}, true);

/* 打开期间：点外面 / 滚动 / 改变窗口 / 路由变化 → 收起；Esc 抢在弹层返回之前 */
document.addEventListener("pointerdown", ev => {
  if (menuEl && ev.target instanceof Node && !menuEl.contains(ev.target)) closeCtxMenu();
}, true);
document.addEventListener("scroll", () => {
  if (timer) { clearTimeout(timer); timer = 0; }
  closeCtxMenu();
}, true);
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("resize", closeCtxMenu);
  window.addEventListener("hashchange", closeCtxMenu);
}
document.addEventListener("keydown", ev => {
  if (!menuEl || ev.key !== "Escape") return;
  ev.preventDefault(); ev.stopPropagation();
  closeCtxMenu();
}, true);
