import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const JOB_CONCURRENCY =
  /^ {4}concurrency:\n {6}group: [a-z-]+-\$\{\{ github\.event\.pull_request\.number \}\}\n {6}cancel-in-progress: true$/m;

describe.each(["claude-review.yml", "review.yml"])(".github/workflows/%s", (name) => {
  const workflow = readFileSync(`.github/workflows/${name}`, "utf8");

  // Every `labeled` event starts a run. At workflow level that run would claim the group and cancel a review in
  // progress even when its job is then skipped for an unrelated label; a job skipped by `if:` never enters a job group.
  it("declares concurrency on the review job, not on the workflow", () => {
    expect(workflow).not.toMatch(/^concurrency:/m);
    expect(workflow).toMatch(JOB_CONCURRENCY);
  });
});
