/* 一次性迁移辅助：测试断言里的状态符号改为 state.X。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TESTS = path.join(ROOT, "tests");

const NAMES = ["CHAR", "ENT", "KW", "charById", "charByName", "entById",
  "shareMap", "idToShare", "deckOrder", "overlayStack", "currentView", "current"];

for (const f of fs.readdirSync(TESTS)) {
  if (!/^test-.*\.mjs$/.test(f) || f === "test-single.mjs") continue;
  const p = path.join(TESTS, f);
  let c = fs.readFileSync(p, "utf8");
  const before = c;
  for (const n of NAMES) {
    c = c.replace(new RegExp(`(?<![.\\w$])${n}\\b`, "g"), `state.${n}`);
    /* 展开运算符：...CHAR 会被上面的负向前瞻当成属性访问而跳过，单独处理 */
    c = c.replace(new RegExp(`\\.\\.\\.${n}\\b`, "g"), `...state.${n}`);
  }
  c = c.replace(/state\.state\./g, "state.");
  if (c !== before) {
    fs.writeFileSync(p, c, "utf8");
    console.log("更新", f);
  }
}
