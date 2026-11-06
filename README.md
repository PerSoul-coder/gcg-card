# 七圣召唤 · 卡牌与牌组浏览器

纯前端单页应用：查卡、组牌、解析与生成牌组分享码。无运行时框架、无后端；Node 只用于构建数据与跑回归测试。

| 方式 | 入口 | 说明 |
| --- | --- | --- |
| 在线版（GitHub Pages） | <https://persoul-coder.github.io/gcg-card/> | 推送到 `master` 自动构建发布；可安装为 PWA，离线打开最近一次部署 |
| 离线单文件（推荐分享） | `dist/七圣召唤-卡牌与牌组浏览器.html` | 约 1.0 MB，样式 / 脚本 / 数据包全部内联，双击即开、断网可用 |
| 多文件开发版 | 根目录 `deck-viewer.html` | 加载构建产物 `dist/app.js`，便于调试 |

## 功能

- **卡库浏览**：多维筛选（类别 / 元素 / 费用 / 标签 / 版本 / 机制）、两阶段检索（中文 / 拼音 / 描述）、不可构筑条目折叠分组、分页 + 视口外卸载。
- **查卡**：详情弹层（技能 / 特技 / 限制 / flavor / 被引用）、概念词典逐层下钻、技能图鉴、最近查看记忆条、概念链接悬浮预览。
- **组牌**：分享码解析与生成、构筑校验（限制 / 费用 / 上限，违规点击定位）、多牌组管理（备注 / 核心牌 / 备份恢复 / 文本牌表导入）、费用曲线。
- **对比**：多卡横向对比（仅看差异 / 相似卡替换）、两套牌组差异分析。
- **分享**：牌组分享图（PNG，核心牌描金）、单卡分享图（卡池全部条目可导出，随主题深浅）、分享码二维码（本页深链）、复制链接。
- **体验**：主题三态、字号三档、深浅色安全区适配、长按/右键菜单系统（子级 + 全键盘导航）、移动端触控适配、PWA。

细节设计（数据模型、构建流程、检索 / 呈现 / 浮层 / 性能实测的完整记录）见 [docs/DESIGN.md](docs/DESIGN.md)。

## 开发

```powershell
npm install
npm run check          # tsc --noEmit
npm run build          # 打包 dist/app.js + 生成 dist 单文件
npm test               # Node 回归测试（18 个文件）
```

开发版预览（`file://` 下数据请求受限，走本地静态服务器）：

```powershell
npm run build:app
python -m http.server 8080
# 打开 http://localhost:8080/deck-viewer.html
```

## 数据管线与更新

```powershell
node scripts/build-concepts.mjs   # genshin-db 快照 → gi-data/concepts-extra.{json,js}
node scripts/build-icons.mjs      # assets 矢量 → gi-data/element-icons.js
node scripts/build-dataset.mjs    # 四份来源 → gi-data/dataset.{json,gz,br,meta.json}
node scripts/build-single.mjs     # 输出单文件（--out= 可自定义路径）
```

依赖顺序：`build-concepts` → `build-icons` → `build-dataset` → `build-single`。

官方发新卡时的数据同步：从 piovium 重抓三份原始 JSON（`/api/v5/data/latest/CHS/{characters,entities,keywords}`）覆盖 `gi-data/` 对应文件，必要时同步 genshin-db 快照，然后按上面顺序重跑管线。判定（影子 / 镜像 / 可构筑 / 可链接 / 出边 / 拼音）全部在构建期一次算好，运行时只读。

## 部署与 PWA

推送到 `master` 触发 GitHub Actions（`.github/workflows/deploy-pages.yml`）：`npm ci` → 打包 → `build-single --out=site/index.html` → 部署 Pages，全程无本地操作。

部署产物是「一壳四件」：`index.html` + `manifest.json` / `sw.js` / 两张图标（`build-single` 自动从 `pwa/` 复制）。`sw.js` 只拦文档导航且 network-first：在线永远最新，断网回落最近一次部署；新版本部署后回到标签页会提示刷新。导入导出 / 分享图下载 / 剪贴板均不经 SW，行为不变；卡面缓存与 SW 壳缓存是独立的 Cache Storage。

## 目录结构

```
.
├─ .github/workflows/        GitHub Pages 部署
├─ deck-viewer.html / .css   多文件开发入口与全局样式（设计令牌在 :root）
├─ src/                      应用源码（TypeScript，标准 ESM）
│  ├─ main.ts                入口（仅固定模块求值次序）
│  ├─ core/                  gesture 指针引擎 / menu 菜单组件 / motion 动效 / dom / resources
│  ├─ data/                  model 分类与身份判定 / records 运行时查表 / state
│  ├─ 07-dataset … 98-       按编号的功能模块（数据加载 / 编解码 / 检索 / 牌组 / 视图 / 对比 / 详情 / 导出 / PWA …）
│  ├─ types.ts               数据集与界面共用的类型契约
│  └─ test-api.ts            测试专用导出面（不进浏览器产物）
├─ gi-data/                  构建期输入（piovium 三份原始 JSON / genshin-db 补充概念）与产物（dataset.*）
├─ scripts/                  构建脚本（dataset / concepts / icons / app / single / icons 生成）
├─ tests/                    Node 回归测试
├─ docs/DESIGN.md            数据与架构设计全记录
├─ pwa/                      PWA 壳源件（manifest / sw.js / 图标）
├─ assets/                   原始素材（七元素矢量 SVG）
└─ vendor/                   构建期依赖的快照（genshin-db-data / qrcode）
```

不入库的本地目录：`archive/`（旧版源码与历史文件，仅本机追溯）、`vendor/genius-invokation/`（分享码编解码上游的参考快照，出处见下）、`dist/` `site/`（构建产物）、`publish/`。

## 数据来源与许可

- 卡牌数据：piovium 静态数据服务 `https://static-data.piovium.org/api/v5`（仅构建期读取）。
- 规则与术语释义：[theBowja/genshin-db](https://github.com/TheBowja/genshin-db) 中文快照。
- 拼音：`pinyin-pro` 构建期写入记录别名，运行时零依赖。
- 代码许可 AGPL-3.0（全文见 `LICENSE`）；分享码编解码逻辑移植自 [genius-invokation](https://github.com/piovium/genius-invokation) `@gi-tcg/assets-manager`（同许可，参考快照不入库）。
- 原神及七圣召唤相关素材版权归米哈游 / HoYoverse 所有，本项目仅用于非商业的资料查阅与牌组整理。
