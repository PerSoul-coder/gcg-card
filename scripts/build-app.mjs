#!/usr/bin/env node
/* 应用脚本构建：TypeScript 入口 → 单个 IIFE 包 → 拼接尚未迁移的旧脚本。
 *
 *   node scripts/build-app.mjs
 *
 * 产物：
 *   dist/app.js        供 deck-viewer.html 与单文件版共用（迁移完成后为纯 TS 产物）
 *   dist/.cache/bridge.js.md5   入口包指纹（命中则跳过 esbuild，仅供开发期省时）
 *
 * 为什么拼成一个文件而不是多模块：产物要能内联进单 HTML 并在 file:// 下运行，
 * 且测试 harness 需要在同一作用域里访问应用符号。IIFE 绑定的模块符号由 bridge
 * 挂到 globalThis，拼在其后的旧脚本仍以裸标识符访问，语义不变。 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { APP_ENTRY, LEGACY_SOURCES } from "./sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "dist");
const CACHE_DIR = path.join(OUT_DIR, ".cache");
const BUNDLE_OUT = path.join(CACHE_DIR, "bridge.js");
const APP_OUT = path.join(OUT_DIR, "app.js");

fs.mkdirSync(CACHE_DIR, { recursive: true });

const readIfExists = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");

/* ---------- 1. 收集入口依赖，判断是否需要重新打包 ---------- */
function collectTsFiles(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) out.push(...collectTsFiles(p));
    else if (name.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const tsFiles = collectTsFiles(path.join(ROOT, "src")).sort();
const fingerprint = crypto
  .createHash("md5")
  .update(tsFiles.map((p) => p + ":" + fs.statSync(p).mtimeMs).join("|"))
  .digest("hex");
const stampPath = path.join(CACHE_DIR, "stamp");

const legacyParts = LEGACY_SOURCES.map((p) => readIfExists(path.join(ROOT, p)));
const legacyText = legacyParts.join("\n\n");

/* ---------- 2. 打包入口（带回退：esbuild 失败时直接报错，不产出半成品） ---------- */
const cached = readIfExists(stampPath) === fingerprint && fs.existsSync(BUNDLE_OUT);
if (!cached) {
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
}

const bundleText = readIfExists(BUNDLE_OUT);

/* ---------- 3. 拼接并写出 ---------- */
const appText =
  "/* 本文件由 scripts/build-app.mjs 生成，请勿手工编辑。 */\n" +
  bundleText +
  (legacyText ? "\n\n/* ==== 尚未迁移的旧脚本（LEGACY_SOURCES） ==== */\n" + legacyText : "") +
  "\n";

fs.writeFileSync(APP_OUT, appText, "utf8");

const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log(
  `dist/app.js ${kb(Buffer.byteLength(appText))}` +
    `（入口包 ${kb(Buffer.byteLength(bundleText))}${cached ? "，缓存命中" : ""}` +
    ` + 旧脚本 ${LEGACY_SOURCES.length} 个 ${kb(Buffer.byteLength(legacyText))}）`,
);
