/* 一次性：state.current 的访问收敛。
 * state.current 现在有精确类型（ParsedDeck | null），渲染路径都以"已解析"为前提，
 * 与重构前的 JS 行为一致——为空的后果同样是抛错并由上层 try/catch 接住。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "src");

let total = 0;
for (const f of fs.readdirSync(SRC)) {
  if (!f.endsWith(".ts")) continue;
  const p = path.join(SRC, f);
  let c = fs.readFileSync(p, "utf8");
  const before = c;
  c = c.replace(/(?<!!)\bstate\.current\./g, "state.current!.");
  if (c !== before) {
    fs.writeFileSync(p, c, "utf8");
    total += (before.match(/(?<!!)\bstate\.current\./g) || []).length;
    console.log("收敛 state.current", f);
  }
}
console.log("处理", total, "处");
