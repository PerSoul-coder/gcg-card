# 七圣召唤 · 卡牌与牌组浏览器 — 数据与架构设计

状态：设计定稿（P0 数据基础实施中）
范围：统一数据模型、构建期归一化、Brotli 数据包、资源层、检索与呈现、浮层管理。
本文档是后续改造的依据；与代码冲突时以本文档为准并回写代码。

---

## 0. 这份文档解决什么

项目已从「牌组分享码解析器」演化为「七圣召唤卡牌浏览器」，但数据层仍是四份异构原始数据 + 十余处运行时启发式规则叠加。结果是同一张牌在卡库、概念页、检索结果里可能得到不同结论，典型故障：

- 装备牌赋予的「特技」不在任何索引里，搜不到、点不动；
- 角色简介里的叙事词被当成概念链接；
- 有牌面的牌在概念页只显示 110px 小图，在列表视图则完全没有牌面；
- 浮层滑动被背景滚动链抢走。

根因不是某一处写错，而是**判定分散在运行时**。本设计把这些判定前移到构建期，运行期只读一份统一记录。

---

## 1. 数据盘点

### 1.1 四个来源

| 来源 | 文件 | 规模（实测） | 角色 |
| --- | --- | --- | --- |
| piovium characters | `gi-data/characters.json` | 155 角色，626 技能（hidden 80） | 身份层：角色、技能、卡面 id |
| piovium entities | `gi-data/entities.json` | 1347 条 | 身份层：卡牌、状态、召唤物、附件 |
| piovium keywords | `gi-data/keywords.json` | 149 条（全部负 id） | 释义层：规则术语 |
| genshin-db concepts | `gi-data/concepts-extra.json` | 432 条 | 释义层：补充规则/历史卡 |

entities 的类型分布（实测）：

| 原始 type | 数量 | 域 | 可构筑 | 有牌面 |
| --- | ---: | --- | --- | ---: |
| GCG_CARD_STATE | 385 | field | 否 | 否 |
| GCG_CARD_MODIFY | 289 | card | 是（有 shareId 时） | 是 |
| GCG_CARD_ONSTAGE | 235 | field | 否 | 否 |
| GCG_CARD_EVENT | 197 | card | 是 | 是 |
| GCG_CARD_ASSIST | 121 | card | 是 | 是 |
| GCG_CARD_SUMMON | 113 | field | 否 | 是 |
| GCG_CARD_ATTACHMENT | 7 | field | 否 | 否 |

关键事实：

- 625 / 1347 条没有 `cardFace`，只能渲染同比例「卡壳」；
- 865 / 1347 条没有 `shareId`，不可构筑；
- **22 张装备牌（GCG_CARD_MODIFY）自带 `skills`，共 24 个技能名**，例如「跃升」「鲨鲨冲浪板」「转转冲击」「仙力助推」「昂扬状态」。这些名字在卡文中以「特技：X」出现，但当前技能索引只遍历角色，全部漏收。

补充库 kind 分布：card 234、status 78、enemy 59、rule 52、rule-term 6、keyword 2、summon 1。

### 1.2 类型体系

```
domain: char | card | field | term | skill
field 细分：state（角色状态）| team（队伍状态）| summon（召唤物）| attachment（附加状态）
```

判定只回答三个问题：是什么牌、能不能进牌组、是独立身份还是影子。

### 1.3 派生索引（当前在运行时现算）

`pool`（卡池）、`SKILLS`（技能）、`termIndex`（概念）、`backlinks`（反链）、`shadowStateIds`（准备状态影子）。

这些索引本身不是问题；问题是它们依赖 `nameKey`、`descMirrors`、`levRatio`、正则匹配等启发式在每次加载时重新猜。

---

## 2. 现状问题与根因

| # | 现象 | 直接根因 | 位置 |
| --- | --- | --- | --- |
| 1 | 特技搜不到、无法链接 | 技能索引只遍历 `CHAR`，未遍历 `ENT` 的 `skills` | `src/47-skills.js` `buildSkillIndex` |
| 2 | 其他概念被错误忽略 | keywords 7 条空名靠运行时 `length >= 2` 静默跳过；`name.length < 2` 会误杀单字技能 | `src/40-concepts.js` |
| 3 | 有牌面的牌不渲染牌面 | 概念页用 `termBodyHtml` 的 `info.image` 小图；列表/差异/技能页无牌面；卡库用 420:720 | `src/50-backlinks.js`、`src/85-views.js` |
| 4 | 角色简介被识别为概念 | `linkify(c.storyText)`，且反链扫描 `storyText` | `src/90-detail.js:214`、`src/50-backlinks.js:23` |
| 5 | 滑动被背景捕捉 | 仅 overlay 锁 `html.ovl-lock`；`draftPanel`/`compareBar`/`menu` 未纳入统一层管理 | `src/90-detail.js` `setOverlayOpen`、`deck-viewer.css` |
| 6 | 分享码输入常驻顶部 | 信息架构仍以解析器为主 | `deck-viewer.html` |

---

## 3. 统一记录模型

### 3.1 Record 字段

构建期把四份来源归一为同一种记录。运行期只读，不再推断。

```ts
type Record = {
  key: string;            // 稳定唯一键："char:1211" | "card:113154" | "skill:card:113154:1131541" | "term:-211"
  kind: "char" | "card" | "skill" | "term";
  domain: "char" | "card" | "field" | "term" | "skill";
  name: string;
  englishName: string;
  aliases: {              // 构建期算好，运行期直接查
    norm: string;         // 抹平引号/感叹号/加号/空白
    cosmetic: string;     // 只抹平引号/空白
    pinyin?: string;
    initials?: string;
  };
  typeRaw: string;        // GCG_CARD_* / GCG_SKILL_TAG_* / 补充库 kind
  typeZh: string;
  desc: {
    effect: string;       // 卡牌效果 / 技能效果 / 术语释义（可链接）
    story: string;        // 角色简介 / 故事（不可链接）
    rules: string;        // 规则原文
  };
  linkable: boolean;      // 名称是否可被检索与链接
  art: {                  // 只存引用，不存 URL
    hasFace: boolean;
    ref: number | null;   // 数据源 id；art 层据此拼 URL
    kind: "card" | "char" | "state" | "summon" | "team" | "attach" | "none";
  };
  stats: {
    cost: string[];       // playCost 原样
    dice: number;
    energy: number;
    hp: number | null;
    maxEnergy: number | null;
    tags: string[];       // 已译中文标签
    tagsRaw: string[];
    element: string;
  };
  rel: {
    ownerKey: string | null;      // 技能所属：char/card 的 key
    ownerName: string | null;
    ownerKind: "char" | "card" | null;
    relatedCharacterKey: string | null;
  };
  flags: {
    deckable: boolean;    // 有 shareId
    poolable: boolean;    // 进入卡库/检索
    shadow: boolean;      // 准备状态影子
    mirror: boolean;      // 牌面文本镜像
    test: boolean;        // 测试卡
    entity: boolean;      // 对局实体
  };
  refs: string[];         // 出边：可链接文本中引用到的其他 key
  source: "piovium" | "genshin-db" | "derived";
};
```

### 3.2 示例

```json
{
  "key": "skill:card:113154:1131541",
  "kind": "skill",
  "domain": "skill",
  "name": "跃升",
  "englishName": "",
  "aliases": { "norm": "跃升", "cosmetic": "跃升", "pinyin": "yuesheng", "initials": "ys" },
  "typeRaw": "GCG_SKILL_TAG_NONE",
  "typeZh": "特殊技能",
  "desc": { "effect": "……", "story": "", "rules": "" },
  "linkable": true,
  "art": { "hasFace": false, "ref": null, "kind": "none" },
  "rel": { "ownerKey": "card:113154", "ownerName": "驰轮车·跃升", "ownerKind": "card", "relatedCharacterKey": null },
  "flags": { "deckable": false, "poolable": false, "shadow": false, "mirror": false, "test": false, "entity": false },
  "refs": ["card:113154"],
  "source": "piovium"
}
```

### 3.3 判定前移

| 判定 | 现在 | 之后 |
| --- | --- | --- |
| 准备状态影子 | 运行时正则 `PREPARED_STATE_RE` | 构建期 `flags.shadow` |
| 牌面文本镜像 | 运行时 `descMirrors` + `levRatio` | 构建期 `flags.mirror` |
| 是否可构筑 | 运行时 `shareId != null` | 构建期 `flags.deckable` |
| 是否可链接 | 散落在各视图 | 构建期 `linkable` |
| 同名合并 | 运行时 `nameKey` 竞争 | 构建期按 `aliases.norm` 合并 |
| 反链 | 运行时扫描全文 | 构建期 `refs` |

---

## 4. 构建流程

新增 `scripts/build-dataset.mjs`：

1. 读取四份来源（`characters.data` / `entities.data` / `keywords.data` / `concepts-extra`）。
2. 建身份表：piovium id、`aliases.norm`、`aliases.cosmetic`。
3. 生成角色记录与技能记录；**技能来源 = 角色 `skills` + 实体 `skills`**。
4. 生成卡牌/实体记录；按 `type` 定 `domain`、`deckable`、`entity`。
5. 合并补充库：已有身份则挂载释义，否则新建 `term` 记录。
6. 判定 `shadow` / `mirror` / `test` / `linkable`。
7. 只对 `linkable` 的 `desc.effect` / `desc.rules` 扫描，生成 `refs`。
8. 校验：
   - key 唯一；
   - 技能必须有 `ownerKey`；
   - 记录数、可链接数、有牌面数与源数据对账；
   - 空名/空描述记录只允许 `linkable=false`。
9. 输出：
   - `gi-data/dataset.json`：归一化 JSON（调试、单文件内联、Node 测试兜底）
   - `gi-data/dataset.gz`：gzip 压缩的同一份 JSON（浏览器原生 `DecompressionStream` 主路径）
   - `gi-data/dataset.br`：Brotli 压缩的同一份 JSON（体积最小，供 Node / 归档 / 未来解码器）
   - `gi-data/dataset.meta.json`：计数与构建时间

> 选型说明：浏览器原生 `DecompressionStream` 只支持 gzip / deflate，不支持 Brotli。
> 因此运行时主路径用 gzip；Brotli 包保留为更小的归档格式，若将来引入解码器可无缝切换。

产物只在 `gi-data/`，不写入 `vendor/` 或其他只读目录。

---

## 5. 运行时加载与索引

新增 `src/07-dataset.js`：

- `loadDataset()`：
  1. 单文件版：读内联的 `window.BUILTIN_DATASET_GZ_B64`（gzip base64，`DecompressionStream("gzip")` 解码）；
  2. 多文件版：`fetch("gi-data/dataset.gz")` → `DecompressionStream("gzip")` → JSON；
  3. gzip 不可用：尝试 `dataset.br`（Brotli，视浏览器支持）；
  4. 再失败：回退 `fetch("gi-data/dataset.json")`。
- `buildDatasetIndex()`：建立 `byKey` / `byKind` / `byDomain` / `byName`（norm/cosmetic）。
- 兼容投影：P0 仍保留 `CHAR` / `ENT` / `KW` 供未迁移模块；技能、概念、反链、牌面已切到统一记录，P1 完成唯一化。

模块组织：源码为标准 ESM，依赖由各模块的 `import` 表达；`src/main.ts` 只固定顶层副作用次序。浏览器产物由 esbuild 打成单个 IIFE（`dist/app.js`），因为单 HTML 需要内联脚本且要能在 `file://` 下运行。测试执行同一份产物，通过 `src/test-api.ts` 的导出面访问内部符号——全局暴露只存在于测试进程。

---

## 6. 检索

- 语料 = `flags.poolable` 的 card/char + 全部 `linkable` 的 skill/term。
- 打分保持现有分层（精确 > 前缀 > 拼音 > 模糊 > 描述），但**技能与卡牌同权**，不再因为「不在牌库」被排除。
- `kind` 过滤由记录字段决定，不再按 `termIndex` 条目猜测。
- 特技（`ownerKind = card` 的 skill）与角色技能走同一套结果行，标注「特技 · 所属卡牌」。

---

## 7. 呈现与牌面

统一牌面组件，三档同比例：

| variant | 用途 | 尺寸 |
| --- | --- | --- |
| `tile` | 卡库/检索/牌组网格 | 420:720，网格列宽决定实际像素 |
| `detail` | 详情弹层/概念页 | 420:720，最大 280px 宽 |
| `thumb` | 对比表头/关系 chip | 420:720，约 84px 宽 |

规则：

- 有 `art.hasFace`：渲染图片，写死 `width/height` 与 `aspect-ratio`，加载前占位；
- 无牌面：同比例卡壳（类型色 + 类型字 + 状态图标），不复用真牌面样式；
- 加载失败：就地降级为「卡面未加载」卡壳；
- **所有界面只调用这一个组件**，不再各自拼 `<img>`。

概念页与技能页改为：左侧统一牌面（若有 art.ref 或所属角色/卡牌有牌面），右侧释义。没有牌面的技能显示所属卡牌或角色的牌面，并标注「技能」。

---

## 8. 资源层

新增 `src/06-art.js`（或并入 `00-resources.js`）：

- `artUrl(ref)`：唯一拼 URL 的地方；
- `renderArt(art, variant)`：唯一渲染牌面的地方；
- 加载策略、懒加载、失败降级、状态图标只在这里；
- 数据层只保留 `art.ref`，不出现 `https://`。

---

## 9. 浮层层（P2）

新增 `src/08-layers.js`：

- 所有浮层（overlay / draftPanel / compareBar / menu / histPanel）登记为层；
- 打开任一层 → `html.modal-lock`（`overflow: hidden` + `overscroll-behavior: none`）；
- 关闭最后一层 → 解锁；
- 可滚容器统一 `overscroll-behavior: contain`；
- Esc 按层栈逐层关闭；
- 触摸：`touch-action: pan-y` 明确手势，避免背景抢滚动。

---

## 10. 迁移映射

| 旧 | 新 |
| --- | --- |
| `CHAR[]` | `kind=char` 记录 |
| `ENT[]` | `kind=card` 记录（domain=card/field） |
| `KW[]` | `kind=term` 记录 |
| `SKILLS[]` | `kind=skill` 记录（含角色技能与装备牌特技） |
| `pool[]` | 视图投影：`flags.poolable` |
| `termIndex` | `byName` 索引 |
| `backlinks` | 记录的 `refs` 反向表 |

---

## 11. 验收与测试

P0 验收：

- 24 个装备牌特技名可被检索、可被卡文链接、详情可打开；
- 角色简介不产生术语链接，不计入反链；
- 概念页与卡库的牌面比例、占位、降级一致；
- 全量测试通过；
- `dataset.br` 可解码，记录数与源数据对账一致。

新增反向测试：

- 构造含「特技：X」的卡文，断言 X 被链接；
- 构造含叙事词的角色简介，断言不产生 `.term`；
- 断言影子状态不占概念名；
- 断言空名关键词不进索引。

---

## 12. 分阶段

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P0 | 统一模型 + 构建脚本 + 压缩包 + 运行时数据层 + 资源层 + 修 ENT 特技 / storyText / 牌面统一 | 已完成 |
| P1 | 检索语料统一、linkable、反链迁移 | 待开始 |
| P2 | 浮层层管理、滑动链、Esc | 待开始 |
| P3 | UI 重组：默认卡库、分享码入口下沉 | 待开始 |
