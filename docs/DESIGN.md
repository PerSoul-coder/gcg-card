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
| piovium characters | `gi-data/characters.json` | 156 角色，631 技能（hidden 82） | 身份层：角色、技能、卡面 id |
| piovium entities | `gi-data/entities.json` | 1381 条 | 身份层：卡牌、状态、召唤物、附件 |
| piovium keywords | `gi-data/keywords.json` | 153 条（全部负 id） | 释义层：规则术语 |
| genshin-db concepts | `gi-data/concepts-extra.json` | 433 条 | 释义层：补充规则/历史卡 |

entities 的类型分布（实测）：

| 原始 type | 数量 | 域 | 可构筑 | 有牌面 |
| --- | ---: | --- | --- | ---: |
| GCG_CARD_STATE | 394 | field | 否 | 否 |
| GCG_CARD_MODIFY | 293 | card | 是（有 shareId 时） | 是 |
| GCG_CARD_ONSTAGE | 244 | field | 否 | 否 |
| GCG_CARD_EVENT | 204 | card | 是 | 是 |
| GCG_CARD_ASSIST | 126 | card | 是 | 是 |
| GCG_CARD_SUMMON | 113 | field | 否 | 是 |
| GCG_CARD_ATTACHMENT | 7 | field | 否 | 否 |

关键事实：

- 643 / 1381 条没有 `cardFace`，只能渲染同比例「卡壳」；
- 892 / 1381 条没有 `shareId`，不可构筑；
- **22 张装备牌（GCG_CARD_MODIFY）自带 `skills`，共 24 个技能名**，例如「跃升」「鲨鲨冲浪板」「转转冲击」「仙力助推」「昂扬状态」。这些名字在卡文中以「特技：X」出现，但当前技能索引只遍历角色，全部漏收。

补充库 kind 分布：card 234、status 79、enemy 59、rule 52、rule-term 6、keyword 2、summon 1。

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
    pinyin: string;       // 空格分隔音节的无声调全拼（"yue sheng"）；全拼/首字母运行时由此派生
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
  "aliases": { "norm": "跃升", "cosmetic": "跃升", "pinyin": "yue sheng" },
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
| 牌面文本副本 | 运行时 `descMirrors` + `levRatio` | 构建期 `flags.mirror`（不进概念索引） |
| 同名身份（角色形态说明） | 运行时 `mirrorCard` 标志 | 构建期 `flags.dupIdentity`（进索引但不单列检索） |
| 是否可构筑 | 运行时 `shareId != null` | 构建期 `flags.deckable` |
| 是否可链接 | 散落在各视图 | 构建期 `linkable`（有描述即可链接，与 mirror 解耦） |
| 同名合并 | 运行时 `nameKey` 竞争 + `entryBetter` | 构建期 `terms` 分组（同名同种类取一条） |
| 反链 | 运行时扫描全文 | 构建期 `refs` |
| 元素反应术语 | 运行时解析关键词描述文本 | 构建期派生 `term:rx:*` 记录 |

**linkable 与 mirror 必须分开。** 早期把「是副本」也算进「不可链接」，等于 `正文里出现「眩晕」却点不开`。
两者管的是不同的事：`linkable` 决定能否点，`mirror` 决定是否在概念索引里重复占位。

---

## 4. 构建流程

新增 `scripts/build-dataset.mjs`：

1. 读取四份来源（`characters.data` / `entities.data` / `keywords.data` / `concepts-extra`）。
2. 建身份表：piovium id、`aliases.norm`、`aliases.cosmetic`。
3. 生成角色记录与技能记录；**技能来源 = 角色 `skills` + 实体 `skills`**。
4. 生成卡牌/实体记录；按 `type` 定 `domain`、`deckable`、`entity`。
5. 合并补充库：已有身份则挂载释义，否则新建 `term` 记录。
6. 判定 `shadow` / `mirror` / `test` / `linkable`。
7. 只对 `linkable` 且非 `mirror` 的 `desc.effect` / `desc.rules` 扫描，生成 `refs`。
8. 生成概念索引 `terms`：按名字归组，同名同种类取一条（现网优先 → 可入构筑 → 有描述），
   按 `card → char → keyword → rule → rule-term → skill → status → summon → enemy → cardref → charref` 排序。
9. 校验：
   - key 唯一；
   - 技能必须有 `ownerKey`；
   - 记录数、可链接数、有牌面数与源数据对账；
   - 空名/空描述记录只允许 `linkable=false`；
   - `terms` 里每个 key 都能在 `records` 里取到（否则运行时投影得到空壳）。
10. 输出：
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
- `buildDatasetIndex()`：建立 `byKey` / `byKind`。
- 记录索引（`data/records.ts`）：把 `records` 编译成查表（`recordOfId` / `idOfShare` /
  `shareOfId` / `charRecords` / `cardRecords`）。界面取「一张牌是什么」只有这一条路径。
- 概念索引（`40-concepts`）：只读 `dataset.terms` 做字段投影，再编译成扫描正则。
  收录、去重、排序、身份挂载全部在构建期完成——运行时不再有 `entryBetter` / `descMirrors` /
  `kwMirrorsEntity` 这类启发式，也不再有「补充库与现网谁先注册」的顺序依赖。
- 卡池（`45-pool`）：`charRecords()` + `cardRecords()` 的纯投影，字段一一对应，
  统计（可构筑数 / 排除计数 / 分面计数）由投影结果算，不再二次推导。
- 反链（`50-backlinks`）：只读 `refs` 翻转成「谁引用了我」，不再二次扫描文本。

数据源分工（已收敛）：**运行时只有一份数据**——`dataset`，它包含概念、技能、反链、
卡池与详情需要的全部字段。原始三份 JSON（characters / entities / keywords）只作为
构建期输入存在，不再被内联、不再被下载、也不再有「回退到原始快照」这条路。
运行时负责的只有：解码数据包、建查表、渲染。

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

**弹层 ↔ 浏览器历史桥（P6，`src/core/history.ts`）**：detail / term / skill 三类「可回退层」打开时写入一条历史（`#card=` / `#t=` / `#s=`，layer 上打 `hpushed` 标记），compare / deckdiff（odds 已于 15.3 归档）不是可回退层、不写历史但整栈替换时会清账（`overlayHashClear`）。浏览器返回键 → popstate → `syncOverlayToHash` 差量同步：带条目的层弹到目标深度（后退）、按 hash 重开缺的层（前进，`overlayHashAdopt` 认领条目）、夹在中间的普通层一并清掉；随后的 hashchange 打跳过标记防重复路由。深链打开的层没有条目，因此同步按「带条目的层数」对齐而不是数全部可回退层。测试环境无 `history.back` / `window.addEventListener`，全部退化为旧的即时行为。

---

## 10. 迁移映射

| 旧 | 新 |
| --- | --- |
| `CHAR[]` | `charRecords()`（`kind=char` 记录） |
| `ENT[]` | `cardRecords()`（`kind=card` 记录，domain=card/field） |
| `KW[]` | `kind=term` 记录 |
| `SKILLS[]` | `kind=skill` 记录（含角色技能与装备牌特技） |
| `charById` / `entById` / `charByName` | `recordOfId` / `nameOfId`（data/records.ts） |
| `shareMap` / `idToShare` | `idOfShare` / `shareOfId`（按 `record.share` 建） |
| `pool[]` | 视图投影：`charRecords()` + `flags.poolable` |
| `termIndex` | `dataset.terms` 投影 |
| `backlinks` | 记录的 `refs` 反向表 |
| `deckReqsOf` / `restrictionsOf` / `isTestCard` | 构建期写入 `record.reqs` / `flags.test` |
| `cardElement` / `charElement` | `record.stats.element`（构建期按 tag → 关联角色 → 元素门槛推导） |
| 三份原始 JSON 的 24h 本地缓存 | 无：数据包由站点提供，刷新用时间戳绕过 HTTP 缓存 |
| 单文件内联原始快照 | 单文件只内联 `dataset.gz`（3.1MB → 0.94MB） |

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

P1 验收：

- 概念索引的名字集合与迁移前逐名一致（构建期 `terms` 对账：2425 名，0 丢 0 多）；
- 元素反应术语（感电 / 结晶 / 超载…）各有独立条目，基名（结晶 / 扩散）已归并；
- 同名跨种类并列（护盾 = 状态牌 + 关键词；幻戏 = 规则术语 + 技能）；
- 牌面文本副本不进概念索引，但仍可被正文链接；
- 反链只读出边，不再二次扫描文本；
- `gi-data/concepts-extra.js` 不再是运行时依赖（仅构建期输入）。

P3 验收：

- 打开页面直接落在卡库，顶部没有分享码输入框；
- 切到「牌组 · 卡面 / 列表」时操作条才出现，返回卡库即收起（`body[data-view]` 驱动，不靠入口逐个调用）；
- 页头「更多」只含全局动作（刷新数据 / 数据信息 / 说明），牌组动作在牌组操作条内；
- 外部分享链接 `#<分享码>` 解析后直达卡面视图；

P4 验收：

- 卡池与详情不再读原始快照：全库 1480 条卡池条目与记录逐字段对账，0 差异
  （两处刻意的更正除外：秘传费用不再算作骰子、8 个无分享码的角色不再标为可入组）；
- 牌组限制与打出限制对账：1347 张实体、179 条牌组限制、218 条打出限制，构建期与旧运行时完全一致；
- `deckReqsOf` / `restrictionsOf` / `isTestCard` / `cardElement` 等运行时启发式已删除；
- 单文件只内联 `dataset.gz`（0.94MB，gzip 542KB；原 3.12MB）；
  「不内嵌数据、联网取包」的轻量版随之失去意义，已移除（连同构建分支与测试）；
- 全量测试 14/14 通过，`tsc --noEmit` 0 错误。
- 示例牌组改为按需加载，首屏不再写入历史记录。

## 12. 分阶段

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P0 | 统一模型 + 构建脚本 + 压缩包 + 运行时数据层 + 资源层 + 修 ENT 特技 / storyText / 牌面统一 | 已完成 |
| P1 | 检索语料统一、linkable、反链迁移 | 已完成：概念索引与反链全部消费统一记录；反应术语改构建期派生；linkable 与 mirror 解耦 |
| P2 | 浮层层管理、滑动链、Esc | 已完成：core/layers 统一登记层序，Esc 只关最上层；锁滚动只对模态层（overlay / draftPanel），历史与对比栏不再误锁 |
| P3 | UI 重组：默认卡库、分享码入口下沉 | 已完成：一级视图卡库在前；牌组操作条只属于牌组视图（body[data-view] 驱动显隐）；页头只放全局动作；首屏不再自动解析示例 |
| P4 | 建模补齐：卡池 / 详情 / 对比 / 导出全部消费统一记录，删除原始快照与运行时启发式 | 已完成：记录补 `share` / `reqs` / `searchText` 与卡片元素；`data/records.ts` 成为唯一查表入口；`30-deps` 只剩渲染与校验；单文件只内联数据包 |
| P5 | 技能/特技建模统一、角色-装备关联、拼音覆盖 | 已完成：特技 = 装备牌技能（ownerKind=card ⇒ typeZh「特技」，技能码只作数据标记）；特技牌的 `relatedCharacterId` 两级推导补齐——出边点名唯一角色 / id 结构（1+角色id+序号），冲突信出边，12 张全覆盖、通用装备不硬凑（与天赋牌同链路，元素回退随之生效）；角色详情「技能 + 特技」两段聚合（所有关联角色统一）；检索技能命中单列「技能」组并带所属牌面；拼音索引来源补齐技能名；SKILL_TAG_ZH 单源化进 model.ts；牌面 load/error 改 document 捕获监听（修内联全局引用的 ReferenceError）；悬停概念预览按渲染实况截断（二分找最长前缀 + 省略号，只裁描述段，牌面逐级让位） |
| P7 | 技能图鉴 + 灯箱 + 打印 + 快捷键 | 已完成：「牌组工具 → 技能图鉴」整栈替换式弹层（SKILLS 投影，按所属分组、组头带所属牌面缩略，类型 chips 数据驱动含隐藏/特技，检索覆盖 名字/拼音全拼与首字母/所属/英文，IntersectionObserver 分块挂载 8 组/批）；详情卡面点击进灯箱（全屏原尺寸、←/→ 沿同级列表翻页、Esc/空白关闭，登记为第三张模态层）；「打印牌表」按钮 + `?` 打开帮助（无弹层时）+ 卡库网格方向键焦点导航（Enter 打开详情，瓦片 tabindex）；弹层同步规则细化——无条目普通层在基座上时后退不关、无条目可回退层（深链详情）视为陈旧视图始终弹出 |
| P6 | 视觉体系化 + 浅色主题 + 弹层历史 + 收藏 | 已完成：设计令牌体系（`:root` 覆盖表面/文字/金色 alpha 阶/状态/元素/字号/圆角/动效/海拔/聚焦环/z 阶梯/卡壳，TS 侧 inline 颜色全部改引变量）；浅色主题 `html[data-theme="light"]` 只覆盖令牌，切换在页头、首次跟随系统、防 FOUC 内联脚本 + theme-color 同步；动效补齐（卡面淡入、弹层退场、翻页方向感、视图 crossfade、toast 退场、骨架屏接线、空态统一、动作图标小统一 ✕/＋/⇄/★）；弹层接入浏览器历史（后退关弹层 / 前进重开 / `#t=` `#s=` 深链）；收藏系统（星标、筛选、`f=1` 分享、失效 id 清理）；`#b=` 分享链接补齐检索词（q=）解析 |

## 13. 路线图

下两项已实现（P7）；要点保留作为设计记录。

### 13.1 技能图鉴页

- **入口**：页头「牌组工具」菜单加「技能图鉴」；概念词典页技能条目区加聚合入口。
- **内容**：全部技能（角色技能 + 装备牌特技）平铺列表，复用 `47-skills.ts` 的
  `skillRowHtml`；按所属分组（角色 / 装备牌），特技用 `ownerKind==="card"` 判定。
- **筛选**：类型 chips（普攻 / 元素战技 / 元素爆发 / 被动 / 特技 / 隐藏），走 SKILL_TAG_ZH
  单源表；顶部接入与卡库一致的检索框（复用 `70-search` 的打分与拼音）。
- **呈现**：技能行带所属牌面缩略（同技能页样式），点击进技能页弹层；数据量约 600+，
  列表套用卡库的分页虚拟挂载（`makePager` / `browseTick` 同一套）。

### 13.2 卡面灯箱 + 打印增强 + 帮助快捷键

- **灯箱**：详情页 `.dimg` 点击 → 全屏遮罩展示原尺寸卡面（`imgFull`，同 URL 免二次
  下载）；←/→ 在同级列表内翻页；Esc 关闭；登记进 `core/layers` 层序。
- **打印**：`Ctrl+P` 目前只有文案提示。补打印专用视图：列表视图打印牌表（名称/费用/
  限制列，隐藏交互控件），「牌组工具」加「打印牌表」按钮触发 `window.print()`；
  `@media print` 已有基础样式（css 打印段），扩充为覆盖两种视图。
- **快捷键**：`?` 打开帮助面板（当前只能从「更多」菜单进）；卡库网格方向键移动焦点 +
  Enter 打开详情（与详情翻页键位区分：网格内先落焦，焦存在时方向键才接管）。

---

## 14. 动效中枢、路由守卫与错误面（P8）

三轮事故（滚动锁泄漏、关闭动画丢失、简介误链）的根因模式：手工动画生命周期、
约定式状态同步、靠自觉维持的文本语义。本轮把三类根因各收敛成唯一实现。

### 14.1 动效中枢（`src/core/motion.ts`）

- **`animateExit({ el, openCls, closingCls, anim, onStart, onDone })`**：退场动画生命周期的
  唯一实现——摘 openCls（层即刻算关闭）→ 挂 closingCls → `animationend` 只认 `anim` 名
  且 `ev.target === el`（子元素更早的退场会冒泡，不守卫名字会把长退场提前掐断）→
  兜底定时器 → 幂等收尾（摘 closingCls）。返回 `cancel()`（只解绑回调不动类名，
  「退场中重开」由调用方先 cancel 再摆正类名）。reduced-motion / 测试环境走瞬时路径。
- **`animationTotalMs(el)`**：从 computed style 读 `animationDuration`+`animationDelay`
  （逗号列表逐个取最大，ms/s 各自换算），兜底时长与 toast 存活期都由此推导——
  **跨文件双份硬编码（TS 280ms ↔ CSS .18s、JS 2600ms ↔ CSS 2.4s）永久消失，改 CSS 自动跟随**。
- **动效规格**：时长全部接令牌（新增 `--t-panel: .28s`；toast 存活期 `--toast-life`，
  `.err` 5s）。编排约定「退场快于入场、有位移才可感知」：`dlg-in` .28s 上浮 14px+scale(.98)、
  `dlg-out` .2s 下沉 12px+scale(.97)、`view-in` .2s 上浮 8px、灯箱 `lb-img` 缩放入场 +
  `lb-out` 退场。纯遮罩淡出在深色底上几乎不可见（旧版观感问题），位移是感知主体。
- overlay / lightbox 的开关全部走 animateExit / `setModalLayer`；toast 移除时刻由
  computed style 推导；`canHover()` 缓存 MediaQueryList（不再每次 mousemove 现查）。

### 14.2 路由与历史守卫

- **hashchange 等价判定（修「后退丢滚动」）**：`routedHash` 由 popstate 与 routeHash
  双向维护，hashchange 里 `location.hash === routedHash` 即跳过——替代旧的 skipHashRoute
  标志位（其比较基准不随 pushState 更新，空 hash 后退时失效 → routeHash→restoreView
  整页重建卡库、滚动位置丢失）。
- **在途导航守卫（`navPending`）**：back/go 异步语义、pushDepth 只在 popstate 递减——
  快速 Esc×N / 双击遮罩的重复关闭请求在途期间被直接消费（当成功处理），
  不再越界后退把用户弹出站外。popstate/hashchange 清除 + 1.5s 兜底。
- **灯箱联动**：弹层全关（popstate）时灯箱一并收掉；灯箱打开时 ←/→ 不再同时触发
  详情翻页（双渲染）。
- **`setModalLayer(id, el, open)`**（core/layers）：类名 + 层登记 + 滚动锁三件事单点成对，
  「modal 改类必须同步锁」从约定变成结构；带退场动画的关闭由 animateExit 的 onStart 解锁。
- 技能图鉴分块挂载的 IO 收敛为 `ensureSkidxIO()`：检索重挂后需要分块即重建
  （旧实现断开即弃，窄词搜索再清空后滚动加载整场失效）；无 IO 环境一次挂完。

### 14.3 错误面收口

- **运行期全局兜底**（99-main）：`window.error` + `unhandledrejection` → `reportRuntimeError`
  （console 固定前缀 `[gi-viewer]` 区分应用错误与扩展注入脚本的噪音 + 去重 err toast）。
  此前 post-boot 的未捕获异常只进控制台——这是各类隐患被放大的根因。
- **引导期横幅**：deck-viewer.html 头部内联 error 监听 → `html[data-boot-error]`，
  CSS `::before` 渲染（模块求值期全局监听尚不存在，旧版只会白屏）。
- **安全历史写入口**：`safePushState/safeReplaceState`（core/history）——Safari 30s/100 次
  限速抛 SecurityError 时只丢地址栏同步，不中断 input 处理链；应用内写入统一走它。
- **路由解码防炸**：routeHash / parseBrowseHash 全链路 try/catch + b= 分支传原始 hash
  （旧实现整体解码后再逐参解码 = 双重解码，检索词里的字面 % 会 URIError 炸断路由）。
- 存储消毒：`loadHistory` / `loadDecks` 逐条校验、丢弃畸形条目（损坏数据曾让
  面板渲染 TypeError 且永久失效）；骨架屏失败出口（`clearBrowseSkeleton`，失败不再
  shimmer 无限播放）；fetch 15s AbortController 超时；剪贴板统一走 `copyText` 兜底。

### 14.4 规则下沉第二梯队

TermEntry desc/story 下沉后，同构哑弹与散落约定的清除：

- **`PoolEntry.desc` 删除**（kind 暗示语义、零消费的哑弹）——语义按 kind 压平的字段
  就是未来的误链入口；检索走 `descAll`。
- **`ParsedCard.desc` → `.effect`**：命名即语义，`|| desc.story` 式兜底不再有诱因。
- **`conceptTextOf(entries)`**（40-concepts）：检索语料 desc+story 的唯一拼装点
  （旧 `||` 写法在双字段同时非空时静默丢 story）；70-search 两处手工拼接改调它。
- **构建期断言**：角色记录 refs 必为空（叙事文本永不产生出边）——把「refs 只扫
  effect/rules」从构建脚本一行 join 钉成构建失败。
- **`SkillEntry.desc` 删除**（与 effect 同值双写）、**`keyIdOf()`**（records.ts，
  三种 key 解析习语收敛）、**KIND_ZH 覆盖断言**（test-dataset 遍历概念索引全部 kind）、
  死代码清除（DOMAIN_ZH、47-skills 的死导入）。

### 14.5 测试与验收

- 新增 `tests/test-motion.mjs`（瞬时路径 / 兜底 / cancel / 时长解析含 ms-s 单位）；
  test-history 增至 14 节（fakeHistory `__async` 模式复现双 Esc 竞态、空 hash 后退
  结果区探针、灯箱联动、畸形 hash）；test-search 补 conceptTextOf 单元与故事词端到端
  命中；test-dataset 补下沉守护断言。
- CDP 真机验收：关闭动画采样（面板下沉 12px + 淡出 ~185ms，对比修复前 167ms 纯淡出）、
  灯箱 `.closing` 挂载/摘除、Esc×3 后 history.length 不变、后退后 scrollY 1400px 保持、
  畸形 `#b=g=%zz` 不炸路由、`Promise.reject` → err toast → 5.2s 自动移除全链路。

---

## 16. 系统化结构 + 四特性（P10）

### 16.1 注册表化（结构先行）

四个特性（机制筛选 / 分享图 / 备注核心牌 / 二维码）每一个都要接入若干
「同一枚举散落多处」的老结构，先纯重构出挂载点，再让特性以「注册表 +1 条」挂上：

- **筛选维度注册表 FILTER_DIMS**（85-views）：取值 / 放行 / 分面 / hash 编解码 /
  行渲染 / 已激活 chips 全部表驱动。原来六维散在 9 处 if 链 + 70-search 一处；
  机制筛选成为注册表首个新消费者（+1 维 +1 模块，无其它触点）。
- **导出动作注册表 EXPORT_ACTIONS**（95-export）：#exportMenu 空壳化、按钮与
  分发由注册表生成；分享图（96-share）与二维码（97-qr）作为动作挂入。
- **弹层 kind 渲染映射 OVERLAY_RENDER**（90-detail）：qr 弹层走同一注册。
- **Deck 模型 normalizeDeck 单点消毒 + v=2**：note / core 字段、副本继承、
  旧数据天然兼容（读取方一律 ?? 防御）。
- **core/image.ts**：loadImage(s)（crossOrigin + 失败解析 null）——图源已实测 ACAO:*，
  canvas 导出不污染。

### 16.2 四特性要点

- **机制筛选**（44-mechs）：curated 正则 ×9（抽牌/弃牌/治疗/护盾/召唤物/减费/
  穿透/充能/转移），匹配 desc.effect，位掩码记忆化；角色无效果文本恒不命中。
- **分享图**（96-share）：布局纯函数（可单测）+ canvas 薄层；单图 404 画 ◈ 卡壳；
  2x 缩放；深色主题同源配色独立成图。构图左对齐单栏：角色行（左）与费用分布
  （右）同一横带，避免居中角色行两侧的大片留白；绘制层每个文字点都显式设
  textAlign/textBaseline——帮助函数改写画笔状态，泄漏会把后续文字甩出画布
  （「行动牌 N 张」曾被居中甩到 x=48 之外裁成「动牌…」）。
- **备注 / 核心牌**：管理面板编辑（与重命名同构）、列表行「核」按钮（捕获委托
  抢在行点击前）、概览条「仅 1 张」提醒（确定性替代已归档的概率工具）；
  导出 / 分享图携带——活动牌组与当前解析按**内容集合**匹配（编码顺序可能不同）。
- **二维码**（97-qr）：vendor qrcode-generator@1.4.4（MIT）+ 手写 d.ts；
  内容恒为「本页地址（去旧 hash）+ #码」深链（qrContent 纯函数，与复制单卡链接
  同原理）——单文件版日后托管到网站，同一份 HTML 的扫码内容自然就是线上地址，
  不分协议降级。

### 16.2b 第二轮特性（用户点单十项）

- **门面与链接**：head 补 description / og:* / 内联 SVG favicon（og:image 依赖
  部署域名先不写）；工具栏「复制链接」= location.href + #码（qrContent 复用）。
  #t= / #s= 深链核查发现 routeHash 早已消费——提案前先 grep 现状。
- **校验违规可定位**：deckProblems 字符串数组改 { text, ids }——全局计数类问题
  没有单卡可指（ids 空 → 按钮禁用态仅展示）。
- **曲线点选**：柱条 data-odds → 卡面视图 .cost-hit 描金 + scrollIntoView，
  再点同桶取消；renderGrid 重渲染时复位（旧引用已失效）。
- **分享图核心牌描金**：activeDeckMeta 的 core 一直都在，只是没传给 png 动作。
- **最近查看（46-recent）**：showDetail 前插去重、上限 12、prune 同 favs 口径；
  横带点击复用 90-detail 的 data-goto 全局委托——先找现有机制再发明新的。
- **检索命中片段（descSnippet）**：SearchHit.descText 携带原文、渲染时切片
  高亮——描述命中此前只有一枚 chip，瓦片解释不了「为什么命中」。
- **备份/恢复**：localStorage 按 origin 隔离 → 迁移路径就是备份文件。合并语义
  只增改不删除（updatedAt 新者胜），恢复无需预确认。
- **文本导入（98-textimport）**：解析纯函数 + 检查清单（err/warn 两级，err 阻断
  载入）+ 确认弹页；载入永远创建新牌组。带【分享码】行给一键直解析（逐字节
  可靠优先于文本匹配）。
- **资源缓存（49-cache）**：Cache Storage 仅 https/localhost；命中优先 + 被动
  回填都在 core/image.ts 一个收口；全量预缓存 6 并发可中止、已缓存秒过。
- **单卡分享图（cardShareLayout）**：布局高度取决于文本量 → 测量函数作为参数
  注入纯函数（生产 ctx.measureText / 测试伪等宽），换行在布局层算好。双入口
  （导出注册表 cardpng + 详情导航钮）同走一个分发；页脚深链要解码显示并按宽
  省略——percent 编码又长又不可读，直接画会压过水印。
- **单卡图 v2 + 打印亮色 + 全局粘贴**：v2 把效果全文/技能分节/story/英文名全流
  进右栏、深链二维码（vendor 直接画矩阵，不走 SVG 栅格化）对齐卡面底边补位——
  消除低信息卡右侧的空白。打印在 @media print 里整站变量翻亮色、控件全藏、
  行不跨页，列表视图注入 print-head（CSS content 放不了动态牌组名）。全局粘贴
  （提案 3）：非输入位 paste + looksLikeCode 门（整段或提取 50+ 位 base64 段）
  → actionToast 点击才解析，解析成功自动切卡面视图；不读剪贴板 API。
- **PWA 壳（提案 2 落地）**：`pwa/`（manifest.json / sw.js / make-icons 生成的
  两张 maskable 图标）由 build-single 复制到输出目录旁——deploy-pages 上传
  `site/` 全部产物即获得安装与离线能力。sw.js 只拦**文档导航**且 network-first：
  在线永远最新（数据快照内联在 HTML，cache-first 会把数据冻结在首次访问的那次
  部署），离线回落最近成功的 HTML。注册在 51-pwa：isSecureContext 门
  （file:// / 不支持环境零动作，注册失败静默）+ 版本提示（skipWaiting 会让新版本
  抢在页面挂上 updatefound 监听之前完成接管，故以 controllerchange 为准：求值时
  有旧控制器、随后易主 → actionToast「刷新更新」；首装 claim 不误报）+
  visibilitychange 时 update()（长开页签也能发现新部署）。**与导入导出的兼容**：备份/分享图下载、文件恢复、剪贴板、
  粘贴解析全是页面内行为或非导航请求，SW 不参与；localStorage 按 origin 存，
  安装前后数据连续；49-cache（gi-card-art-v1）与壳缓存（gi-shell-v1）是两个
  独立的 Cache Storage；断网打开的是最近一次部署的快照，导出基于它属预期；
  file:// 单文件版与线上 PWA 存储隔离，迁移走备份/恢复（既有能力）。
- **单卡图卡面随天然比例 + cover 裁切**：用户报告 1:1 牌面在导出里被拉伸。
  全库排查（1499 张有脸记录逐张探测真实像素）：角色/行动牌全部 420:720，
  **1:1 的只有技能牌面（577 张，且多为 128px 小图）**；导出管线 drawImage
  直拉进硬编码 420:720 框，任何非该比例的源（缓存旧图 / 未来素材 / 技能）
  都会拉伸。修法对齐应用既有语义：drawCellImage 改 object-fit:cover 中心裁切
  （卡库瓦片同款，等比源像素级不变）；单卡图先取图后布局，cardArtSize 按图片
  天然比例给 artH（详情 .dimg height:auto 同语义），卡面零裁切零拉伸，并补上
  详情同款圆角 12 + gold-30 细边；无图回落 420:720 卡壳框（.noart 同语义）。
  真机验收：注入 1:1 图进缓存后导出 → 260×260 方框原比例呈现、右栏流式自适应。
- **测试牌构建期剔除 + 卡面缓存升版**：用户确认测试牌不应入数据。isTestCard
  标记（名称含（test）括号式）与 45-pool 的卡池过滤自始就有，但记录一直留在
  数据集里当死重——改为 kept 阶段直接剔除（2699→2694，无技能归属、无依赖
  引用，卡池计数不变 1480/629/851），构建校验公式同步扣测试牌；运行时
  flags.test 过滤保留作纵深防御。**队伍状态拉伸的实测来源 = 卡面缓存旧条目**：
  CDN 素材更新后命中优先的旧图永不刷新（cache.add 对已有 key 秒过）——缓存名
  升 v1→v2 一次性作废，看过的卡被动回填、可重新全量预缓存。不可构筑牌导出
  顺带核验：卡池本就收录全部 poolable 实体（含召唤物/状态），详情导出钮无条件
  渲染，#card= 深链正常打开并出图（魔蝎祝福 420:720 ✓，注入 1:1 → 260×260 ✓）；
  测试牌深链 → 「id 不存在或已失效」。
- **无牌面实体导出与详情同款**：imgFull 对无牌面实体（hasFace=false）返回的是
  **圆盘图标**（128px 级方图）——此前被导出当牌面拉进 420:720，是「队伍状态
  拉伸」的另一半根因（用户截图月之领域点破）。导出按 hasFace 分流：有牌面 =
  .dimg 语义（天然比例 + 金边圆角）；无牌面 = .noart-detail 卡壳——四类配色
  （art.kind 与 CSS data-kind 同名，types 随数据拓宽）+ 渐变底/顶部光晕/45°
  斜纹/虚线内框/顶部色条与类型字/圆盘图标 contain 82%，取图失败只剩 ◈。右栏
  同步对齐详情：field 域加「对局实体」说明（dnote 同文）、正文后收尾「被引用」
  反链分节（backlinks 表 → 引用者名去重）。可用次数本就在 effect 文本内。
- **导出分节与详情全面对齐**：右栏顺序改为详情同构——meta（费用/属性）→
  英文名 → story → 实体说明 → 限制分组（头部带 dim 提示「加入牌组需满足 / 对局
  中生效」，rgroup rghint 同义）→ 正文 → 被引用收尾。story（语音/flavor）统一
  为 meta 后的 dim 引文（详情 dstory 同位，无「」包裹）：详情卡牌分支原本不
  展示 flavor，应用户要求补上 dstory、导出同位保留；装备牌特技分节补齐
  （详情 skillsHtmlCard 同源，skillsOf 按所属 id 取）。
- **数据同步 v7.2（官方更新）**：piovium 三份原始 JSON 重抓（+1 角色 法尔伽 /
  +34 实体 / +4 关键词，9 条修改——黑蛇骑士 HP 10→12、冰草/超载祝佑文案等；
  玛薇卡/克洛琳德仅 keyMap 清理无文本变化）；genshin-db 上游「7.2 actual」
  对全量文件重排版但 JSON 内容不变，只最小同步 43 新 + 6 改文件进 vendor，
  避免 2604 个文件的排版噪声。concepts-extra 432→433；数据集 2694→2739
  （156 角色 / 1376 卡牌 / 606 技能 / 601 术语，有牌面 1520，测试 0）。
  新机制「藏品」（3 个可收集召唤物）与「燃烧祝佑/元素幻变」全部随既有管线
  自动落位：详情（v7.2.0 徽标、flavor、技能、反链）、卡库（可构筑/卡壳）、
  概念索引、单卡导出零代码改动。test-deps 覆盖计数断言 154→157（+3 需角色：
  升华赞歌→杜林、法尔伽两张天赋）。上游 API：`/api/v5/data/latest/CHS/{category}`。

### 16.3 坑

- build-app 缓存指纹只收集 src/gi-data——**vendor 改动不失效缓存**，产物陈旧
  却查不出原因；指纹补上 vendor。
- qrcode-generator 自带 createImgTag 的 `<img src="` 模板会误触产物完整性检查
  「无本地图片引用」；摘除未使用的两个方法。
- 多行 CSS 规则按行删会撕裂规则体（大括号失衡暴露）；删 CSS 按块删。
- SW activate 清理旧缓存若不过滤，**会把 49-cache 的卡面缓存一起删掉**——
  必须按 `gi-shell-` 前缀过滤（PWA 缓存与应用缓存的边界，test-single 有断言）。
- build-single 的「残留外部引用」自检会把 manifest/图标链接当漏内联拦下
  （exitCode 1）——PWA 伴生文件是刻意不内联的同目录引用，自检白名单放行。
- canvas `drawImage(img, x, y, w, h)` 是**拉伸语义**不是裁切——固定框 + 任意
  比例源图必然变形；要么框随天然比例（单卡图），要么 cover 中心裁切（瓦片 /
  网格）。数据集记录没有顶层 id，数字 id 在 key 里（`card:81` → 81）——
  按 r.id 取会拿到 undefined，探测脚本整批 404。无牌面实体的 imgFull(id)
  不是 404 而是圆盘图标——「图能加载」不等于「它是牌面」，先看 art.hasFace。
  types 的 Art.kind 声明比数据集实际取值窄（缺 state/summon/team/attach）——
  类型与数据对齐前先查构建脚本写入的值域。

## 15. 信息架构重排 · 主题三态 · 回合模拟（P9）

### 15.1 导航归属原则

- **全局动作 → 页头图标按钮**（悬浮 title 说明）：主题三态 / 刷新数据 / 数据信息 / 帮助。
  原「更多」菜单解散——全局功能收进菜单要多点一层，图标钮一步直达。
- **牌组功能 → 牌组工具菜单**：历史 / 加载示例牌组 / 牌组对比 / 抽牌概率 / 打印牌表
  （示例牌组从「更多」归位到这里——它是牌组动作）。
- **资料查询 → 独立主页签**：技能图鉴从牌组工具升为第 4 视图（快捷键 4），
  不再是整栈替换式弹层：IntersectionObserver root 改视口、委托容器改 `#view-skills`、
  无 navBar；`#s=` 深链落在图鉴视图之上（技能页 Esc/后退回图鉴）。
  OverlayEntry 的 `skillidx` 变体与 renderOverlay 分发随之移除。

### 15.2 主题三态

`auto | light | dark`（存储 key 不变，默认 auto）。`data-theme` 始终写**解析结果**
（CSS 只认 light 属性），模式持久化；auto 用 matchMedia 实时监听、系统切换即时生效。
按钮循环三态、图标随模式（◐/☀/☾）、title 注明当前解析值。头部 FOUC 脚本同步三态。

### 15.3 抽牌概率与回合模拟（86-odds）【已归档】

> **2026-10-31 归档**：概率/模拟的估计口径对实际对局过于粗略与乐观（不模拟效果触发、
> 费用互相占用与对局取舍），对用户的实际决策价值有限，整体移除（菜单入口、面板、
> 概率与模拟模型）。完整实现保留在提交 26727a8 及更早历史中；概览条里的
> 「元素骰费用曲线」保留为静态可视化。以下为归档时的设计记录。

在超几何精确值之下新增蒙特卡洛面板，规则常量全部来自官方规则词条
（build-concepts.mjs 人工校订表）：起手 5 张、每回合抓 2 张、每回合投 8 枚元素骰
（万能 1/8，不继承）、元素调和（弃 1 手牌转 1 骰色）、秘传必在起手。
不模拟：效果触发、充能（费用中的充能视作可满足）、调度、重投。

- 纯函数（测试导出面）：`parseCost`（充能/秘传位剔除、元素/万能归一）、
  `minTunes`（支付费用的最少调和次数 = 需求元素子集的最大缺口，万能骰先补）、
  `simTurns`（mulberry32 带种子 → 确定性；每回合 抽 2 → 手中有目标牌则投 8 骰判可打出；
  含调和 / 不调和共用同一批骰子抽样，配对比较）。
- 「可打出」语义：目标牌当作该回合第一优先支出，不含先打其它牌的占用。
- UI：回合 0–8 表（到手 / 可打出·含调和 / 可打出·不调和 / 平均手牌），
  到手列与超几何行互证（2 万次抽样噪声 ≈0.35%，测试容差 1.5%）。
