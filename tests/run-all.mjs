#!/usr/bin/env node
/* 回归测试统一入口：npm test
 *
 * 逐个以子进程运行 tests/test-*.mjs（各自独立进程，避免全局 DOM stub 互相污染），
 * 汇总通过/失败。任一失败即非零退出。 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs
  .readdirSync(here)
  .filter((f) => /^test-.*\.mjs$/.test(f) && f !== "test-lib.mjs")
  .sort();

let pass = 0;
const failed = [];

for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(here, f)], { cwd: path.resolve(here, ".."), encoding: "utf8" });
  if (r.status === 0) {
    pass++;
    process.stdout.write(`PASS ${f}\n`);
  } else {
    failed.push(f);
    process.stdout.write(`FAIL ${f}\n`);
    const tail = ((r.stdout || "") + (r.stderr || "")).trim().split("\n").slice(-12).join("\n");
    process.stdout.write(tail + "\n");
  }
}

process.stdout.write(`\n通过 ${pass} / 失败 ${failed.length}${failed.length ? "（" + failed.join(", ") + "）" : ""}\n`);
process.exit(failed.length ? 1 : 0);
