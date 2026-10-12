import { expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The supervisor is the only thing that keeps a port listener alive, so it needs
// to restart a child that dies and to refuse to loop when the stack is unusable.
test("supervisor restarts a wrapper that exits", async () => {
  const root = mkdtempSync("/tmp/opencode/jev-supervise-");
  try {
    mkdirSync(join(root, "localjev/src"), { recursive: true });
    writeFileSync(join(root, "localjev/src/index.ts"), "");
    copyFileSync(new URL(`../../jev-supervise.sh`, import.meta.url), join(root, "jev-supervise.sh"));
    chmodSync(join(root, "jev-supervise.sh"), 0o755);
    writeFileSync(join(root, "jev.sh"), `#!/usr/bin/env bash
printf 'x' >> "$TEST_ROOT/attempts"
exit 7
`, { mode: 0o755 });
    const env = { ...process.env, TEST_ROOT: root, JEV_RESTART_DELAY: "0.01" };
    const run = Bun.spawnSync(["bash", "-c", `
"$TEST_ROOT/jev-supervise.sh" --fallback-model small > "$TEST_ROOT/sup.log" 2>&1 &
sup=$!
sleep 0.3
kill "$sup" 2>/dev/null || true
wait
`], { env });
    const log = readFileSync(join(root, "sup.log"), "utf8");
    expect(run.exitCode).toBe(0);
    expect(log).toContain("attempt 2");
    expect(log).toContain("wrapper exited with status 7");
    expect(readFileSync(join(root, "attempts"), "utf8").length).toBeGreaterThan(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supervisor refuses to loop when the stack is unusable", async () => {
  const root = mkdtempSync("/tmp/opencode/jev-supervise-");
  try {
    mkdirSync(join(root, "bin"), { recursive: true });
    copyFileSync(new URL(`../../jev-supervise.sh`, import.meta.url), join(root, "jev-supervise.sh"));
    chmodSync(join(root, "jev-supervise.sh"), 0o755);
    const run = Bun.spawnSync(["bash", "-c", `"$TEST_ROOT/jev-supervise.sh" --fallback-model small > /dev/null 2>&1`], { env: { ...process.env, TEST_ROOT: root } });
    expect(run.exitCode).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
