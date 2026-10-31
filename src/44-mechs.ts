/* 44-mechs.ts —— 机制索引：按效果文本把卡牌归到高频玩法机制。
   与 data/records、50-backlinks 同款模式：数据来自不可变的统一数据集，
   索引按需记忆，resetMechs 供测试与数据重建隔离。
   匹配口径：只看 recordOfId(id).desc.effect（行动牌与对局实体的效果文本）；
   角色牌没有效果文本 → 恒不命中任何机制。
   模式是 curated 正则（在当前数据集上实测的覆盖数见 tests/test-browse 的
   机制节）；官方措辞变化时只改这张表，不用动筛选与渲染。 */

import { recordOfId } from "./data/records";

export interface Mech { key: string; label: string; re: RegExp }

export const MECHS: Mech[] = [
  { key: "draw", label: "抽牌", re: /抽[一二两三四五\d]+张|抓[一二两三四五\d]+张/ },
  { key: "discard", label: "弃牌", re: /弃[一二两三四五\d]+张|弃置|舍弃|弃掉/ },
  { key: "heal", label: "治疗", re: /治疗|回复.{0,6}生命值?/ },
  { key: "shield", label: "护盾", re: /护盾/ },
  { key: "summon", label: "召唤物", re: /召唤物|生成.{0,8}召唤/ },
  { key: "cheap", label: "减费", re: /少.{0,6}个?.{0,3}骰|减少.{0,6}费|费用-|少1个元素骰/ },
  { key: "pierce", label: "穿透", re: /穿透伤害/ },
  { key: "charge", label: "充能", re: /充能|能量点/ },
  { key: "move", label: "转移", re: /转移|交换.{0,6}位置|换到.{0,4}位置/ },
];

const maskCache = new Map<number, number>();

/** 清空机制索引（供测试与「数据重建」场景隔离）。 */
export function resetMechs(): void {
  maskCache.clear();
}

/** 卡牌的机制位掩码（按 MECHS 序）；记忆化，数据集会话内不可变。 */
export function mechMaskOf(id: number): number {
  const cached = maskCache.get(id);
  if (cached != null) return cached;
  const r = recordOfId(id);
  const text = (r && r.desc && r.desc.effect) || "";
  let m = 0;
  for (let i = 0; i < MECHS.length; i++) if (MECHS[i].re.test(text)) m |= (1 << i);
  maskCache.set(id, m);
  return m;
}

export const mechHas = (mask: number, key: string): boolean => {
  const i = MECHS.findIndex(x => x.key === key);
  return i >= 0 ? !!(mask & (1 << i)) : false;
};

export const mechLabel = (key: string): string =>
  (MECHS.find(x => x.key === key) || { label: key } as Mech).label;

