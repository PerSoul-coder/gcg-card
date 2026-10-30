/* 一次性迁移辅助：计算 17 个旧脚本的符号归属与跨文件依赖。
 * 旧代码共享一个全局词法作用域，因此符号名全局唯一——这使自动生成 import/export 可行。
 * 输出 JSON 到 stdout，供人工核对后驱动转换。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = fs.readFileSync(path.join(ROOT, "scripts/sources.mjs"), "utf8")
  .split("LEGACY_SOURCES = [")[1].split("]")[0]
  .match(/"([^"]+)"/g).map(s => s.slice(1, -1));

/* 去掉注释与字符串，避免把文案里的词误判成标识符 */
function strip(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

/* 顶层声明：function / const / let / var（含一行多个声明符） */
function decls(code) {
  const out = [];
  const lines = code.split("\n");
  for (const line of lines) {
    const m = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (m) { out.push(m[1]); continue; }
    const d = /^(?:const|let|var)\s+/.exec(line);
    if (!d) continue;
    let rest = line.slice(d[0].length);
    let depth = 0, seg = "";
    const push = (s) => {
      const nm = /^\s*([A-Za-z_$][\w$]*)\s*(?:=|,|;|$)/.exec(s);
      if (nm) out.push(nm[1]);
    };
    for (const ch of rest) {
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth--;
      if (ch === "," && depth === 0) { push(seg); seg = ""; continue; }
      seg += ch;
    }
    push(seg);
  }
  return [...new Set(out)];
}

const owner = new Map();
const perFile = new Map();
for (const f of FILES) {
  const code = fs.readFileSync(path.join(ROOT, f), "utf8");
  const names = decls(strip(code));
  perFile.set(f, names);
  for (const n of names) {
    if (owner.has(n)) console.error(`重复符号 ${n}: ${owner.get(n)} / ${f}`);
    owner.set(n, f);
  }
}

const result = {};
for (const f of FILES) {
  const code = strip(fs.readFileSync(path.join(ROOT, f), "utf8"));
  const own = new Set(perFile.get(f));
  const used = new Map();
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    const id = m[1];
    const o = owner.get(id);
    if (!o || o === f || own.has(id)) continue;
    if (!used.has(o)) used.set(o, new Set());
    used.get(o).add(id);
  }
  result[f] = {
    declares: perFile.get(f),
    imports: Object.fromEntries([...used].map(([o, s]) => [o, [...s].sort()])),
  };
}

console.log(JSON.stringify(result, null, 1));
