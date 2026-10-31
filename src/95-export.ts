/* 95-export.ts —— 导出：JSON / CSV / 文本，字段形状是对外契约。 */
import { allReqs, costText } from "./30-deps";
import { recordOfId, shareOfId } from "./data/records";
import { $, copyText } from "./core/dom";
import { skillsOf, showSkillIdx } from "./47-skills";
import { showDeckDiff } from "./88-compare";
import { showOdds } from "./86-odds";
import { showHelp } from "./90-detail";
import { decodeRaw, encodeRaw } from "./10-codec";
import { state } from "./data/state";
import type { ExportCard, ExportChar } from "./types";
import { API, LANG, imgFull, tagZh } from "./core/resources";
import { toast } from "./core/dom";   /* copyText 已在上面与 $ 一并导入 */
import { registerLayer } from "./core/layers";

/* ---------- 导出：文本 / Markdown / 结构化 JSON / CSV ---------- */
function download(name, content, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function deckText() {
  const L = [`【角色】` + state.current!.chars.map(c => c.name).join(" / ")];
  for (const t of state.current!.order) {
    L.push(`【${t}】`);
    for (const x of state.current!.groups[t]) {
      const r = allReqs(x).length ? `〔${allReqs(x).map(r => r.short).join("·")}〕` : "";
      const en = x.energy ? ` 充能×${x.energy}` : "";
      L.push(`  ${x.count > 1 ? x.count + "× " : ""}${x.name}${en}${r}${x.related ? `（${x.related}）` : ""}`);
    }
  }
  L.push(`【分享码】${state.current!.code}`);
  return L.join("\n");
}
function deckMarkdown() {
  const L = [`# 七圣召唤牌组：${state.current!.chars.map(c => c.name).join(" / ")}`, "",
    `> 分享码：\`${state.current!.code}\`　导出时间：${new Date().toLocaleString("zh-CN")}`, ""];
  L.push(`## 角色`);
  for (const c of state.current!.chars) {
    const raw = recordOfId(c.id);
    const tags = (raw?.stats.tags || []).filter(Boolean).join("·");
    L.push(`- **${c.name}**（${tags}）　生命 ${c.hp} · 充能 ${c.energy} · ${c.since || ""}`);
  }
  for (const t of state.current!.order) {
    L.push("", `## ${t}`);
    L.push(`| 数量 | 名称 | 费用 | 依赖限制 | 关联角色 | 版本 | 效果 |`);
    L.push(`|---|---|---|---|---|---|---|`);
    for (const x of state.current!.groups[t]) {
      const r = allReqs(x).map(r => r.short).join("·") || "—";
      const d = (x.effect || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
      L.push(`| ${x.count} | ${x.name} | ${costText(x.playCost) || "—"} | ${r} | ${x.related || "—"} | ${x.since || "—"} | ${d} |`);
    }
  }
  return L.join("\n");
}
/* 导出是给外部消费的自由形状（文本 / JSON / CSV 共用），字段随需求增删，
   因此这里不逐个建模，只保证写入的是同一份数据。 */
function buildExport() {
  const cards: ExportCard[] = [];
  for (const t of state.current!.order) for (const x of state.current!.groups[t]) {
    const e = recordOfId(x.id);
    if (!e) continue;   /* 牌组里出现卡池缺记录的 id（数据版本不一致）时跳过，不让整份导出失败 */
    cards.push({
      id: x.id, shareId: shareOfId(x.id),
      name: x.name, typeRaw: e.typeRaw, type: x.type,
      tagsRaw: e.stats.tagsRaw, tags: x.tags,
      playCostRaw: e.stats.cost,
      diceCost: x.dice, energyCost: x.energy,
      relatedCharacterId: e.rel.relatedCharacterId ?? null, relatedCharacter: x.related ?? null,
      restrictions: x.restrictions,
      /* 牌组限制（加入牌组需满足的角色/元素/地区依赖）与打出限制分开导出 */
      deckRequirements: (x.deckReqs || []).map(r => ({
        code: r.code, short: r.short, label: r.label,
        tag: "tag" in r ? r.tag ?? null : null,
        characterId: "charId" in r ? r.charId ?? null : null,
        minCount: "n" in r ? r.n ?? null : null,
      })),
      count: x.count, sinceVersion: x.since,
      description: e.desc.effect.trim(),
      image: imgFull(x.id),
      category: t,
    });
  }
  const chars: ExportChar[] = state.current!.chars.map(c => {
    const raw = recordOfId(c.id);
    return {
      id: c.id, shareId: shareOfId(c.id),
      name: c.name, englishName: raw?.englishName || null,
      element: c.element, tagsRaw: raw?.stats.tagsRaw || [], tags: (raw?.stats.tags || []).filter(Boolean),
      hp: c.hp, maxEnergy: c.energy, sinceVersion: c.since,
      /* 技能与界面同源：准备技能 / 被动技能不再被 hidden 过滤掉，
         费用（元素骰 + 充能）一并导出，避免"界面上有、导出里没有" */
      skills: skillsOf(c.id).map(s => ({
        name: s.name, type: s.tag || null, typeZh: s.tagZh,
        cost: (s.cost as Array<{ type: string; count: number }>).map(pc => ({ type: pc.type, count: pc.count })),
        prepared: !!s.prepared, prepareTurns: s.prepareTurns || 0,
        description: s.effect || "",
      })),
      image: imgFull(c.id),
    };
  });
  const byType: Record<string, number> = {};
  const costCurve: Record<string, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, "5+": 0 };
  let energyTotal = 0;
  const versions = [...new Set(cards.map(x => x.sinceVersion).concat(chars.map(c => c.sinceVersion)))].filter(Boolean).sort();
  for (const x of cards) {
    byType[x.type] = (byType[x.type] || 0) + x.count;
    costCurve[Math.min(x.diceCost, 5) === 5 ? "5+" : x.diceCost] += x.count;
    energyTotal += x.energyCost * x.count;
  }
  return {
    format: "gi-deck-export", version: 1,
    exportedAt: new Date().toISOString(),
    source: `${API}/data/latest/${LANG}/{characters|entities}`,
    shareCode: state.current!.code,
    characters: chars,
    actionCards: cards,
    stats: {
      totalCards: cards.reduce((a, x) => a + x.count, 0),
      uniqueCards: cards.length,
      byType, costCurve, energyCostTotal: energyTotal,
      versionRange: versions.length ? [versions[0], versions[versions.length - 1]] : [],
    },
  };
}
function toCSV() {
  const q = v => `"${String(v ?? "").replace(/"/g, '""').replace(/\n/g, " ")}"`;
  const head = ["类别", "数量", "名称", "类型", "费用", "元素骰", "充能", "依赖限制", "关联角色", "标签", "版本", "分享ID", "卡牌ID", "效果"];
  const rows: string[] = [];
  for (const t of state.current!.order) for (const x of state.current!.groups[t]) {
    rows.push([t, x.count, x.name, x.type, costText(x.playCost), x.dice, x.energy,
      allReqs(x).map(r => r.label).join("；"), x.related || "", x.tags.join("·"), x.since || "",
      shareOfId(x.id) ?? "", x.id, x.effect].map(q).join(","));
  }
  return "\ufeff" + head.map(q).join(",") + "\n" + rows.join("\n");
}
function fileStamp() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `gi-deck-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* ---------- 导出菜单 / 更多菜单 ----------
   三个下拉互斥，共用一个层：Esc 只按一次就该把「当前打开的那个」关掉，
   而不是先关一个、再按一次关另一个。 */
const MENU_OF: Record<string, string> = { btnExport: "exportMenu", btnDeckTools: "deckToolsMenu", btnMore: "moreMenu" };
const MENU_IDS = Object.values(MENU_OF);
const menuEl = (id: string) => $(id);
const menusOpen = () => MENU_IDS.some(id => { const el = menuEl(id); return !!(el && el.classList && el.classList.contains("show")); });
const closeMenus = () => {
  for (const id of MENU_IDS) { const el = menuEl(id); if (el && el.classList) el.classList.remove("show"); }
};
registerLayer({ id: "topMenus", isOpen: menusOpen, close: closeMenus, order: 10 });

const openMenu = (btn: string) => {
  const menu = MENU_OF[btn];
  if (!menu) return;
  for (const id of MENU_IDS) if (id !== menu) $(id).classList.remove("show");
  $(menu).classList.toggle("show");
};
$("btnExport").addEventListener("click", ev => { ev.stopPropagation(); openMenu("btnExport"); });
$("btnDeckTools").addEventListener("click", ev => { ev.stopPropagation(); openMenu("btnDeckTools"); });
$("btnMore").addEventListener("click", ev => { ev.stopPropagation(); openMenu("btnMore"); });
document.addEventListener("click", ev => {
  if (!(ev.target as HTMLElement).closest(".expwrap")) closeMenus();
});
/* 页头「更多」菜单动作：全局功能，任何视图都可用 */
$("btnDataInfo").addEventListener("click", () => {
  const el = $("dataInfo");
  const show = el.style.display === "none";
  el.style.display = show ? "" : "none";
  $("btnDataInfo").textContent = show ? "隐藏数据信息" : "数据信息";
  closeMenus();
});
$("btnSkillIdx").addEventListener("click", () => { closeMenus(); showSkillIdx(); });
$("btnDeckDiff").addEventListener("click", () => { closeMenus(); showDeckDiff(); });
$("btnOdds").addEventListener("click", () => { closeMenus(); showOdds(); });
$("btnPrint").addEventListener("click", () => { closeMenus(); window.print(); });
$("btnHelp").addEventListener("click", () => { closeMenus(); showHelp(); });
$("exportMenu").addEventListener("click", ev => {
  const b = (ev.target as HTMLElement).closest("[data-exp]");
  if (!b) return;
  $("exportMenu").classList.remove("show");
  const act = b.dataset.exp;
  try {
    /* 复制是异步的：成功/失败都要有回音，不留 unhandled rejection */
    if (act === "text") { copyText(deckText()).then(() => toast("文本牌表已复制"), () => toast("复制失败", true)); }
    else if (act === "md") { copyText(deckMarkdown()).then(() => toast("Markdown 牌表已复制"), () => toast("复制失败", true)); }
    else if (act === "json-copy") { copyText(JSON.stringify(buildExport(), null, 2)).then(() => toast("结构化 JSON 已复制"), () => toast("复制失败", true)); }
    else if (act === "json-dl") { download(`${fileStamp()}.json`, JSON.stringify(buildExport(), null, 2), "application/json"); toast("JSON 已下载"); }
    else if (act === "csv") { download(`${fileStamp()}.csv`, toCSV(), "text/csv;charset=utf-8"); toast("CSV 已下载（Excel 可直开）"); }
  } catch (e) { toast("导出失败：" + (e as Error).message, true); }
});

/* ---------- 分享码 ---------- */
/* 按分享码原始顺序（而非分组顺序）重建，保证再编码逐字节还原 */
function encodeCurrent() {
  const ids = [...state.current!.charIds, ...state.current!.cardIds];
  const shareIds = ids.map(id => {
    const s = shareOfId(id);
    if (s == null) throw new Error(`卡牌 ${id} 不可分享`);
    return s;
  });
  const code = encodeRaw(shareIds);
  if (JSON.stringify(decodeRaw(code)) !== JSON.stringify(shareIds)) throw new Error("编码自校验失败");
  return code;
}
$("btnCopyCode").addEventListener("click", async () => {
  try {
    const code = encodeCurrent();
    /* copyText 自带 execCommand 兜底：file:// / 非安全上下文下 navigator.clipboard
       直接访问是 undefined → TypeError，报一个误导性的失败（兜底本可成功） */
    await copyText(code);
    toast("分享码已复制（已通过解码自校验）");
  } catch (e) { toast("生成失败：" + (e as Error).message, true); }
});

export { download, deckText, deckMarkdown, buildExport, toCSV, fileStamp, openMenu, encodeCurrent };
