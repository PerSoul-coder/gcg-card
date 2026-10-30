/* 一次性迁移辅助：列出测试里对"被导出符号"的直接赋值。
 * 这些赋值在 ESM 下都非法（导出绑定只读），需要改成公开函数或 state 字段。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TESTS = path.join(ROOT, "tests");

/* 全部导出符号：从源码的 export 语句里取 */
const exported = new Set();
for (const dir of ["src", "src/core", "src/data"]) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    if (!f.endsWith(".ts")) continue;
    const code = fs.readFileSync(path.join(ROOT, dir, f), "utf8");
    for (const m of code.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) exported.add(m[1]);
    for (const m of code.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const s of m[1].split(",")) {
        const name = s.trim().split(/\s+as\s+/).pop();
        if (name) exported.add(name);
      }
    }
  }
}

const hits = new Map();
for (const f of fs.readdirSync(TESTS)) {
  if (!/^test-.*\.mjs$/.test(f) || f === "test-single.mjs") continue;
  const lines = fs.readFileSync(path.join(TESTS, f), "utf8").split("\n");
  lines.forEach((line, i) => {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*(?:=[^=]|\+\+|--)/.exec(line);
    if (!m) return;
    const name = m[1];
    if (!exported.has(name)) return;
    if (!hits.has(name)) hits.set(name, []);
    hits.get(name).push(`${f}:${i + 1}`);
  });
}

if (!hits.size) console.log("没有对导出符号的直接赋值");
for (const [name, where] of [...hits].sort()) console.log(name.padEnd(18), where.join("  "));
