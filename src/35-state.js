/* 七圣召唤浏览器 · 应用级可变状态（数据集合、当前牌组、视图栈）。
   源码按领域拆分，由 src/sources.mjs 统一声明加载顺序；单文件版构建时按同一顺序内联。 */
"use strict";

/* ---------- 状态 ---------- */
let CHAR = [], ENT = [], KW = [], shareMap = {}, idToShare = {}, charById = new Map(), charByName = new Map(), entById = new Map();
let current = null;
let currentView = "grid";          /* 当前视图：grid / list / browse */
let deckOrder = [];                /* 牌组内有序 id（卡面/列表视图 → 详情翻页的顺序基准） */
/* 弹层视图栈：detail（卡牌/角色详情，自带同级翻页上下文）/ term（概念页，可继续下钻）。
   overlayStack 取代了早期"单一 modalList + 术语栈"的双轨状态——两者混用会导致
   从卡库/检索打开详情后 modalList 被压成单张，此后的翻页永远禁用。 */
let overlayStack = [];

