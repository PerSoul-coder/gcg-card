/* 测试端源码加载器：按 src/sources.mjs 的声明拼接多文件源码。
   应用脚本依赖的资源（拼音索引 / 概念库 / 官方元素图标）也一并前置，
   保证 Node 端与浏览器端的全局变量环境一致。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_SOURCES, ASSET_SOURCES } from "../src/sources.mjs";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* 统一数据集：Node 环境没有 fetch(file://) 与稳定的 Brotli 流解码，
   直接把构建产物注入全局，让运行时数据层与浏览器走同一套读取逻辑。 */
const datasetPath = path.join(here, "gi-data/dataset.json");
if (fs.existsSync(datasetPath)) {
  globalThis.__DATASET_JSON = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
}

export function readAppSource({ withAssets = true } = {}) {
  const parts = [];
  if (withAssets) {
    for (const p of ASSET_SOURCES) parts.push(fs.readFileSync(path.join(here, p), "utf8"));
  }
  for (const p of APP_SOURCES) parts.push(fs.readFileSync(path.join(here, p), "utf8"));
  return parts.join("\n\n");
}
