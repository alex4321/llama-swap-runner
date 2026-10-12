import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test("startup validates options before launching and forwards wrapper options", async () => {
  const root = mkdtempSync("/tmp/opencode/jev-startup-");
  try {
    for (const dir of ["llama-swap/build", "llama.cpp/build/bin", "localjev/src", "bin", "config"]) {
      mkdirSync(join(root, dir), { recursive: true });
    }
    for (const script of ["server.sh", "jev.sh", "jev-supervise.sh", "preparation.sh"]) {
      copyFileSync(new URL(`../../${script}`, import.meta.url), join(root, script));
    }
    writeFileSync(join(root, "localjev/src/index.ts"), "");
    writeFileSync(join(root, "llama.cpp/build/bin/llama-server"), "");
    writeFileSync(join(root, "config/models.yml"), "models: {}\n");
    writeFileSync(join(root, "bin/bun"), `#!/usr/bin/env bash
if [[ "$*" == *"--check-config"* ]]; then
  [[ "$*" == *"--fallback-model "* ]] || exit 1
  [[ "$*" == *"--port 0"* ]] && exit 1
  exit 0
fi
printf '%s\\n' "$*" > "$TEST_ROOT/jev-args"
`, { mode: 0o755 });
    writeFileSync(join(root, "llama-swap/build/llama-swap-linux-amd64"), `#!/usr/bin/env bash
printf '%s\\n' "$*" > "$TEST_ROOT/swap-args"
`, { mode: 0o755 });
    const env = { ...process.env, TEST_ROOT: root, PATH: `${root}/bin:${process.env.PATH}`, JEV_RESTART_DELAY: "60" };
    const run = (args: string[]) => Bun.spawnSync(["bash", join(root, "server.sh"), ...args], { env });
    expect(run([]).exitCode).toBe(1);
    // A rejected option must stop the script before either service is launched.
    expect(run([join(root, "config/models.yml"), "--port", "0"]).exitCode).toBe(1);
    expect(await Bun.file(join(root, "swap-args")).exists()).toBe(false);
    expect(await Bun.file(join(root, "jev-args")).exists()).toBe(false);
    const started = run([join(root, "config/models.yml"), "--port", "8099"]);
    expect(started.exitCode).toBe(0);
    // The startup script intentionally launches children in the background.
    await Bun.sleep(100);
    const wrapperArgs = readFileSync(join(root, "jev-args"), "utf8");
    expect(wrapperArgs).toContain("--fallback-model");
    expect(wrapperArgs).toContain("--port 8099");
    expect(readFileSync(join(root, "swap-args"), "utf8")).toContain("--listen localhost:8080 --watch-config");
    expect(await Bun.file(join(root, "config/server.log")).exists()).toBe(true);
    expect(await Bun.file(join(root, "config/jev.log")).exists()).toBe(true);
    // The supervisor is still running in the background; stop it before the tree goes away.
    Bun.spawnSync(["bash", "-c", `pkill -f "$TEST_ROOT/jev-supervise.sh" || true`], { env });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
