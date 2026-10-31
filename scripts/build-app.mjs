#!/usr/bin/env node
/* 应用脚本构建：TypeScript ESM 依赖图 → 单个 IIFE 包。
 *
 *   node scripts/build-app.mjs
 *
 * 产物：
 *   dist/app.js  供 deck-viewer.html 与单文件版共用
 *
 * 为什么打成一个 IIFE 而不是多个模块：单 HTML 需要把脚本内联进 <script>，
 * 而 <script type="module"> 在 file:// 下受 CORS 限制、内联模块也无法用相对路径
 * 引资源。IIFE 是"能在 file:// 双击打开"的最简形式。
 * 源码本身是标准 ESM，模块边界不受这个打包格式影响。 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { APP_ENTRY } from "./sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "dist");
const CACHE_DIR = path.join(OUT_DIR, ".cache");
const BUNDLE_OUT = path.join(CACHE_DIR, "app.bundle.js");
const APP_OUT = path.join(OUT_DIR, "app.js");

fs.mkdirSync(CACHE_DIR, { recursive: true });

const readIfExists = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");

/** 收集参与打包的所有文件（src / gi-data / vendor 下的 TS/JS 资产），用于判断缓存是否失效。 */
function collect(dir, exts = [".ts", ".js"]) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) out.push(...collect(p, exts));
    else if (exts.some((e) => name.name.endsWith(e))) out.push(p);
  }
  return out;
}

const inputs = [
  ...collect(path.join(ROOT, "src")),
  ...collect(path.join(ROOT, "gi-data"), [".js"]),
  ...collect(path.join(ROOT, "vendor"), [".js"]),
].sort();
const fingerprint = crypto
  .createHash("md5")
  .update(inputs.map((p) => p + ":" + fs.statSync(p).mtimeMs).join("|"))
  .digest("hex");
const stampPath = path.join(CACHE_DIR, "stamp");

if (readIfExists(stampPath) !== fingerprint || !fs.existsSync(BUNDLE_OUT)) {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, APP_ENTRY)],
    bundle: true,
    format: "iife",
    target: ["es2022"],
    charset: "utf8",
    minify: false,
    legalComments: "none",
    write: false,
    logLevel: "silent",
  });
  if (!result.outputFiles || !result.outputFiles[0]) throw new Error("esbuild 未产出任何文件");
  fs.writeFileSync(BUNDLE_OUT, result.outputFiles[0].text, "utf8");
  fs.writeFileSync(stampPath, fingerprint, "utf8");
  console.log(`dist/app.js ${(Buffer.byteLength(result.outputFiles[0].text) / 1024).toFixed(1)} KB`);
} else {
  console.log(`dist/app.js 缓存命中（${(Buffer.byteLength(readIfExists(BUNDLE_OUT)) / 1024).toFixed(1)} KB）`);
}

fs.copyFileSync(BUNDLE_OUT, APP_OUT);
