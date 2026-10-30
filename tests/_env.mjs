/* 测试运行环境：DOM / 存储 / 网络 stub 与源码执行器。
 *
 * 以前每个测试文件各抄一份 40 行的 stub，保真度还各不相同（`style` 有的每次返回新对象、
 * `body` 有的没有 `dataset`）。后果是：生产代码写一行 `body.dataset.view`，只有一个测试崩，
 * 而修的时候要改 9 遍——这是 stub 的问题，不是生产代码的问题。
 *
 * 这里只留一份，按最高要求写：
 *   · `style` 按元素缓存（赋值后读得到，否则「点一下看 display」的断言必然假通过）；
 *   · `body.dataset` 存在（视图切换写 `body.dataset.view`）；
 *   · `querySelector` 返回可用的元素，`querySelectorAll` 返回数组。
 *
 * 每个测试仍然独立进程（run-all.mjs 用子进程隔离），因此这里的单例不会互相污染。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppSource } from "./test-lib.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

/** 三个原始数据源（构建期输入）。测试用它反查期望值，而不是写死数字。 */
export function readSources() {
  const out = {};
  for (const cat of ["characters", "entities", "keywords"])
    out[cat] = readJson(`gi-data/${cat}.json`).data;
  return out;
}

/** 补充概念库（构建期输入；运行时不再依赖它）。 */
export function readConceptsExtra() {
  return JSON.parse(
    fs
      .readFileSync(path.join(ROOT, "gi-data/concepts-extra.js"), "utf8")
      .replace(/^export const CONCEPTS_EXTRA = /, "")
      .replace(/;\s*$/, ""),
  );
}

/* ---------- DOM ---------- */
const NOOP = () => {};
const NOOP_METHODS = [
  "addEventListener", "removeEventListener", "appendChild", "prepend", "remove", "click",
  "focus", "blur", "setAttribute", "removeAttribute", "scrollIntoView", "insertAdjacentHTML",
  "select", "setSelectionRange", "requestSubmit", "reset",
];

function makeEl(id) {
  const store = id
    ? { _id: id, children: [], innerHTML: "", textContent: "", value: "", clientWidth: 0, clientHeight: 0 }
    : { children: [], innerHTML: "", textContent: "", value: "", clientWidth: 0, clientHeight: 0 };
  const cls = new Set();   /* 有状态的 classList：弹层可见性靠它判断，空集不能回应 add */
  return new Proxy(store, {
    get(t, k) {
      if (k === "classList")
        return {
          add: (c) => cls.add(c),
          remove: (c) => cls.delete(c),
          toggle: (c, f) => { (f === undefined ? !cls.has(c) : f) ? cls.add(c) : cls.delete(c); },
          contains: (c) => cls.has(c),
        };
      if (k === "style") return t._style || (t._style = {});
      if (k === "dataset") return t._dataset || (t._dataset = {});
      if (k in t) return t[k];
      if (k === "closest" || k === "querySelector") return () => null;
      if (k === "querySelectorAll") return () => [];
      if (k === "value") return "";
      if (k === "checked" || k === "disabled") return false;
      if (NOOP_METHODS.includes(k)) return NOOP;
      return undefined;
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

export function makeDom() {
  const cache = new Map();
  const byId = (id) => {
    if (!cache.has(id)) cache.set(id, makeEl(id));
    return cache.get(id);
  };
  return {
    getElementById: byId,
    createElement: () => makeEl(null),
    addEventListener: NOOP,
    removeEventListener: NOOP,
    querySelector: () => makeEl(null),
    querySelectorAll: () => [],
    body: Object.assign(makeEl(null), { appendChild: NOOP, dataset: {} }),
    documentElement: makeEl(null),
  };
}

export function makeStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
    _store: store,
  };
}

/** 原始数据接口 stub：按 URL 末段回放 characters / entities / keywords。 */
export function makeFetch(data) {
  return async (url) => {
    const cat = Object.keys(data).find((c) => String(url).endsWith("/" + c));
    return { ok: true, json: async () => ({ data: cat ? data[cat] : [] }), text: async () => "" };
  };
}

/** 空网络：任何请求都失败。用来验证「数据包缺失时不白屏」这类路径。 */
export const emptyFetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

/* ---------- 执行器 ---------- */
/** 建一个测试上下文：断言计数 + 环境 + 源码执行。
 *
 *   const t = createTest();
 *   await t.run(`await ensureData(); t.assert(...)`);
 *   t.finish();
 *
 * harness 以字符串注入，因为它需要在应用源码同一作用域内运行才能访问模块内部状态
 * （`state`、`pool` 等由 test-api.ts 暴露为全局活绑定）。 */
export function createTest({ data = readSources(), storage = null, window: win = {}, fetch = null } = {}) {
  let fails = 0;
  const assert = (cond, msg) => {
    if (cond) console.log("  ok:", msg);
    else {
      console.error("  FAIL:", msg);
      fails++;
    }
  };
  const dom = makeDom();
  const ls = storage || makeStorage();
  const env = {
    document: dom,
    window: win,
    localStorage: ls,
    location: { hash: "", search: "", pathname: "/" },
    history: { replaceState() {}, pushState() {} },
    fetch: fetch || makeFetch(data),
    navigator: { clipboard: {}, userAgent: "node" },
  };
  const conceptsExtra = readConceptsExtra();

  return {
    assert,
    dom,
    ls,
    env,
    getFails: () => fails,
    readSources,
    /** 执行 harness。`extra` 的键会作为额外形参按同名注入（如 DATA / PINYIN_DATA）。 */
    async run(harness, extra = {}) {
      const names = [
        "document", "window", "localStorage", "location", "history", "fetch", "navigator",
        "assert", "getFails", "CONCEPTS_EXTRA", ...Object.keys(extra),
      ];
      const args = [
        env.document, env.window, env.localStorage, env.location, env.history, env.fetch, env.navigator,
        assert, () => fails, conceptsExtra, ...Object.values(extra),
      ];
      try {
        await new Function(...names, readAppSource() + harness)(...args);
      } catch (e) {
        /* 执行期异常也算失败：以前 harness 自己 process.exit(1)，现在交给这里统一收口 */
        console.error("  执行异常:", e && e.stack ? e.stack.split("\n")[0] : e);
        fails++;
      }
    },
    finish(label = "全部通过") {
      console.log(fails ? `\n存在失败项（${fails}）` : `\n${label}`);
      process.exit(fails ? 1 : 0);
    },
  };
}
