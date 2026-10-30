/* 测试端源码加载器。
 *
 * 迁移前：拼接 20 个 src/*.js 源文件。
 * 迁移后：拼接「资源脚本 + dist/app.js（TS 入口包 + 尚未迁移的旧脚本）」，
 * 与应用在浏览器里的执行顺序完全一致——测试跑的就是真实产物，不是另一套拼装。
 *
 * 产物落后于源码是常见故障，这里按 mtime 判断并在需要时重建，避免测试验证陈旧代码。 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ASSET_SOURCES, LEGACY_SOURCES } from "../scripts/sources.mjs";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PATH = path.join(here, "dist/app.js");

/* 统一数据集：Node 环境没有 fetch(file://) 与稳定的 Brotli 流解码，
   直接把构建产物注入全局，让运行时数据层与浏览器走同一套读取逻辑。 */
const datasetPath = path.join(here, "gi-data/dataset.json");
if (fs.existsSync(datasetPath)) {
  globalThis.__DATASET_JSON = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
}

function newestMtime(dir) {
  let newest = 0;
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) newest = Math.max(newest, newestMtime(p));
    else if (/\.(ts|js)$/.test(name.name)) newest = Math.max(newest, fs.statSync(p).mtimeMs);
  }
  return newest;
}

function ensureAppBuilt() {
  const srcNewest = Math.max(
    newestMtime(path.join(here, "src")),
    ...LEGACY_SOURCES.map((p) => {
      const f = path.join(here, p);
      return fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0;
    }),
  );
  const appMtime = fs.existsSync(APP_PATH) ? fs.statSync(APP_PATH).mtimeMs : 0;
  if (appMtime >= srcNewest) return;
  const r = spawnSync(process.execPath, [path.join(here, "scripts/build-app.mjs")], {
    cwd: here,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error("构建 dist/app.js 失败：\n" + (r.stderr || r.stdout || ""));
  }
}

export function readAppSource({ withAssets = true } = {}) {
  ensureAppBuilt();
  const parts = [];
  if (withAssets) {
    for (const p of ASSET_SOURCES) parts.push(fs.readFileSync(path.join(here, p), "utf8"));
  }
  parts.push(fs.readFileSync(APP_PATH, "utf8"));
  return parts.join("\n\n");
}
