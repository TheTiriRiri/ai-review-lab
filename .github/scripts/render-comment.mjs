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

// GitHub refuses a comment body over 65,536 characters, and gh pr comment would then fail before the labels are set.
// Six rationales and the summary at these caps stay well under it.
const MAX_RATIONALE = 4_000;
const MAX_SUMMARY = 16_000;
// A backtick fence (no backtick after it on its line) or a tilde fence, opened at column 0.
const FENCE_OPEN = /^(`{3,}(?=[^`\n]*\n?$)|~{3,})/;
// A line that could open or close a fence in some container: only indentation and quote or list markers before it.
const FENCE_LIKE = /^[ \t]*(?:(?:>|[-+*]|\d{1,9}[.)])[ \t]*)*(?:`{3,}|~{3,})/;
// The container markers (quote, bullet, ordered item, footnote label) a heading may follow on its line.
const BLOCK_PREFIX = String.raw`(?:[ \t]*(?:>|[-+*]|\d{1,9}[.)]|\[\^[^\]]+\]:))*[ \t]*`;
const ATX_HEADING = new RegExp(String.raw`^(${BLOCK_PREFIX})(?=#{1,6}(?:[ \t]|$))`, "gm");
// Only a line right under a non-blank one can underline a heading; after a blank line, --- is a thematic break.
const SETEXT_UNDERLINE = /(?<=^[^\n]*\S[^\n]*\n)((?:[ \t]*>)*[ \t]*)(?=(?:=+|-+)[ \t]*$)/gm;

// CommonMark ends a line at \n, \r\n and a bare \r alike.
function oneLine(text) {
  return String(text).replace(/\s*[\r\n]\s*/g, " ").trim();
}

// The model writes what the diff under review steers it to, so its text is untrusted here. A zero-width space goes
// after a `<` that starts raw HTML (a </details> that ends our block, an <h2> that fakes a verdict), before a line
// that would be a heading, and after the @ of a mention or the & of an entity that spells @, which then notifies
// nobody. Which backticks pair up into a code span depends on the block structure around them, so this does not
// try to tell spans from prose: the space renders as nothing inside code too. The cost is that code copied from the
// comment keeps it, which inline code and a fence nested in a list or quote always do.
function escapeProse(text) {
  return text
    .replace(/<(?=[A-Za-z/!?])/g, "<\u200b")
    .replace(ATX_HEADING, "$1\u200b")
    .replace(SETEXT_UNDERLINE, "$1\u200b")
    .replace(/(^|[^\w])@(?=[A-Za-z0-9])/g, "$1@\u200b")
    .replace(/&(?=#0*64(?!\d)|#[xX]0*40(?![\dA-Fa-f])|commat;)/g, "&\u200b");
}

// Splits text into fenced blocks, kept as written, and the prose around them. Only when every line that could open
// or close a fence starts at column 0 does GitHub pair them as this does, whatever lists, quotes or paragraphs
// surround them (a fence at column 0 ends each). Otherwise all of it counts as prose, which costs only invisible
// characters inside the code.
function fencedParts(text) {
  const lines = text.split(/(?<=\n)/);
  if (lines.some((line) => FENCE_LIKE.test(line) && !/^(?:`{3,}|~{3,})/.test(line))) return [{ code: false, text }];
  const parts = [];
  let prose = "";
  for (let i = 0; i < lines.length; i += 1) {
    const fence = FENCE_OPEN.exec(lines[i])?.[1];
    const closing = fence && new RegExp(`^${fence[0]}{${fence.length},}[ \\t]*\\n?$`);
    const end = closing ? lines.findIndex((line, j) => j > i && closing.test(line)) : -1;
    if (end === -1) {
      prose += lines[i];
    } else {
      // The info string goes into an attribute that GitHub escapes; escaping it here as well costs nothing.
      const block = escapeProse(lines[i]) + lines.slice(i + 1, end + 1).join("");
      parts.push({ code: false, text: prose }, { code: true, text: block });
      prose = "";
      i = end;
    }
  }
  parts.push({ code: false, text: prose });
  return parts;
}

function untrusted(text, max) {
  let out = "";
  for (const { code, text: part } of fencedParts(text.replace(/\r\n?/g, "\n"))) {
    const safe = code ? part : escapeProse(part);
    if (out.length + safe.length > max) {
      // Escaped text stays safe wherever it is cut; a cut fence loses its closing line, so it is escaped too. The cut
      // backs off a high surrogate, which alone would print as U+FFFD.
      const cut = escapeProse(part).slice(0, max - out.length).replace(/[\ud800-\udbff]$/, "");
      return `${out}${cut} … (truncated)`;
    }
    out += safe;
  }
  return out;
}

// Both workflows take the verdict from the scores (VERDICT_RULE); the comment says so when that overrules the model.
function overruleNote({ verdict, modelVerdict }) {
  if ((modelVerdict !== "pass" && modelVerdict !== "fail") || modelVerdict === verdict) return [];
  return [
    `> The scores require **${verdict.toUpperCase()}** under the contract rule; ` +
      `the model's own verdict was **${modelVerdict.toUpperCase()}**.`,
    "",
  ];
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
  ...overruleNote(review),
  "| Criterion | Score |",
  "| --- | --- |",
  ...CRITERIA.map((key) => `| ${key} | ${review.criteria[key].score} |`),
  "",
  "<details><summary>Rationale per criterion</summary>",
  "",
  ...CRITERIA.map((key) => `- **${key}**: ${untrusted(oneLine(review.criteria[key].rationale ?? ""), MAX_RATIONALE)}`),
  "",
  "</details>",
  "",
  untrusted(String(review.summary ?? "").trim(), MAX_SUMMARY),
  "",
  footer(review.meta, runUrl),
];

process.stdout.write(`${lines.join("\n")}\n`);
