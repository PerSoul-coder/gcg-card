// 分享码编解码回环测试：直接使用应用构建产物里的 encodeRaw / decodeRaw
import { createTest, readSources } from "./_env.mjs";

const SAMPLE = "JDCS4mwOFiLBRXUkJlLiRkwkEmCx8YAPGxFxaLcWFYGBilgYI6Ey2zMdDLEyaVIWJJAA";

const t = createTest();

await t.run("");
const { decodeRaw, encodeRaw, BLOCK_RE } = globalThis;

const { characters: CHAR, entities: ENT } = readSources();

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

t.finish();
