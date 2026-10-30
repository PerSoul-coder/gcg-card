/* src/10-codec.js —— 由 scripts/_convert.mjs 从旧脚本转换（迁移中间态）。 */
/* ---------- 解码（移植自 sharing.ts decodeRaw） ---------- */
function decodeRaw(src) {
  const bin = atob(src.replace(/\s+/g, ""));
  const arr = Array.from(bin, c => c.codePointAt(0) ?? 0);
  if (arr.length !== 51) throw new Error(`分享码长度无效（期望 51 字节，实际 ${arr.length}）`);
  const last = arr.pop() ?? 0;
  const reordered = [
    ...Array.from({ length: 25 }, (_, i) => (arr[2 * i] - last) & 0xff),
    ...Array.from({ length: 25 }, (_, i) => (arr[2 * i + 1] - last) & 0xff),
    0,
  ];
  const result = Array.from({ length: 17 }).flatMap((_, i) => [
    (reordered[i * 3] << 4) + (reordered[i * 3 + 1] >> 4),
    ((reordered[i * 3 + 1] & 0xf) << 8) + reordered[i * 3 + 2],
  ]);
  result.pop();
  return result;
}

/* ---------- 编码（移植自 sharing.ts encodeRaw + 屏蔽词规避） ---------- */
const BLOCK_WORDS = ["1s","2c8","2g1c","4jg","4jk","5l3","64","6four","6iv","6si","89","8jiu","92f","99bb","a55","anal","anus","ass","ash0le","b00b","b1tch","b17ch","ba9","bb1","bbw","bdsm","beaner","bi7ch","bimbos","bitch","boob","boner","c0cks","c0n","c4","cag","ccp","chink","clit","cnm","cnn","cock","coons","cum","cunt","cuum","cv0","darkie","dick","dildo","dilld0","dommes","dpp","dvda","ecchi","erotic","f4k","fag1t","fagg1t","faggot","fck","fdp","fecal","felch","feltch","femdom","flg","fm2","fuck","gay","gcd","gdm","ggc","girlon","goatcx","goatse","gokkun","grope","guro","gwg","hentai","hitler","hjt","honkey","hooker","incest","j8","jba","ji8","jiba","jiz","juggs","jzm","k7","kike","kinky","kmt","kock","liu4","liusi","lolita","lsp","m0m","m2f","mh0","milf","mof0","nambla","negro","nignog","nigga","nigger","nipple","njink","nmd","ntd","ntr","nympho","orgasm","orgy","p0rn","p2np","p3t","paki","panty","pcp","penis","phuq","pig","poof","poon","porn","pqp","prr","pthc","pu55i","pu55y","pubes","puki","punany","pussy","queaf","queef","queer","quim","rape","raping","rapist","rbq","rectum","rimjob","s2x","s3x","sadism","scat","semen","sex","sh7t","shit","shota","six4","skeet","slut","slvt","smut","sodomy","spic","spooge","spunk","suck","t3k","t41","t43","t4e","t4i","tits","tiedup","titty","tmd","tosser","tranny","tushy","twat","twink","vagina","vi4","viiv","vpn","vulva","waf","wank","whore","wh0re","wtf","x3r","xdd","xjp","yaoi","yiffy"];
const BLOCK_RE = new RegExp(BLOCK_WORDS.map(w => w.split("").join("[+/]*")).join("|"), "i");
function encodeRaw(arr) {
  if (arr.length !== 33) throw new Error("编码需要恰好 33 张牌（3 角色 + 30 行动牌）");
  const padded = [...arr, 0];
  const reordered = Array.from({ length: 17 }).flatMap((_, i) => [
    padded[i * 2] >> 4,
    ((padded[i * 2] & 0xf) << 4) + (padded[i * 2 + 1] >> 8),
    arr[i * 2 + 1] & 0xff,
  ]);
  for (let last = 0; last < 0xff; last++) {
    const original = Array.from({ length: 25 }).flatMap((_, i) => [
      (reordered[i] + last) & 0xff,
      (reordered[i + 25] + last) & 0xff,
    ]);
    const encoded = btoa(String.fromCodePoint(...original, last));
    if (!BLOCK_RE.test(encoded)) return encoded;
  }
  throw new Error("未能生成避开屏蔽词的分享码");
}

export { decodeRaw, BLOCK_WORDS, BLOCK_RE, encodeRaw };
