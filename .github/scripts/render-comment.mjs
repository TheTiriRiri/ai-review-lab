#!/usr/bin/env node
// Renders a review JSON (reviewer/schema/review-schema.json) as the Markdown body of a PR comment.
// Shared by claude-review.yml and review.yml so both variants post the same format.
// Usage: node render-comment.mjs --title "<title>" [--run-url <url>] <review.json>
import { readFileSync } from "node:fs";

const CRITERIA = [
  "implementationCorrectness",
  "idiomaticity",
  "complexity",
  "testRiskCoverage",
  "documentation",
  "securitySafety",
];

function fail(message) {
  process.stderr.write(`render-comment: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { title: "AI Code Review", runUrl: "", file: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title") args.title = argv[++i] ?? fail("--title needs a value");
    else if (arg === "--run-url") args.runUrl = argv[++i] ?? fail("--run-url needs a value");
    else if (arg.startsWith("--")) fail(`unknown flag ${arg}`);
    else args.file = arg;
  }
  if (!args.file) fail("missing the review JSON path");
  return args;
}

function oneLine(text) {
  return String(text).replace(/\s*\n\s*/g, " ").trim();
}

function footer(meta, runUrl) {
  const model = meta?.model ?? "n/a";
  const duration = typeof meta?.durationMs === "number" ? `${(meta.durationMs / 1000).toFixed(1)} s` : "n/a";
  let cost = "subscription";
  if (meta) cost = typeof meta.costUsd === "number" ? `$${meta.costUsd.toFixed(4)}` : "n/a";
  const parts = [`model: ${model}`, `duration: ${duration}`, `cost: ${cost}`];
  if (runUrl) parts.push(`[run](${runUrl})`);
  return `<sub>${parts.join(" · ")}</sub>`;
}

const { title, runUrl, file } = parseArgs(process.argv.slice(2));

let review;
try {
  review = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  fail(`cannot read ${file}: ${error.message}`);
}

if (review.verdict !== "pass" && review.verdict !== "fail") fail("verdict must be pass or fail");
for (const key of CRITERIA) {
  const criterion = review.criteria?.[key];
  if (!criterion || !Number.isFinite(criterion.score)) fail(`missing or invalid criterion ${key}`);
}

const lines = [
  `## ${title}: **${review.verdict.toUpperCase()}**`,
  "",
  "| Criterion | Score |",
  "| --- | --- |",
  ...CRITERIA.map((key) => `| ${key} | ${review.criteria[key].score} |`),
  "",
  "<details><summary>Rationale per criterion</summary>",
  "",
  ...CRITERIA.map((key) => `- **${key}**: ${oneLine(review.criteria[key].rationale ?? "")}`),
  "",
  "</details>",
  "",
  String(review.summary ?? "").trim(),
  "",
  footer(review.meta, runUrl),
];

process.stdout.write(`${lines.join("\n")}\n`);
