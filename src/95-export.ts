/* src/95-export.js —— 由 scripts/_convert.mjs 从旧脚本转换（迁移中间态）。 */
import { allReqs, costText, diceCost, energyCost } from "./30-deps";
import { $ } from "./core/dom";
import { skillsOf } from "./47-skills";
import { showDeckDiff } from "./88-compare";
import { showOdds } from "./86-odds";
import { showHelp } from "./90-detail";
import { decodeRaw, encodeRaw } from "./10-codec";
import { state } from "./data/state";
import { API, LANG, imgFull, tagZh } from "./core/resources";
import { toast, copyText } from "./core/dom";

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
    const raw = state.charById.get(c.id);
    const tags = (raw?.tags || []).map(tagZh).filter(Boolean).join("·");
    L.push(`- **${c.name}**（${tags}）　生命 ${c.hp} · 充能 ${c.energy} · ${c.since || ""}`);
  }
  for (const t of state.current!.order) {
    L.push("", `## ${t}`);
    L.push(`| 数量 | 名称 | 费用 | 依赖限制 | 关联角色 | 版本 | 效果 |`);
    L.push(`|---|---|---|---|---|---|---|`);
    for (const x of state.current!.groups[t]) {
      const r = allReqs(x).map(r => r.short).join("·") || "—";
      const d = (x.desc || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
      L.push(`| ${x.count} | ${x.name} | ${costText(x.playCost) || "—"} | ${r} | ${x.related || "—"} | ${x.since || "—"} | ${d} |`);
    }
  }
  return L.join("\n");
}
function buildExport() {
  const cards = [];
  for (const t of state.current!.order) for (const x of state.current!.groups[t]) {
    const e = state.entById.get(x.id);
    cards.push({
      id: x.id, shareId: state.idToShare[x.id] ?? null,
      name: x.name, typeRaw: e.type, type: x.type,
      tagsRaw: e.tags, tags: x.tags,
      playCostRaw: e.playCost,
      diceCost: x.dice, energyCost: x.energy,
      relatedCharacterId: e.relatedCharacterId ?? null, relatedCharacter: x.related,
      restrictions: x.restrictions,
      /* 牌组限制（加入牌组需满足的角色/元素/地区依赖）与打出限制分开导出 */
      deckRequirements: (x.deckReqs || []).map(r => ({ code: r.code, short: r.short, label: r.label, tag: r.tag || null, characterId: r.charId ?? null, minCount: r.n ?? null })),
      count: x.count, sinceVersion: x.since,
      description: (e.description || "").trim(),
      image: imgFull(x.id),
      category: t,
    });
  }
  const chars = state.current!.chars.map(c => {
    const raw = state.charById.get(c.id);
    return {
      id: c.id, shareId: state.idToShare[c.id] ?? null,
      name: c.name, englishName: raw?.englishName || null,
      element: c.element, tagsRaw: raw?.tags || [], tags: (raw?.tags || []).map(tagZh).filter(Boolean),
      hp: c.hp, maxEnergy: c.energy, sinceVersion: c.since,
      /* 技能与界面同源：准备技能 / 被动技能不再被 hidden 过滤掉，
         费用（元素骰 + 充能）一并导出，避免"界面上有、导出里没有" */
      skills: skillsOf(c.id).map(s => ({
        name: s.name, type: s.type || s.tag || null, typeZh: s.tagZh,
        cost: s.cost.map(pc => ({ type: pc.type, count: pc.count })),
        prepared: !!s.prepared, prepareTurns: s.prepareTurns || 0,
        description: s.effect || s.desc || "",
      })),
      image: imgFull(c.id),
    };
  });
  const byType = {}, costCurve = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, "5+": 0 };
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
  const rows = [];
  for (const t of state.current!.order) for (const x of state.current!.groups[t]) {
    rows.push([t, x.count, x.name, x.type, costText(x.playCost), x.dice, x.energy,
      allReqs(x).map(r => r.label).join("；"), x.related || "", x.tags.join("·"), x.since || "",
      state.idToShare[x.id] ?? "", x.id, x.desc].map(q).join(","));
  }
  return "\ufeff" + head.map(q).join(",") + "\n" + rows.join("\n");
}
function fileStamp() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `gi-deck-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* ---------- 导出菜单 / 更多菜单 ---------- */
const openMenu = btn => {
  const menu = btn === "btnExport" ? "exportMenu" : "moreMenu";
  const other = menu === "exportMenu" ? "moreMenu" : "exportMenu";
  $(other).classList.remove("show");
  $(menu).classList.toggle("show");
};
$("btnExport").addEventListener("click", ev => { ev.stopPropagation(); openMenu("btnExport"); });
$("btnMore").addEventListener("click", ev => { ev.stopPropagation(); openMenu("btnMore"); });
document.addEventListener("click", ev => {
  if (!(ev.target as HTMLElement).closest(".expwrap")) { $("exportMenu").classList.remove("show"); $("moreMenu").classList.remove("show"); }
});
/* 更多菜单动作 */
$("btnDataInfo").addEventListener("click", () => {
  const el = $("dataInfo");
  const show = el.style.display === "none";
  el.style.display = show ? "" : "none";
  $("btnDataInfo").textContent = show ? "隐藏数据信息" : "数据信息";
  $("moreMenu").classList.remove("show");
});
$("btnDeckDiff").addEventListener("click", () => { $("moreMenu").classList.remove("show"); showDeckDiff(); });
$("btnOdds").addEventListener("click", () => { $("moreMenu").classList.remove("show"); showOdds(); });
$("btnHelp").addEventListener("click", () => { $("moreMenu").classList.remove("show"); showHelp(); });
$("exportMenu").addEventListener("click", ev => {
  const b = (ev.target as HTMLElement).closest("[data-exp]");
  if (!b) return;
  $("exportMenu").classList.remove("show");
  const act = b.dataset.exp;
  try {
    if (act === "text") { copyText(deckText()); toast("文本牌表已复制"); }
    else if (act === "md") { copyText(deckMarkdown()); toast("Markdown 牌表已复制"); }
    else if (act === "json-copy") { copyText(JSON.stringify(buildExport(), null, 2)); toast("结构化 JSON 已复制"); }
    else if (act === "json-dl") { download(`${fileStamp()}.json`, JSON.stringify(buildExport(), null, 2), "application/json"); toast("JSON 已下载"); }
    else if (act === "csv") { download(`${fileStamp()}.csv`, toCSV(), "text/csv;charset=utf-8"); toast("CSV 已下载（Excel 可直开）"); }
  } catch (e) { toast("导出失败：" + e.message, true); }
});

/* ---------- 分享码 ---------- */
/* 按分享码原始顺序（而非分组顺序）重建，保证再编码逐字节还原 */
function encodeCurrent() {
  const ids = [...state.current!.charIds, ...state.current!.cardIds];
  const shareIds = ids.map(id => {
    const s = state.idToShare[id];
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
    await navigator.clipboard.writeText(code);
    toast("分享码已复制（已通过解码自校验）");
  } catch (e) { toast("生成失败：" + e.message, true); }
});

export { download, deckText, deckMarkdown, buildExport, toCSV, fileStamp, openMenu, encodeCurrent };
