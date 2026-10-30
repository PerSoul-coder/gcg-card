// 分享码编解码已独立为 src/10-codec.js：直接对该模块做回环测试
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logic = readFileSync(path.join(here, "src/10-codec.js"), "utf8");

const SAMPLE = "JDCS4mwOFiLBRXUkJlLiRkwkEmCx8YAPGxFxaLcWFYGBilgYI6Ey2zMdDLEyaVIWJJAA";
const CHAR = JSON.parse(readFileSync(path.join(here, "gi-data/characters.json"), "utf8")).data;
const ENT = JSON.parse(readFileSync(path.join(here, "gi-data/entities.json"), "utf8")).data;

const factory = new Function(logic + "\n;return { decodeRaw, encodeRaw, BLOCK_RE };");
const { decodeRaw, encodeRaw, BLOCK_RE } = factory();

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
