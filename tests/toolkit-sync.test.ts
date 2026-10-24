import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const TRACKED = [".claude/skills", "CLAUDE.md", ".claude/.10x-ai-toolkit-manifest.json"];
const SKILL = ".claude/skills/code-review/SKILL.md";

interface Step {
  run?: string;
}

const workflowText = readFileSync(".github/workflows/10x-ai-toolkit-sync.yml", "utf8");
const workflow = load(workflowText) as { jobs: { drift: { steps: Step[] } } };
const driftScript = workflow.jobs.drift.steps.find((step) => step.run?.includes("npx"))?.run ?? "";

// Runs the drift step as Actions does (bash -e) in a scratch repository that holds a committed install. npx is a
// stub that records its arguments and then runs `reinstall`, which plays whatever the real reinstall would change.
function runDriftStep(reinstall: string): { status: number | null; output: string; npxArgs: string } {
  const root = mkdtempSync(join(tmpdir(), "toolkit-drift-"));
  try {
    const bin = join(root, "bin");
    const repo = join(root, "repo");
    mkdirSync(bin);
    mkdirSync(join(repo, ".claude/skills/code-review"), { recursive: true });
    writeFileSync(join(repo, ".claude/.10x-ai-toolkit-manifest.json"), '{ "version": "0.1.1" }\n');
    writeFileSync(join(repo, SKILL), "installed\n");
    writeFileSync(join(repo, "CLAUDE.md"), "block\n");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    git("init", "-q");
    git("add", ".");
    // --no-verify: a global pre-commit hook on a developer machine may refuse the first commit of a new repository.
    git("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "--no-verify", "-m", "install");

    const argsFile = join(root, "npx-args");
    writeFileSync(join(bin, "npx"), `#!/usr/bin/env bash\necho "$*" > "${argsFile}"\n${reinstall}\n`);
    chmodSync(join(bin, "npx"), 0o755);
    const result = spawnSync("bash", ["-e", "-c", driftScript], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    });
    const npxArgs = existsSync(argsFile) ? readFileSync(argsFile, "utf8").trim() : "";
    return { status: result.status, output: result.stdout + result.stderr, npxArgs };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe(".github/workflows/10x-ai-toolkit-sync.yml", () => {
  // npm reads NODE_AUTH_TOKEN only from the .npmrc that setup-node writes for this registry and scope.
  it("gives npm the package token through setup-node's registry and scope", () => {
    expect(workflowText).toContain("registry-url: https://npm.pkg.github.com");
    expect(workflowText).toContain('scope: "@thetiririri"');
    expect(workflowText).toContain("NODE_AUTH_TOKEN: ${{ secrets.GH_PKG_TOKEN }}");
  });

  // Without --force a locally edited skill is skipped and the drift never shows.
  it("reinstalls the version the manifest records, with --force, and passes when nothing changes", () => {
    const { status, npxArgs } = runDriftStep("");
    expect(npxArgs).toBe("--yes @thetiririri/10x-ai-toolkit@0.1.1 --force");
    expect(status).toBe(0);
  });

  it("fails with the status line and the diff when the reinstall changes an installed file", () => {
    const { status, output } = runDriftStep(`echo changed > ${SKILL}`);
    expect(status).toBe(1);
    expect(output).toContain(` M ${SKILL}`);
    expect(output).toMatch(/^-installed$/m);
    expect(output).toMatch(/^\+changed$/m);
  });

  // A deleted skill file comes back untracked, which git diff does not report and git status does.
  it("fails when the reinstall brings back a file git does not track", () => {
    const { status, output } = runDriftStep("echo restored > .claude/skills/code-review/extra.md");
    expect(status).toBe(1);
    expect(output).toContain("?? .claude/skills/code-review/extra.md");
  });
});

// git check-ignore exits 0 for an ignored path, 1 for one that is not, and 128 when git itself fails.
function checkIgnoreStatus(path: string): number {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", path], { stdio: "ignore" });
    return 0;
  } catch (error) {
    return (error as { status?: number | null }).status ?? -1;
  }
}

describe("the installed toolkit paths", () => {
  // An ignored path hides its drift from git status. --no-index checks the rules themselves: without it,
  // check-ignore never reports a tracked file, so a new ignore rule would pass unnoticed until a file goes missing.
  // Only exit 1 counts: a git that cannot run (128) must fail the test, not pass it.
  it.each(TRACKED)("%s is not ignored by git", (path) => {
    expect(checkIgnoreStatus(path)).toBe(1);
  });
});
