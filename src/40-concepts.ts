/* 概念索引：名字 → 条目（悬浮提示 / 概念页下钻）。
 *
 * ========== 职责边界 ==========
 * 「一个名字该不该出现在概念索引里」「同名条目取哪一条」「谁排在前面」——
 * 这些判定全部在构建期完成（scripts/build-dataset.mjs 第 8.5 节，输出 dataset.terms）。
 * 本模块只做字段投影：把记录摊成展示用的 TermEntry，再把名字编译成正则词表。
 *
 * 为什么要把判定挪走：这些规则过去分散在这里（entryBetter 的取舍、KIND_GROUP 的
 * 归并、descMirrors 的编辑距离、EXTRA 与现网的合并顺序）以及检索模块
 * （mirrorCard 的过滤），同一张牌在不同界面可能得出不同结论，而且每加一类数据
 * 就要在四处同步。现在只有一处真源，改规则不用再追着界面跑。
 *
 * 运行时唯一保留的计算是正则词表的编译——那属于「把数据编译成扫描器」，
 * 不是数据判定。 */

import { dsByKey, dsReady, dsTerms } from "./07-dataset";
import { esc } from "./core/dom";
import type { GcgRecord, TermEntry } from "./types";

let termIndex = new Map<string, TermEntry[]>();
let termRe: RegExp | null = null;

/** 清空概念索引（供「刷新数据」使用）。索引的归属留在本模块。 */
export function resetConceptIndex(): void {
  termIndex = new Map();
  termRe = null;
}

/* 记录 → 展示条目。纯字段映射：收不收、取哪条、排第几都已由构建期确定。 */
function projectTerm(r: GcgRecord, kind: string): TermEntry {
  /* 下沉的规则：desc 只装可链接文本（效果 / 规则），角色简介进 story 字段——
     渲染端对 story 只转义不 linkify，检索端两个字段都扫（搜得到简介、链不了简介）。 */
  const entry: TermEntry = {
    src: r.source === "piovium" ? 0 : 1,
    kind,
    name: r.name,
    desc: r.desc.effect || r.desc.rules || "",
    story: r.desc.story || undefined,
    /* 牌面副本与同名身份都表示「检索不单列」：前者已不进概念索引，
       这里保留判断是为了让检索对 dupIdentity 条目也去重 */
    mirrorCard: r.flags.mirror || !!r.flags.dupIdentity,
    type: r.typeZh,
  };
  const idOf = (key: string): number | null => {
    const n = Number(key.slice(key.indexOf(":") + 1));
    return Number.isFinite(n) ? n : null;
  };
  if (kind === "card" || kind === "char") {
    /* 补充库条目接回同名身份后 kind 变成 card/char，但它自己的 key 是 term: 前缀，
       真实 id 在 rel.relatedCharacterKey 上——直接解析 key 会得到 null，跳转就失效了。 */
    entry.id = r.kind === "term"
      ? (r.rel.relatedCharacterKey ? idOf(r.rel.relatedCharacterKey) : null)
      : idOf(r.key);
    entry.artId = r.art.hasFace ? r.art.ref : null;
    entry.hp = r.stats.hp;
    entry.energy = r.stats.maxEnergy;
    entry.playCost = r.stats.cost;
  } else if (kind === "skill") {
    /* 技能没有可跳转的详情页，靠 key 打开技能页；牌面沿用所属角色/卡牌 */
    entry.key = r.key;
    entry.owner = r.rel.ownerName || "";
    entry.ownerKind = r.rel.ownerKind || "";
    entry.ownerId = r.rel.ownerKey ? idOf(r.rel.ownerKey) : null;
    entry.prepared = !!r.prepared;
    entry.prepareTurns = r.prepareTurns || 0;
    entry.artId = r.art.hasFace ? r.art.ref : null;
  } else {
    /* 术语 / 规则 / 状态等：补充库条目可能已接回同名身份，牌面照样可用 */
    entry.artId = r.art.hasFace ? r.art.ref : null;
    if (r.rel.relatedCharacterKey) entry.ownerId = idOf(r.rel.relatedCharacterKey);
  }
  return entry;
}

function buildTermIndex(): void {
  termIndex = new Map();
  termRe = null;
  if (!dsReady()) return;
  for (const group of dsTerms()) {
    const entries: TermEntry[] = [];
    for (const e of group.entries) {
      const r = dsByKey(e.key);
      if (r) entries.push(projectTerm(r, e.kind));
    }
    if (entries.length) termIndex.set(group.name, entries);
  }
  const names = [...termIndex.keys()].sort((a, b) => b.length - a.length).map(esc).map(escapeRe);
  termRe = names.length ? new RegExp("(" + names.join("|") + ")", "g") : null;
}

/* 取某名字的全部匹配概念（多个时悬浮/展开并列展示） */
function termEntries(name: string): TermEntry[] { return termIndex.get(name) || []; }
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* 输入已转义的文本，把术语标记为 .term 链接（单趟替换，无嵌套）。
   「」引号内为完整指称：若引号内容比命中的术语更长（如「幻戏倒计时」命中前缀"幻戏"），
   视为部分命中，不标记——避免把卡族名称误识别为机制关键词。 */
function linkify(escaped: string): string {
  if (!termRe) return escaped;
  return escaped.replace(termRe, (m: string, _p1: string, offset: number, str: string) => {
    if (str[offset - 1] === "「") {
      const close = str.indexOf("」", offset);
      if (close > offset && str.slice(offset, close) !== m) return m;
    }
    return `<span class="term" data-term="${m}">${m}</span>`;
  });
}

/* 同 linkify，但摘除 except 术语自身的链接——防止展开面板里点击自己导致面板被收起。
   注意必须"先链接化、后摘除"：若在链接化前做文本掩码，会把长名中的自身子串一并掩掉
   （如屏蔽"幻戏"会拆坏"幻戏倒计时：3"），导致长名概念丢失链接。 */
function linkifyExcept(escaped: string, except?: string | null): string {
  if (!termRe || !except) return linkify(escaped);
  const target = esc(except);
  const span = `<span class="term" data-term="${target}">${target}</span>`;
  return linkify(escaped).split(span).join(target);
}

export { termIndex, termRe, buildTermIndex, termEntries, escapeRe, linkify, linkifyExcept };
