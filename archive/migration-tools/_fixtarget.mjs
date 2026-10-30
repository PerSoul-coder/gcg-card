/* 一次性：把 ev.target.xxx 收敛为带类型的元素访问。
 * EventTarget 上没有 closest/value/dataset，先断言成 HTMLElement 再访问。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "src");

let total = 0;
for (const f of fs.readdirSync(SRC)) {
  if (!f.endsWith(".ts")) continue;
  const p = path.join(SRC, f);
  let code = fs.readFileSync(p, "utf8");
  const before = code;

  /* 已经断言过的不重复处理 */
  code = code.replace(/(?<!as HTMLElement\)\s*)\b(ev|e|event)\.target\./g, "($1.target as HTMLElement).");
  /* 读 target 并断言非空：ev.target 在某些分支当元素用 */
  if (/\((\w+)\.target as HTMLElement\)/.test(code)) {
    total++;
  }

  if (code !== before) {
    fs.writeFileSync(p, code, "utf8");
    console.log("收敛事件目标", f);
  }
}
console.log("涉及文件:", total);
