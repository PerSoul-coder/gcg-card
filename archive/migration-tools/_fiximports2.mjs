/* 一次性迁移辅助：按"全部模块的导出"补齐缺失 import。
 * 只处理值导出（函数 / 常量 / 类）；interface 与 type 别名不参与，避免运行时空导入。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".ts"));
const SKIP = new Set(["main.ts", "test-api.ts"]);

/* name → 模块（相对 src 的路径，不含扩展名） */
const owner = new Map();
const declaredIn = new Map(); /* file → Set<name> */

for (const f of files) {
  const code = fs.readFileSync(path.join(SRC, f), "utf8");
  const local = new Set();
  const names = new Set();

  /* 本地声明（含未导出的内部函数），用于判断"该名字是不是本文件自己的" */
  for (const m of code.matchAll(/^(?:export\s+)?(?:async\s+)?(function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    local.add(m[2]);
  }
  /* 仅 export 开头的声明才进入对外导出表 */
  for (const m of code.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  /* export { A, B as C } —— 只取值导出（interface/type 不会出现在这里） */
  for (const m of code.matchAll(/^export\s*\{([^}]*)\};?$/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  declaredIn.set(f, local);
  for (const n of names) if (!owner.has(n)) owner.set(n, "./" + f.replace(/\.ts$/, ""));
}

let touched = 0;
for (const f of files) {
  if (SKIP.has(f)) continue;
  const p = path.join(SRC, f);
  let code = fs.readFileSync(p, "utf8");

  const imported = new Set();
  for (const m of code.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from/g)) {
    for (const s of m[1].split(",")) {
      const n = s.trim().split(/\s+as\s+/).pop();
      if (n) imported.add(n);
    }
  }
  const local = declaredIn.get(f);
  const byModule = new Map();
  for (const [n, mod] of owner) {
    if (mod === "./" + f.replace(/\.ts$/, "")) continue;
    if (local.has(n) || imported.has(n)) continue;
    if (!new RegExp(`(?<![.\\w$])${n.replace(/\$/g, "\\$")}\\b`).test(code)) continue;
    if (!byModule.has(mod)) byModule.set(mod, []);
    byModule.get(mod).push(n);
  }
  if (!byModule.size) continue;

  const lines = [...byModule].map(([mod, ns]) => `import { ${ns.sort().join(", ")} } from "${mod}";`).join("\n");
  const lastImport = code.lastIndexOf("\nimport ");
  if (lastImport >= 0) {
    const end = code.indexOf("\n", code.indexOf(";", lastImport));
    code = code.slice(0, end + 1) + lines + "\n" + code.slice(end + 1);
  } else {
    const head = code.match(/^\/\*[\s\S]*?\*\/\n/);
    const at = head ? head[0].length : 0;
    code = code.slice(0, at) + lines + "\n" + code.slice(at);
  }
  fs.writeFileSync(p, code, "utf8");
  touched++;
  console.log("补 import", f, `(+${byModule.size} 组)`);
}
console.log("处理文件数:", touched);
