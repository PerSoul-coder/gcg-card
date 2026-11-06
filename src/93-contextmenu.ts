/* 93-contextmenu —— 长按/右键/悬停的「策略层」：什么目标、出什么菜单。
 *
 * 引擎与呈现都已下沉：
 *   · core/gesture —— 长按计时、右键竞态、合成 click 吞咽、悬停能力判定，
 *     全平台一条状态机；这里只按选择器注册意图（93 是具体目标，先注册先赢）。
 *   · core/menu —— 菜单组件（子级飞出、键盘导航、四边钳制），吃纯数据规格。
 *
 * 策略：概念链接（.term）不走菜单——长按/右键/悬停三者同出悬浮预览（showTipAt
 * 单路），「右键与触屏长按同等对待」的基准线。实体目标出菜单，根层保持
 * 一屏可扫（≤7 项），同族操作收进子级（牌组 ▸ / 分享 ▸）。
 *
 * 非托管目标不拦右键：浏览器原生的图片/文本菜单原样保留。 */

import { recordOfId } from "./data/records";
import type { CtxItem, CtxMenu } from "./types";
import { showDetail, openTermName, hideTip, showTipAt, canHover } from "./90-detail";
import { toggleCompare, syncCompareUI, compareState } from "./88-compare";
import { toggleFav, isFav } from "./45-pool";
import {
  decks, activeDeckId, draftAdd, toggleCore, isCore, setActiveDeckById,
  beginRenameDeck, beginEditNote, duplicateDeck, deleteDeckById,
} from "./80-deck";
import { renderCardShareCanvas } from "./96-share";
import { download, fileStamp } from "./95-export";
import { toast, copyText } from "./core/dom";
import { openMenuAt } from "./core/menu";
import { bindGestures } from "./core/gesture";

/* ---------- 菜单规格：目标 → 纯数据 ---------- */

/* 卡池条目（卡库瓦片 / 列表行 / 详情里的关联跳转）。
   根层 5 项一屏可扫；「构筑」与「对外分享」两族分别收进子级。 */
function poolMenu(id: number): CtxMenu | null {
  const rec = recordOfId(id);
  if (!rec || !rec.name) return null;
  const deckChildren: CtxItem[] = [];
  if (rec.share != null && rec.flags.deckable) deckChildren.push({ label: "加入牌组", run: () => draftAdd(id) });
  deckChildren.push({
    label: isCore(id) ? "取消核心牌" : "设为核心牌",
    checked: isCore(id),
    run: () => { toggleCore(id); },
  });
  const items: CtxItem[] = [
    { label: "查看详情", run: () => showDetail(id) },
    {
      label: compareState.ids.includes(id) ? "移出对比" : "加入对比",
      checked: compareState.ids.includes(id),
      run: () => { toggleCompare(id); syncCompareUI(); },
    },
    {
      label: isFav(id) ? "取消收藏" : "收藏",
      checked: isFav(id),
      run: () => { toggleFav(id); },
    },
    { label: "牌组", children: deckChildren },
    {
      label: "分享",
      children: [
        { label: "复制该卡链接", run: () => {
          copyText(location.href.split("#")[0] + "#card=" + id)
            .then(() => toast("链接已复制（打开即显示该卡详情）"), () => toast("复制失败", true));
        } },
        { label: "单卡分享图（PNG）", run: () => {
          toast("正在生成单卡分享图…");
          void (async () => {
            const canvas = await renderCardShareCanvas(rec, { href: location.href });
            const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/png"));
            if (!blob) throw new Error("canvas 导出失败");
            download(`gi-card-${fileStamp().replace("gi-deck-", "")}.png`, blob, "image/png");
            toast("单卡分享图已下载");
          })().catch(e => toast("单卡分享图生成失败：" + (e as Error).message, true));
        } },
      ],
    },
  ];
  return { title: rec.name, items };
}

/* 牌组列表行：平铺即可（本就只有 5 项），删除保持顶级危险色可见 */
function deckRowMenu(id: number): CtxMenu | null {
  const d = decks.find(x => x.id === id);
  if (!d) return null;
  const items: CtxItem[] = [];
  if (id !== activeDeckId) items.push({ label: "设为当前牌组", run: () => setActiveDeckById(id) });
  items.push({ label: "重命名", run: () => beginRenameDeck(id) });
  items.push({ label: "备注", hint: "对局思路 / 起手要素", run: () => beginEditNote(id) });
  items.push({ label: "创建副本", run: () => { if (duplicateDeck(id)) toast("已复制为新牌组"); } });
  if (decks.length > 1) items.push({ sep: true, label: "" }, { label: "删除", danger: true, run: () => { deleteDeckById(id); toast("牌组已删除"); } });
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

/* 开菜单前收掉可能残留的概念预览（tip 无指针事件，不会自己消失） */
function openSpec(x: number, y: number, m: CtxMenu | null): void {
  if (!m) return;
  hideTip();
  openMenuAt(x, y, m);
}

const openPoolMenu = (x: number, y: number, el: HTMLElement): void => {
  openSpec(x, y, poolMenu(Number(el.dataset.id ?? el.dataset.goto)));
};

/* ---------- 注册（顺序即优先级：具体目标在前，先注册先赢） ---------- */

/* 概念链接：悬停 = 长按 = 右键 = 同一份悬浮预览（showTipAt 单路）。
   引擎只在 hover-capable 设备派发 hover；无 hover 能力时不进此回调，
   触屏的预览由长按与点击后的概念页承担。 */
bindGestures(".term[data-term]", {
  hover: ctx => { if (!canHover()) { hideTip(); return; } showTipAt(String((ctx.el as HTMLElement).dataset.term), ctx.x, ctx.y); },
  hoverend: () => hideTip(),
  longpress: ctx => { hideTip(); showTipAt(String((ctx.el as HTMLElement).dataset.term), ctx.x, ctx.y); },
  contextmenu: ctx => { hideTip(); showTipAt(String((ctx.el as HTMLElement).dataset.term), ctx.x, ctx.y); },
});

/* 概念瓦片 */
bindGestures(".tile.stile[data-term]", {
  longpress: ctx => openSpec(ctx.x, ctx.y, conceptTileMenu(String((ctx.el as HTMLElement).dataset.term))),
  contextmenu: ctx => openSpec(ctx.x, ctx.y, conceptTileMenu(String((ctx.el as HTMLElement).dataset.term))),
});

/* 牌组列表行（按钮/输入框上是行内操作，行身才是菜单目标） */
bindGestures("[data-deck]", {
  longpress: ctx => {
    const row = ctx.el.closest("[data-deck]") as HTMLElement | null;
    if (!row || (ctx.event.target as HTMLElement).closest("button,input")) return;
    openSpec(ctx.x, ctx.y, deckRowMenu(Number(row.dataset.deck)));
  },
  contextmenu: ctx => {
    const row = ctx.el.closest("[data-deck]") as HTMLElement | null;
    if (!row || (ctx.event.target as HTMLElement).closest("button,input")) return;
    openSpec(ctx.x, ctx.y, deckRowMenu(Number(row.dataset.deck)));
  },
});

/* 详情内的关联跳转（被引用 / 天赋 / 关联角色 chips） */
bindGestures("[data-goto]", {
  longpress: ctx => { const el = ctx.el.closest("[data-goto]") as HTMLElement | null; if (el) openPoolMenu(ctx.x, ctx.y, el); },
  contextmenu: ctx => { const el = ctx.el.closest("[data-goto]") as HTMLElement | null; if (el) openPoolMenu(ctx.x, ctx.y, el); },
});

/* 卡池条目（瓦片 / 列表行） */
bindGestures("[data-id]", {
  longpress: ctx => { const el = ctx.el.closest("[data-id]") as HTMLElement | null; if (el) openPoolMenu(ctx.x, ctx.y, el); },
  contextmenu: ctx => { const el = ctx.el.closest("[data-id]") as HTMLElement | null; if (el) openPoolMenu(ctx.x, ctx.y, el); },
});
