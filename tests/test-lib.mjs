/* 测试端源码加载器。
 *
 * 应用源码是标准 ESM 依赖图；这里把它打成 IIFE 供测试在受控作用域里执行，
 * 并把 src/test-api.ts 的导出面挂到全局（只读、活绑定），让断言可以继续用裸标识符。
 *
 * 关键点：全局暴露只发生在**测试进程**里，生产入口 src/main.ts 没有任何全局变量。
 * 测试执行的是与浏览器一致的那份依赖图，不是另拼的源码。 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(here, "dist/.cache");
const TEST_BUNDLE = path.join(CACHE, "test-api.js");

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

function ensureTestBundle() {
  const needsRebuild =
    !fs.existsSync(TEST_BUNDLE) ||
    fs.statSync(TEST_BUNDLE).mtimeMs <
      Math.max(newestMtime(path.join(here, "src")), newestMtime(path.join(here, "gi-data")));
  if (!needsRebuild) return;

  const r = spawnSync(
    process.execPath,
    [
      path.join(here, "node_modules/esbuild/bin/esbuild"),
      path.join(here, "src/test-api.ts"),
      "--bundle",
      "--format=iife",
      "--global-name=TEST_API",
      "--target=es2022",
      "--charset=utf8",
      `--outfile=${TEST_BUNDLE}`,
    ],
    { cwd: here, encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error("构建测试包失败：\n" + (r.stderr || r.stdout || ""));
}

/** 返回可直接拼进 `new Function` 的脚本：
 *  IIFE 包（执行应用） + 把导出面挂为只读全局（活绑定，反映模块内部的最新值）。 */
export function readAppSource() {
  ensureTestBundle();
  const bundle = fs.readFileSync(TEST_BUNDLE, "utf8");
  const expose = `
for (const k of Object.keys(TEST_API)) {
  if (k === "default") continue;
  Object.defineProperty(globalThis, k, {
    configurable: true,
    get: () => TEST_API[k],
  });
}
`;
  return bundle + "\n" + expose;
}
