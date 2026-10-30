/* src/86-odds.js —— 由 scripts/_convert.mjs 从旧脚本转换（迁移中间态）。 */
import { dataReady, ensureData } from "./20-data";
import { $ } from "./core/dom";
import { renderOverlay, topView } from "./90-detail";
import { state } from "./data/state";
import type { ParsedCard } from "./types";
import { esc, setStatus, toast } from "./core/dom";
import { costText } from "./30-deps";
import { navBar } from "./90-detail";

/* ---------- 抽牌概率模型 ----------
   行动牌是 30 张的无放回抽样池，抽牌等价于超几何分布：
     P(至少 need 张) = 1 - Σ_{i<need} C(K,i)·C(N-K,n-i) / C(N,n)
   N = 行动牌总数，K = 关键牌张数，n = 已看到的牌数。
   起手 5 张，之后每回合抽 2 张；不含调度（换牌）与额外抽牌效果。 */
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
/* 每个观察点（起手 / 第 1~4 回合后 / 全牌组）的至少 1 张、至少 2 张与期望张数 */
function oddsRows(N: number, K: number): OddsRow[] {
  const seen = new Set<number>();
  const out: OddsRow[] = [];
  const push = (label, n) => {
    n = Math.min(n, N);
    if (seen.has(n)) return;
    seen.add(n);
    out.push({
      label, n,
      atLeast1: hyperAtLeast(N, K, n, 1),
      atLeast2: K >= 2 ? hyperAtLeast(N, K, n, 2) : null,
      expect: N ? n * K / N : 0,
    });
  };
  for (const t of ODDS_TURNS) push(t === 0 ? `起手 ${DRAW_START} 张` : `第 ${t} 回合后 ${DRAW_START + t * DRAW_PER_TURN} 张`, DRAW_START + t * DRAW_PER_TURN);
  push(`全牌组 ${N} 张`, N);
  return out;
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
  const rows = oddsRows(stats.total, pick.count);
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
    ? `<div class="odds-take">起手 ${rows[0].n} 张至少摸到 1 张：<b>${fmtPct(rows[0].atLeast1)}</b>${rows[1] ? ` · 第 1 回合后（${rows[1].n} 张）：<b>${fmtPct(rows[1].atLeast1)}</b>` : ""}</div>` : "";
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
        <h3>关键牌抽牌概率 <small>超几何分布 · 每回合抽 2 张</small></h3>
        <label class="odds-pick"><span>关键牌</span>
          <select data-oddspick aria-label="选择要计算抽牌概率的关键牌">
            ${groups.map(g => `<optgroup label="${esc(g.type)}">${g.items.map(x => `<option value="${x.id}"${x.id === pick.id ? " selected" : ""}>${esc(x.name)}${x.count > 1 ? ` ×${x.count}` : ""}</option>`).join("")}</optgroup>`).join("")}
          </select>
          <small class="odds-pick-meta">${esc(pickMeta)}</small>
        </label>
        ${take}
        <table class="odds-table">
          <tr><th>看到张数</th><th>至少 1 张</th><th>至少 2 张</th><th>期望张数</th></tr>
          ${rows.map((r, i) => `<tr${i === 0 ? ' class="key"' : ""}>
            <td>${esc(r.label)}</td>
            <td><b>${fmtPct(r.atLeast1)}</b><span class="odds-pbar"><i style="width:${Math.round(r.atLeast1 * 100)}%"></i></span></td>
            <td>${r.atLeast2 == null ? "—" : fmtPct(r.atLeast2)}</td>
            <td>${r.expect.toFixed(2)}</td></tr>`).join("")}
        </table>
        <div class="odds-hint">按起手 ${DRAW_START} 张、每回合抽 ${DRAW_PER_TURN} 张估算，不含调度与额外抽牌效果；角色牌不参与行动牌抽牌。</div>
      </div>
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

export { DRAW_START, DRAW_PER_TURN, ODDS_TURNS, comb, hyperAtLeast, fmtPct, oddsDeckStats, oddsRows, oddsCostBars, renderOddsView, oddsState, showOdds };
