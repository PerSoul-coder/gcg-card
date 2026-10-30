#!/usr/bin/env node
/* 构建期生成拼音索引（gi-data/pinyin.js）
 *
 * 为什么在构建期做：运行时引入 pinyin 库会给单文件版增加几百 KB 与启动开销；
 * 而卡名/角色名/术语名是有限集合，预先算好「全拼 + 首字母」只需几十 KB。
 *
 *   npm install --prefix .build-tools pinyin-pro   # 仅构建期依赖，不进入产物
 *   node scripts/build-pinyin.mjs
 *
 * 多音字：pinyin-pro 按词组分词，绝大多数名字读音正确；少数专名需人工校订（OVERRIDES）。
 * 未收录的新名字由 chars 表逐字兜底（读默认音，可能不准确，但不会完全搜不到）。
 */
import fs from "node:fs";
import path, { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { pinyin } = require(path.join(here, ".build-tools/node_modules/pinyin-pro"));

const readJson = p => JSON.parse(fs.readFileSync(path.join(here, p), "utf8"));
const readData = p => readJson(p).data || [];
const chars = readData("gi-data/characters.json");
const entities = readData("gi-data/entities.json");
const keywords = readData("gi-data/keywords.json");
const conceptsExtra = JSON.parse(
  fs.readFileSync(path.join(here, "gi-data/concepts-extra.js"), "utf8")
    .replace(/^window\.CONCEPTS_EXTRA = /, "").replace(/;\s*$/, ""),
);

/* 人工校订：pinyin-pro 对个别专名按常用义读音（如 重云 → zhòng yún） */
const OVERRIDES = {
  重云: ["chong", "yun"],
};

const clean = s => (s || "").normalize("NFKC").replace(/[^\p{Script=Han}A-Za-z0-9]/gu, "");

const names = new Set();
for (const c of chars) names.add(c.name);
for (const e of entities) names.add(e.name);
for (const k of keywords) names.add(k.name);
for (const n of Object.keys(conceptsExtra)) names.add(n);

const namesOut = {};
const charVotes = new Map();
for (const raw of names) {
  const n = clean(raw);
  if (!n) continue;
  const syl = OVERRIDES[raw] || pinyin(n, { toneType: "none", type: "array", v: true, nonZh: "consecutive" })
    .map(s => String(s).toLowerCase())
    .filter(s => /^[a-z0-9]+$/.test(s));
  if (!syl.length) continue;
  const full = syl.join("");
  const initials = syl.map(s => s[0]).join("");
  namesOut[raw] = full + "|" + initials;

  /* 逐字兜底表：取该字在全部名字中出现最多的读音 */
  const han = [...n].filter(ch => /\p{Script=Han}/u.test(ch));
  if (han.length === syl.length) {
    han.forEach((ch, i) => {
      if (!charVotes.has(ch)) charVotes.set(ch, new Map());
      const m = charVotes.get(ch);
      m.set(syl[i], (m.get(syl[i]) || 0) + 1);
    });
  }
}

const charsOut = {};
for (const [ch, m] of charVotes) charsOut[ch] = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];

const payload = { v: 1, names: namesOut, chars: charsOut };
const text = "window.PINYIN_DATA = " + JSON.stringify(payload) + ";\n";
fs.writeFileSync(path.join(here, "gi-data/pinyin.js"), text, "utf8");

console.log(`名字 ${Object.keys(namesOut).length} 条，逐字兜底 ${Object.keys(charsOut).length} 字`);
console.log(`输出 gi-data/pinyin.js  ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`);
for (const probe of ["芙宁娜", "甘雨", "重云", "白术", "神里绫华", "元素附魔：冰"]) {
  console.log(`  ${probe} → ${namesOut[probe] || "（未收录）"}`);
}
