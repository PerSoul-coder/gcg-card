/* 一次性迁移辅助：补齐 ESM 化之后的跨模块引用。
 *   1) 把 12 个共享状态字段改写为 state.X（旧代码靠全局作用域跨文件赋值）
 *   2) 为已迁移模块（core/resources、core/dom、data/state、data/model）补 import
 * 只做机械改写，不改逻辑。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

const STATE_FIELDS = [
  "CHAR", "ENT", "KW", "shareMap", "idToShare",
  "charById", "charByName", "entById",
  "current", "currentView", "deckOrder", "overlayStack",
];

/* 已迁移模块的导出清单（与源码一致；脚本只用于补齐 import，不产生第二份定义） */
const MODULES = {
  "./core/resources": ["API", "LANG", "SAMPLE", "CACHE_TTL_MS", "FETCH_TIMEOUT_MS", "STORAGE_PREFIX",
    "STORAGE_KEYS", "cacheKey", "imgFull", "DATASET_GZ_URL", "DATASET_BR_URL", "DATASET_JSON_URL",
    "ELE_ZH", "ELE_COLOR", "WEAPON_ZH", "TAG_ZH", "COST_ZH", "tagZh", "NATION_CODE", "CAMP_CODE",
    "ELE_CODE", "ENERGY_ICON", "ELE_ICONS", "eleIcon", "enPips"],
  "./core/dom": ["$", "esc", "setStatus", "toast", "copyText"],
  "./data/model": ["TYPE_SPEC", "DOMAIN_ZH", "TYPE_ZH", "TYPE_ORDER", "typeSpecOf", "typeZhOf",
    "isDeckable", "isFieldEntity", "domainOfEntity", "nameKey", "cosmeticKey", "shadowStateIds",
    "shadowStateBySkill", "PREPARED_STATE_RE", "buildShadowStates", "isShadowState", "hasCardFace",
    "NO_ART_TYPE_ZH", "CARD_ART_W", "CARD_ART_H", "NO_ICON_IDS", "NO_ART_KIND", "noArtHtml",
    "cardArtHtml", "artIconReady", "artIconFail", "artFallback"],
};

const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".ts") && /^\d\d-/.test(f));

for (const file of files) {
  const p = path.join(SRC, file);
  let code = fs.readFileSync(p, "utf8");

  /* 1) 状态字段 → state.X（排除属性访问 a.current、已改写的 state.X、以及字符串内的误伤） */
  for (const f of STATE_FIELDS) {
    code = code.replace(new RegExp(`(?<![.\\w$])${f}\\b`, "g"), `state.${f}`);
  }
  code = code.replace(/state\.state\./g, "state.");

  /* 2) 补 import：先把已有 import 的符号收集起来，避免重复 */
  const imported = new Set();
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const s of m[1].split(",")) imported.add(s.trim());
  }
  const declared = new Set();
  for (const m of code.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) declared.add(m[1]);
  for (const m of code.matchAll(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) declared.add(m[1]);

  const need = [];
  for (const [mod, syms] of Object.entries(MODULES)) {
    const used = syms.filter((s) => {
      if (imported.has(s) || declared.has(s)) return false;
      return new RegExp(`(?<![.\\w$])${s.replace(/\$/g, "\\$")}\\b`).test(code);
    });
    if (used.length) need.push(`import { ${used.join(", ")} } from "${mod}";`);
  }
  if (/state\./.test(code) && !imported.has("state")) {
    need.unshift('import { state } from "./data/state";');
  }

  if (need.length) {
    /* 插到最后一个 import 之后；没有 import 就插到文件头注释之后 */
    const lastImport = code.lastIndexOf("\nimport ");
    if (lastImport >= 0) {
      const end = code.indexOf("\n", code.indexOf(";", lastImport));
      code = code.slice(0, end + 1) + need.join("\n") + "\n" + code.slice(end + 1);
    } else {
      const head = code.match(/^\/\*[\s\S]*?\*\/\n/);
      const at = head ? head[0].length : 0;
      code = code.slice(0, at) + need.join("\n") + "\n" + code.slice(at);
    }
  }

  fs.writeFileSync(p, code, "utf8");
  console.log("修正", file, need.length ? `(+${need.length} 行 import)` : "");
}
