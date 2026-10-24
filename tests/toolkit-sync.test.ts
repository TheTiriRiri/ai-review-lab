import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const TRACKED = [".claude/skills", "CLAUDE.md", ".claude/.10x-ai-toolkit-manifest.json"];

describe(".github/workflows/10x-ai-toolkit-sync.yml", () => {
  const workflow = readFileSync(".github/workflows/10x-ai-toolkit-sync.yml", "utf8");

  // npm reads NODE_AUTH_TOKEN only from the .npmrc that setup-node writes for this registry and scope.
  it("gives npm the package token through setup-node's registry and scope", () => {
    expect(workflow).toContain("registry-url: https://npm.pkg.github.com");
    expect(workflow).toContain('scope: "@thetiririri"');
    expect(workflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.GH_PKG_TOKEN }}");
  });

  // Without --force a locally edited skill is skipped and the drift never shows.
  it("reinstalls the version the manifest records, with --force", () => {
    expect(workflow).toContain(`require("./.claude/.10x-ai-toolkit-manifest.json").version`);
    expect(workflow).toContain('npx --yes "@thetiririri/10x-ai-toolkit@$version" --force');
  });

  // A deleted skill file comes back untracked, which git diff does not report and git status does.
  it("fails on any change git status reports in the installed paths", () => {
    expect(workflow).toContain(`drift=$(git status --porcelain -- ${TRACKED.join(" ")})`);
    expect(workflow).toMatch(/if \[ -n "\$drift" \]; then echo "\$drift"; exit 1; fi/);
    expect(workflow).not.toContain("git diff --exit-code");
  });
});

describe("the installed toolkit paths", () => {
  // An ignored path hides its drift from git status. --no-index checks the rules themselves: without it,
  // check-ignore never reports a tracked file, so a new ignore rule would pass unnoticed until a file goes missing.
  it.each(TRACKED)("%s is not ignored by git", (path) => {
    expect(() => execFileSync("git", ["check-ignore", "-q", "--no-index", path])).toThrow();
  });
});
