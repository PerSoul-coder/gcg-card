// 分享码编解码回环测试：直接使用应用构建产物里的 encodeRaw / decodeRaw
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppSource } from "./test-lib.mjs";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SAMPLE = "JDCS4mwOFiLBRXUkJlLiRkwkEmCx8YAPGxFxaLcWFYGBilgYI6Ey2zMdDLEyaVIWJJAA";

/* 执行应用产物：导出面会挂到 globalThis（只读活绑定），从中取编解码函数。
   DOM 用最小替身——入口会注册事件与读取样式，替身只保证不抛异常。 */
const el = () => new Proxy(
  { style: {}, dataset: {}, children: [], value: "", classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
  {
    get(t, k) {
      if (k in t) return t[k];
      if (["addEventListener", "removeEventListener", "appendChild", "remove", "setAttribute",
        "focus", "select", "blur", "insertAdjacentHTML", "scrollIntoView", "click"].includes(k)) return () => {};
      if (k === "closest" || k === "querySelector") return () => null;
      if (k === "querySelectorAll") return () => [];
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  },
);
const documentStub = {
  getElementById: () => el(),
  createElement: () => el(),
  querySelector: () => el(),
  querySelectorAll: () => [],
  addEventListener() {},
  body: el(),
  documentElement: el(),
};

new Function("document", "window", "localStorage", "location", "history", "fetch", "navigator", readAppSource())(
  documentStub,
  {},
  { getItem: () => null, setItem() {}, removeItem() {} },
  { hash: "" },
  { replaceState() {} },
  async () => ({ ok: true, json: async () => ({ data: [] }) }),
  { clipboard: {} },
);

const { decodeRaw, encodeRaw, BLOCK_RE } = globalThis;

const CHAR = JSON.parse(readFileSync(path.join(here, "gi-data/characters.json"), "utf8")).data;
const ENT = JSON.parse(readFileSync(path.join(here, "gi-data/entities.json"), "utf8")).data;

// 1) 解码样例码
const shareIds = decodeRaw(SAMPLE);
if (shareIds.length !== 33) throw new Error("解码结果不是 33 项");

// 2) shareId <-> 定义 id 双向映射
const shareMap = {}, idToShare = {};
for (const c of [...CHAR, ...ENT]) if (c.shareId != null) {
  shareMap[c.shareId] = c.id;
  if (!(c.id in idToShare)) idToShare[c.id] = c.shareId;
}
const ids = shareIds.map(s => { const id = shareMap[s]; if (!id) throw new Error("unknown " + s); return id; });

// 3) 用页面同款 encodeRaw 重新编码
const re = encodeRaw(ids.map(id => idToShare[id]));
if (BLOCK_RE.test(re)) throw new Error("再编码结果命中屏蔽词!");

// 4) 回环
const rt = decodeRaw(re).map(s => shareMap[s]);
const ok = JSON.stringify(rt) === JSON.stringify(ids);
console.log("再编码结果:", re);
console.log("回环校验:", ok ? "通过" : "失败");
console.log("与原码相同:", re === SAMPLE ? "是（last 偏移一致）" : "否（合法即可，游戏端通用）");
if (!ok) process.exit(1);
