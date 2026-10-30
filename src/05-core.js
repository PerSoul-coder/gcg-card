/* 七圣召唤浏览器 · 核心工具：DOM 查询、转义、提示条、剪贴板、滚动锁。
   源码按领域拆分，由 src/sources.mjs 统一声明加载顺序；单文件版构建时按同一顺序内联。 */
"use strict";

/* 七圣召唤 · 卡牌与牌组浏览器
   牌组分享码解码/编码 + 卡库浏览 + 概念检索（术语下钻与反链）+ 多牌组管理
   解码/编码移植自 piovium/genius-invokation @gi-tcg/assets-manager/src/sharing.ts (AGPL-3.0)
   数据源等资源声明见 00-resources.js */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));

/* ---------- 状态条 / 提示条 / 剪贴板 ---------- */
function setStatus(msg, cls = "") { const s = $("status"); s.innerHTML = msg; s.className = cls; }
/* 提示条：最多同时 3 条（超出先撤最早一条），避免连续加入卡牌时堆满屏幕遮住内容 */
const TOAST_MAX = 3;
function toast(msg, err = false) {
  const box = $("toasts");
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = msg;
  if (box && box.appendChild) box.appendChild(t);
  /* HTMLCollection 是活集合：撤掉最早一条后长度即刻更新 */
  const kids = box && box.children;
  if (kids && typeof kids.length === "number") {
    for (let guard = 0; kids.length > TOAST_MAX && guard < 50; guard++) {
      const first = kids[0];
      if (!first || first === t || typeof first.remove !== "function") break;
      first.remove();
    }
  }
  setTimeout(() => t.remove(), 2600);
}
function copyText(t) { return navigator.clipboard.writeText(t); }
