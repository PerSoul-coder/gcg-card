/* 一次性迁移辅助：把旧脚本转换成 ESM 模块（加 import 头、export 尾）。
 * 只做结构性变换，不改任何逻辑——逻辑改造在转换后按编译错误逐处处理。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const graph = JSON.parse(fs.readFileSync(path.join(ROOT, ".build-tools/graph.json"), "utf8"));

const header = (src) => `/* ${src} —— 由 scripts/_convert.mjs 从旧脚本转换（迁移中间态）。 */\n`;

for (const [file, info] of Object.entries(graph)) {
  const orig = fs.readFileSync(path.join(ROOT, file), "utf8");

  /* 去掉过时的"加载顺序"说明与 use strict（模块内无意义） */
  const body = orig
    .replace(/^\/\*[\s\S]*?\*\/\n/, "")
    .replace(/^\s*"use strict";\s*$/m, "")
    .replace(/^\s*源码按领域拆分.*$/gm, "")
    .replace(/^\s*由 src\/sources\.mjs.*$/gm, "")
    .replace(/^\s*\/\* 七圣召唤浏览器.*\*\//gm, "")
    .trim();

  const importLines = Object.entries(info.imports)
    .map(([owner, syms]) => {
      const target = "./" + path.basename(owner).replace(/\.js$/, "");
      return `import { ${syms.join(", ")} } from "${target}";`;
    })
    .join("\n");

  const exportLine = info.declares.length
    ? `\nexport { ${info.declares.join(", ")} };\n`
    : "";

  const out = path.join(ROOT, file.replace(/\.js$/, ".ts"));
  fs.writeFileSync(out, header(file) + (importLines ? importLines + "\n\n" : "") + body + "\n" + exportLine, "utf8");
  console.log("转换", file, "→", path.relative(ROOT, out), importLines ? `(${importLines.split("\n").length} 个 import)` : "");
}
