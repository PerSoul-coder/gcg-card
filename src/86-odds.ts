/* 86-odds.ts —— 抽牌概率：超几何精确值 + 官方规则回合模拟。 */
import { dataReady, ensureData } from "./20-data";
import { $ } from "./core/dom";
import { renderOverlay, topView } from "./90-detail";
import { state } from "./data/state";
import type { CostEntry, ParsedCard } from "./types";
import { esc, setStatus, toast } from "./core/dom";
import { costText } from "./30-deps";
import { navBar } from "./90-detail";
import { overlayHashClear } from "./core/history";

/* ---------- 抽牌概率模型 ----------
   行动牌是 30 张的无放回抽样池。基础分布是超几何：
     P(至少 need 张) = 1 - Σ_{i<need} C(K,i)·C(N-K,n-i) / C(N,n)
   N = 行动牌总数，K = 关键牌张数，n = 已看到的牌数。
   在此之上按官方规则建模两件事：
   · 调度换牌：起手摸 5 后可把任意张放回牌组底再摸回同张数。概率表采用
     「最大化关键牌到手」的策略假设——起手没有关键牌就把 5 张全部换掉再摸
     5 张；换下的牌压在牌组底，之后的摸牌在摸穿上部之前碰不到它们。
     于是每个观察点是两种局面的精确混合（各自都是标准超几何）：
     A = 起手就有（不触发全换）：手牌含位置 1..(5+2t) 的关键牌；
     ¬A = 起手没有（全换 5 再摸 5）：手牌含位置 6..(10+2t) 的关键牌。
   · 秘传必在起始手牌：整套限 1 张且起手必带 → 到手率恒 100%。
   之后每回合抽 2 张；不含额外抽牌效果。 */
const DRAW_START = 5;
const DRAW_PER_TURN = 2;
const ODDS_TURNS = [0, 1, 2, 3, 4];

function comb(n, k) {
  if (k < 0 || n < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
  return r;
}
function hyperAtLeast(N, K, n, need = 1) {
  if (need <= 0) return 1;
  if (K < need) return 0;
  n = Math.max(0, Math.min(n, N));
  const total = comb(N, n);
  if (!total) return 0;
  let miss = 0;
  for (let i = 0; i < need; i++) miss += comb(K, i) * comb(N - K, n - i);
  return Math.max(0, Math.min(1, 1 - miss / total));
}
function fmtPct(p: number): string {
  return p >= 0.9995 ? "100%" : (p * 100).toFixed(1) + "%";
}

interface OddsStats { total: number; byCost: number[]; byType: Record<string, number>; uniq: ParsedCard[]; avg: number }
interface OddsRow { label: string; n: number; atLeast1: number; atLeast2: number | null; expect: number }
/* 当前牌组的抽牌池统计：行动牌总数、费用分布、类型分布、去重后的卡牌列表 */
function oddsDeckStats(): OddsStats {
  const byCost: number[] = Array(6).fill(0), byType: Record<string, number> = {}, uniq: ParsedCard[] = [];
  let total = 0, diceTotal = 0;
  if (state.current) {
    for (const t of state.current!.order) for (const x of state.current!.groups[t]) {
      total += x.count;
      diceTotal += x.dice * x.count;
      byCost[Math.min(x.dice, 5)] += x.count;
      byType[t] = (byType[t] || 0) + x.count;
      uniq.push(x);
    }
  }
  return { total, byCost, byType, uniq, avg: total ? diceTotal / total : 0 };
}
/* 每个观察点（起手 / 第 1~4 回合后 / 全牌组）的至少 1 张、至少 2 张与期望张数。
   legend=true：秘传牌，起手必带 → 到手率恒 100%、期望恒 1。否则按「起手未中则
   全换 5 张」的调度策略混合两种超几何局面（见上方模型注释）。 */
function oddsRows(N: number, K: number, legend = false): OddsRow[] {
  const out: OddsRow[] = [];
  if (legend) {
    for (const t of ODDS_TURNS) {
      out.push({ label: t === 0 ? `起手 ${DRAW_START} 张` : `第 ${t} 回合后`, n: DRAW_START + t * DRAW_PER_TURN, atLeast1: 1, atLeast2: null, expect: 1 });
    }
    out.push({ label: `全牌组 ${N} 张`, n: N, atLeast1: 1, atLeast2: null, expect: 1 });
    return out;
  }
  const clamp01 = (p: number) => Math.max(0, Math.min(1, p));
  /* ¬A：起手 5 张全无关键牌（A 的补集）。此后关键牌均匀分布在其余 N-5 个位置。 */
  const pNo = comb(N - K, DRAW_START) / comb(N, DRAW_START);
  const seen = new Set<number>();
  const push = (label: string, t: number) => {
    const d1 = Math.min(DRAW_START + t * DRAW_PER_TURN, N);          /* A 局面：位置 1..(5+2t) */
    if (seen.has(d1)) return;
    seen.add(d1);
    const dTurn = Math.min(t * DRAW_PER_TURN, N - DRAW_START);       /* ¬A 时 W1 里属于「回合抽」的部分 */
    const d2 = Math.min(DRAW_START + t * DRAW_PER_TURN, N - DRAW_START); /* ¬A 局面：位置 6..(5+2t)+5 */
    const a1 = (hyperAtLeast(N, K, d1, 1) - pNo * hyperAtLeast(N - DRAW_START, K, dTurn, 1))
      + pNo * hyperAtLeast(N - DRAW_START, K, d2, 1);
    const a2 = K >= 2
      ? (hyperAtLeast(N, K, d1, 2) - pNo * hyperAtLeast(N - DRAW_START, K, dTurn, 2))
        + pNo * hyperAtLeast(N - DRAW_START, K, d2, 2)
      : null;
    const ex = (K * d1 / N - pNo * K * dTurn / (N - DRAW_START))
      + pNo * K * d2 / (N - DRAW_START);
    out.push({
      label, n: d1,
      atLeast1: clamp01(a1),
      atLeast2: a2 == null ? null : clamp01(a2),
      expect: Math.max(0, Math.min(K, ex)),
    });
  };
  for (const t of ODDS_TURNS) push(t === 0 ? `起手 ${DRAW_START} 张（未中则全换）` : `第 ${t} 回合后`, t);
  push(`全牌组 ${N} 张`, Number.MAX_SAFE_INTEGER >> 1);   /* 饱和行：窗口吞下整个牌堆 */
  return out;
}

/* ---------- 回合模拟（蒙特卡洛） ----------
   规则常量全部来自官方规则词条（构建期人工校订表 scripts/build-concepts.mjs，
   运行时可经概念页查原文）：
   · 起手抓 5 张，每回合结束双方各抓 2 张（「手牌」词条）
   · 每回合投掷阶段投 8 枚元素骰：7 种元素 + 万能各 1/8；骰子每回合重投、不继承（「元素骰」词条）
   · 投骰后每回合可重投一次，重投枚数 0~8 自选（「元素骰」词条）；模拟采用理性策略：
     对支付本牌费用无贡献的「闲置骰」全部重投——保留元素位匹配骰与缺口内的万能骰，
     通用骰（VOID）费用任何骰都能付，重投后等价可付、视为闲置
   · 元素调和：弃 1 张手牌，把 1 枚骰转换成任意元素（「元素调和」词条）
   · 秘传必在起始手牌（「秘传」词条）；纯秘传标记（无骰子费用）的牌在手即可打出
   · 调度换牌（「替换手牌」规则）：起手没有关键牌时按「最大化到手」策略把 5 张
     全部放回牌组底再摸 5 张；压底的牌在摸穿上部之前不会被摸出（模拟里它们
     只含非关键牌，关键牌永远只可能在上部被摸到）
   不模拟：卡片效果触发、角色充能（费用中的充能视作可满足）。
   「可打出」的语义：第 t 回合内目标牌在手（本回合新抽算入）且——把目标牌当作
   本回合第一优先支出时——骰子够付。含调和/不含调和两列共用同一批骰子抽样
   （配对比较，只差在是否允许弃牌转色）。 */
const DICE_PER_TURN = 8;
const ELEMS = ["CRYO", "HYDRO", "PYRO", "ELECTRO", "ANEMO", "GEO", "DENDRO"];
const OMNI = "VOID";
const SIM_TURNS = 7;
const SIM_TRIALS = 20000;

/* 带种子的伪随机（mulberry32）：同一输入两次模拟逐位一致，测试可断言确定性 */
function rng32(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 费用归一：剥 GCG_COST_DICE_ 前缀得到元素/万能需求；充能与秘传位不计骰子 */
export function parseCost(playCost: CostEntry[] | undefined): { diceTotal: number; needs: Record<string, number> } {
  const needs: Record<string, number> = {};
  let diceTotal = 0;
  for (const pc of playCost || []) {
    if (pc.type === "GCG_COST_ENERGY" || pc.type === "GCG_COST_LEGEND") continue;
    const t = (pc.type || "").replace("GCG_COST_DICE_", "");
    const c = Number(pc.count) || 0;
    if (!c) continue;
    needs[t] = (needs[t] || 0) + c;
    diceTotal += c;
  }
  return { diceTotal, needs };
}

/* 支付费用的最少调和次数 = 需求元素子集上的最大「缺口」：
   任取需求色集合 S，缺口 = Σc_E −（池中 S 色骰 + 万能骰）。万能骰先补最紧的
   子集；缺口超出万能的部分只能靠元素调和（弃 1 张手牌转 1 枚骰的颜色）。
   需求色一般 ≤ 2 种，子集枚举 2^n 非常小。骰子总量约束单独判（调和不变量）。 */
export function minTunes(pool: Record<string, number>, needs: Record<string, number>): number {
  const keys = Object.keys(needs).filter(k => k !== OMNI);
  let worst = 0;
  const n = keys.length;
  for (let m = 1; m < (1 << n); m++) {
    let need = 0, have = pool[OMNI] || 0;
    for (let i = 0; i < n; i++) if (m & (1 << i)) { need += needs[keys[i]]; have += pool[keys[i]] || 0; }
    if (need - have > worst) worst = need - have;
  }
  return Math.max(0, worst);
}

export interface SimResult {
  turns: number[];        /* 观察点：0 = 起手，t = 第 t 回合 */
  inHand: number[];       /* 到手率（手中有至少一张，累计） */
  playable: number[];     /* 可打出率（含元素调和） */
  playableRaw: number[];  /* 可打出率（不调和，仅同色+万能） */
  handAvg: number[];      /* 平均手牌数 */
  trials: number;
}

export function simTurns(opts: {
  total: number; copies: number; playCost: CostEntry[] | undefined;
  turns?: number; trials?: number; seed?: number; reroll?: boolean; mulligan?: boolean;
}): SimResult {
  const T = Math.max(1, Math.min(opts.turns ?? SIM_TURNS, 20));
  const trials = Math.max(1, opts.trials ?? SIM_TRIALS);
  const rng = rng32(opts.seed ?? 20261031);
  const reroll = opts.reroll !== false;       /* 默认按官方规则重投（测试可关闭做配对比较） */
  const mulligan = opts.mulligan !== false;   /* 默认按官方规则调度（测试可关闭做对照） */
  const { diceTotal, needs } = parseCost(opts.playCost);
  const isLegend = (opts.playCost || []).some(pc => pc.type === "GCG_COST_LEGEND");
  /* 秘传必在起始手牌：把一张固定放进起手，其余照常洗在牌堆里 */
  let pickInHand = isLegend ? 1 : 0;
  let pickInDeck = Math.max(0, opts.copies - pickInHand);
  let deckLeft = Math.max(0, opts.total - (isLegend ? 1 : 0));
  let hand = 0;
  let returned = 0;   /* 调度压底的张数（只可能是非关键牌：起手没摸到才触发全换） */
  const draw = () => {   /* 无放回抽样：逐张判定是否关键牌 */
    if (deckLeft <= 0) {
      /* 上部摸穿后才会碰到压底的牌——它们不含关键牌，只计手牌数 */
      if (returned > 0) { returned--; hand++; }
      return;
    }
    if (rng() * deckLeft < pickInDeck) { pickInHand++; pickInDeck--; }
    deckLeft--; hand++;
  };
  const inHand = new Array(T + 1).fill(0);
  const playable = new Array(T + 1).fill(0);
  const playableRaw = new Array(T + 1).fill(0);
  const handAvg = new Array(T + 1).fill(0);
  const snap = (t: number) => {
    inHand[t] += pickInHand > 0 ? 1 : 0;
    handAvg[t] += hand;
    if (pickInHand > 0 && diceTotal <= DICE_PER_TURN) {
      if (diceTotal === 0) {
        /* 0 骰费用（如纯秘传标记牌）：在手即打出，无需投骰 */
        playable[t] += 1;
        playableRaw[t] += 1;
        return;
      }
      /* 投 8 骰：每枚 1/8 万能，其余 7 色均匀。重投候选 8 枚也固定预抽——
         无论是否启用重投都消费等量随机数，同 seed 下两档共享同一批初始骰
         与候选骰，「重投单调不劣」的配对比较才能逐位成立。 */
      const roll: string[] = [];
      for (let i = 0; i < DICE_PER_TURN * 2; i++) {
        const f = (rng() * 8) | 0;
        roll.push(f < 7 ? ELEMS[f] : OMNI);
      }
      let pool: Record<string, number> = {};
      for (const k of roll.slice(0, DICE_PER_TURN)) pool[k] = (pool[k] || 0) + 1;
      if (reroll) {
        /* 重投阶段：保留有贡献的骰子（元素位匹配 + 缺口内的万能骰），闲置骰全部重投。
           只替换无贡献者，def 单调不升；通用骰（VOID）费用任何骰都能付，重投等价。 */
        let kept = 0, omniDemand = 0;
        for (const k of Object.keys(needs)) {
          if (k === OMNI) continue;
          const m = Math.min(needs[k], pool[k] || 0);
          kept += m;
          omniDemand += needs[k] - m;
        }
        kept += Math.min(pool[OMNI] || 0, omniDemand);
        if (kept < DICE_PER_TURN) {
          const keptPool: Record<string, number> = {};
          for (const k of Object.keys(needs)) {
            if (k === OMNI) continue;
            const m = Math.min(needs[k], pool[k] || 0);
            if (m) keptPool[k] = m;
          }
          const om = Math.min(pool[OMNI] || 0, omniDemand);
          if (om) keptPool[OMNI] = om;
          for (const k of roll.slice(DICE_PER_TURN, DICE_PER_TURN + (DICE_PER_TURN - kept)))
            keptPool[k] = (keptPool[k] || 0) + 1;
          pool = keptPool;   /* 收敛成「重投后的最终骰池」 */
        }
      }
      const def = minTunes(pool, needs);
      if (def <= hand - 1) playable[t] += 1;          /* 弃牌转色：每转 1 色弃 1 张手牌（目标牌自己不弃） */
      if (def === 0) playableRaw[t] += 1;             /* 不调和：同色 + 万能直接够付 */
    }
  };
  for (let tr = 0; tr < trials; tr++) {
    pickInHand = isLegend ? 1 : 0;
    pickInDeck = Math.max(0, opts.copies - pickInHand);
    deckLeft = Math.max(0, opts.total - (isLegend ? 1 : 0));
    hand = 0;
    returned = 0;
    /* 起手 5 张；调度换牌：起手没有关键牌 → 5 张全部放回牌组底，重摸 5 张 */
    for (let i = 0; i < DRAW_START; i++) draw();
    if (mulligan && pickInHand === 0 && deckLeft > 0) {
      hand = 0;
      returned = DRAW_START;
      for (let i = 0; i < DRAW_START; i++) draw();
    }
    snap(0);
    /* 每回合：结束阶段抓 2 张 → 下一回合投骰判定可打出 */
    for (let t = 1; t <= T; t++) {
      draw(); draw();
      snap(t);
    }
  }
  const tr = trials;   /* 命名收口：结果都是「次数 / 试验数」的比率 */
  return {
    turns: Array.from({ length: T + 1 }, (_, i) => i),
    inHand: inHand.map(v => v / tr),
    playable: playable.map(v => v / tr),
    playableRaw: playableRaw.map(v => v / tr),
    handAvg: handAvg.map(v => v / tr),
    trials,
  };
}

/* 模拟按（牌组码 + 关键牌 + 张数）记忆：换关键牌/换牌组才重算，重渲染不重跑 */
let simCache: { key: string; res: SimResult } | null = null;
function simFor(key: string, opts: { total: number; copies: number; playCost: CostEntry[] | undefined }): SimResult {
  if (simCache && simCache.key === key) return simCache.res;
  const res = simTurns(opts);
  simCache = { key, res };
  return res;
}

/* ---------- 面板 ---------- */
function oddsCostBars(stats) {
  const max = Math.max(...stats.byCost, 1);
  return stats.byCost.map((n, i) => {
    const pct = stats.total ? Math.round(n / stats.total * 100) : 0;
    return `<div class="odds-bar-row" title="费用 ${i === 5 ? "5+" : i}：${n} 张（${pct}%）">
      <span class="odds-bar-label">${i === 5 ? "5+" : i}</span>
      <span class="odds-bar-track"><i class="odds-bar-fill" style="width:${Math.round(n / max * 100)}%"></i></span>
      <span class="odds-bar-val">${n} 张 · ${pct}%</span>
    </div>`;
  }).join("");
}
function renderOddsView(v) {
  const stats = oddsDeckStats();
  if (!state.current || !stats.total) {
    $("detail").innerHTML = `${navBar()}<div class="odds-view"><div class="cmp-title">抽牌概率与费用曲线</div>
      <div class="cmp-empty">请先解析一个牌组，再查看抽牌概率。</div></div>`;
    return;
  }
  const pick = stats.uniq.find(x => x.id === v.pick) || stats.uniq[0];
  const isLegend = (pick.playCost || []).some(pc => pc.type === "GCG_COST_LEGEND");
  const rows = oddsRows(stats.total, pick.count, isLegend);
  const typeKeys = Object.keys(stats.byType);
  /* 关键牌按类型分组，30 张卡的下拉不再是一长串平铺 */
  const groups: Array<{ type: string; items: ParsedCard[] }> = [];
  for (const x of stats.uniq) {
    let g = groups.find(v => v.type === x.type);
    if (!g) { g = { type: x.type, items: [] }; groups.push(g); }
    g.items.push(x);
  }
  const pickMeta = `${pick.type}${costText(pick.playCost) ? " · " + costText(pick.playCost) : ""} · 牌组内 ×${pick.count}（${Math.round(pick.count / stats.total * 100)}%）`;
  const take = rows.length
    ? (isLegend
      ? `<div class="odds-take">秘传必在起手：到手率恒为 <b>${fmtPct(rows[0].atLeast1)}</b>（整套限 1 张，无需调度）</div>`
      : `<div class="odds-take">起手 5 张（未中则全换）至少摸到 1 张：<b>${fmtPct(rows[0].atLeast1)}</b>${rows[1] ? ` · 第 1 回合后：<b>${fmtPct(rows[1].atLeast1)}</b>` : ""}</div>`)
    : "";
  $("detail").innerHTML = `${navBar()}
    <div class="odds-view">
      <div class="cmp-title">抽牌概率与费用曲线 <small>${stats.total} 张行动牌 · 不含角色牌</small></div>
      <div class="odds-kpis">
        <div class="odds-kpi"><small>行动牌</small><b>${stats.total}</b></div>
        <div class="odds-kpi"><small>种类</small><b>${stats.uniq.length}</b></div>
        <div class="odds-kpi"><small>平均费用</small><b>${stats.avg.toFixed(2)}</b></div>
        <div class="odds-kpi"><small>0 费</small><b>${stats.byCost[0]}</b></div>
      </div>
      <div class="odds-sec">
        <h3>费用曲线 <small>按张数计重 · 元素骰费用</small></h3>
        <div class="odds-bars">${oddsCostBars(stats)}</div>
        <div class="odds-chips">${typeKeys.map(t => `<span class="odds-chip">${esc(t)} ${stats.byType[t]}</span>`).join("")}</div>
      </div>
      <div class="odds-sec">
        <h3>关键牌抽牌概率 <small>超几何精确值 · 含调度换牌</small></h3>
        <label class="odds-pick"><span>关键牌</span>
          <select data-oddspick aria-label="选择要计算抽牌概率的关键牌">
            ${groups.map(g => `<optgroup label="${esc(g.type)}">${g.items.map(x => `<option value="${x.id}"${x.id === pick.id ? " selected" : ""}>${esc(x.name)}${x.count > 1 ? ` ×${x.count}` : ""}</option>`).join("")}</optgroup>`).join("")}
          </select>
          <small class="odds-pick-meta">${esc(pickMeta)}</small>
        </label>
        ${take}
        <table class="odds-table">
          <tr><th>回合</th><th>至少 1 张</th><th>至少 2 张</th><th>期望张数</th></tr>
          ${rows.map((r, i) => `<tr${i === 0 ? ' class="key"' : ""}>
            <td>${esc(r.label)}</td>
            <td><b>${fmtPct(r.atLeast1)}</b><span class="odds-pbar"><i style="width:${Math.round(r.atLeast1 * 100)}%"></i></span></td>
            <td>${r.atLeast2 == null ? "—" : fmtPct(r.atLeast2)}</td>
            <td>${r.expect.toFixed(2)}</td></tr>`).join("")}
        </table>
        <div class="odds-hint">起手摸 5 张；未摸到关键牌则按「5 张全部调度换掉再摸 5 张」计，换下的牌压在牌组底，之后的摸牌碰不到；之后每回合抽 ${DRAW_PER_TURN} 张。不含额外抽牌效果；角色牌不参与行动牌抽牌。本工具估计较粗略与乐观——实际对局还需先打其它牌、费用互相占用，真实打出概率通常低于表值。</div>
      </div>
      ${(() => {
        const sim = simFor(`${state.current!.code}|${pick.id}|${stats.total}`,
          { total: stats.total, copies: pick.count, playCost: pick.playCost });
        const zeroCost = parseCost(pick.playCost).diceTotal === 0;
        const row = (t: number, key: boolean) => `<tr${key ? ' class="key"' : ""}>
          <td>${t === 0 ? `起手 ${DRAW_START} 张` : `第 ${t} 回合`}</td>
          <td><b>${fmtPct(sim.inHand[t])}</b></td>
          <td>${fmtPct(sim.playable[t])}<span class="odds-pbar"><i style="width:${Math.round(sim.playable[t] * 100)}%"></i></span></td>
          <td>${fmtPct(sim.playableRaw[t])}</td>
          <td>${sim.handAvg[t].toFixed(1)}</td></tr>`;
        return `<div class="odds-sec">
        <h3>回合模拟 <small>蒙特卡洛 · ${sim.trials.toLocaleString()} 次</small></h3>
        <div class="odds-simmeta">规则：起手 ${DRAW_START} 张，未摸到关键牌则全换 5 张再摸 5（换下的压底）· 每回合抓 ${DRAW_PER_TURN} 张 · 每回合投 ${DICE_PER_TURN} 枚元素骰（万能 1/8，不继承），投后可重投一次（闲置骰全部重投）· 秘传必在起手${isLegend ? `（本牌是秘传，起手必带${zeroCost ? "；0 费在手即打出" : ""}）` : ""} · 不模拟效果触发与充能（充能费用视作可满足）</div>
        <table class="odds-table">
          <tr><th>回合</th><th>到手</th><th>可打出 · 含调和</th><th>可打出 · 不调和</th><th>平均手牌</th></tr>
          ${sim.turns.map(t => row(t, t === 0)).join("")}
        </table>
        <div class="odds-hint">「含调和」按官方元素调和计：每弃 1 张手牌可把 1 枚骰转成任意元素；「可打出」把关键牌当作该回合的第一优先支出。重投按理性策略计：对支付本牌费用无贡献的闲置骰全部重投（枚数 0~8 随局面）。本工具估计较粗略与乐观：不模拟效果触发、充能与对局取舍，实际打出概率通常低于表值。</div>
      </div>`;
      })()}
    </div>`;
}
/* 抽牌面板只反映"当前正在查看的牌组"，因此每次打开都重建单层视图；
   关键牌选择记在 oddsState 里，关掉再打开仍停在上一张。 */
const oddsState: { pick: number | null } = { pick: null };
function showOdds() {
  if (!dataReady) {
    ensureData().then(showOdds).catch(e => setStatus("数据加载失败：" + e.message, "err"));
    return;
  }
  if (!state.current) { toast("请先解析一个牌组", true); return; }
  overlayHashClear();   /* 整栈替换：先清掉已推的弹层历史，hash 与栈保持一致 */
  state.overlayStack = [{ kind: "odds", pick: oddsState.pick }];
  renderOverlay();
}

/* ---------- 交互 ---------- */
document.addEventListener("change", ev => {
  const sel = (ev.target as HTMLElement).closest ? (ev.target as HTMLElement).closest("[data-oddspick]") : null;
  if (!sel) return;
  const top = topView();
  if (!top || top.kind !== "odds") return;
  oddsState.pick = Number((sel as HTMLSelectElement).value);
  top.pick = oddsState.pick;
  renderOverlay();
});

export { DRAW_START, DRAW_PER_TURN, ODDS_TURNS, comb, hyperAtLeast, fmtPct, oddsDeckStats, oddsRows, oddsCostBars, renderOddsView, oddsState, showOdds, DICE_PER_TURN, SIM_TURNS, SIM_TRIALS };   /* parseCost/minTunes/simTurns 已 inline export */
