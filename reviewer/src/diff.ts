// Reads and trims the unified diff the reviewer sees. Excluding whole files (lockfiles, build output) and
// capping the size keep the cost of a review proportional to the change a person actually wrote.
import { readFile } from "node:fs/promises";

export interface TrimOptions {
  maxBytes: number;
  excludeGlobs?: readonly string[] | undefined;
}

export interface TrimmedDiff {
  diff: string;
  excludedFiles: string[];
  truncated: boolean;
}

interface FileSection {
  path: string | undefined;
  text: string;
}

// git quotes a path with a non-ASCII byte, a double quote, a backslash or a control character (the default
// core.quotePath): "b/za\305\274.ts", C escapes plus octal bytes that spell UTF-8. Either side may be quoted.
const QUOTED_PATH = String.raw`"(?:[^"\\]|\\.)*"`;
const FILE_HEADER = new RegExp(String.raw`^diff --git (?:${QUOTED_PATH}|a/.+?) (${QUOTED_PATH}|b/.+)$`);
const C_ESCAPES: Record<string, string> = { a: "\x07", b: "\b", t: "\t", n: "\n", v: "\v", f: "\f", r: "\r" };
const NEWLINE = 0x0a;

/** Reads a diff from a file, or from standard input when `source` is "stdin". */
export async function readDiff(source: string, stdin: AsyncIterable<Buffer> = process.stdin): Promise<string> {
  if (source !== "stdin") {
    return readFile(source, "utf8");
  }
  // Decode once at the end: a multi-byte character may be split across two chunks.
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function unquote(quoted: string): string {
  const parts: Buffer[] = [];
  for (const [, octal, escaped, plain] of quoted.slice(1, -1).matchAll(/\\([0-7]{3})|\\(.)|([^\\]+)/gs)) {
    if (octal !== undefined) parts.push(Buffer.from([Number.parseInt(octal, 8)]));
    else if (escaped !== undefined) parts.push(Buffer.from(C_ESCAPES[escaped] ?? escaped, "utf8"));
    else parts.push(Buffer.from(plain ?? "", "utf8"));
  }
  return Buffer.concat(parts).toString("utf8");
}

/** The new-side path of a `diff --git` line, or undefined when the line cannot be read. */
function headerPath(line: string): string | undefined {
  const target = FILE_HEADER.exec(line)?.[1];
  const path = target?.startsWith('"') ? unquote(target) : target;
  return path?.startsWith("b/") ? path.slice(2) : undefined;
}

/**
 * Splits a diff at every `diff --git` line, so no file can hide inside the previous one. Text before the first
 * header, and a file whose header cannot be read, get no path, so no exclude glob ever drops them.
 */
function splitFiles(diff: string): FileSection[] {
  const sections: FileSection[] = [];
  let current: FileSection | undefined;
  for (const line of diff.split(/(?<=\n)/)) {
    const header = line.replace(/\r?\n$/, "");
    if (header.startsWith("diff --git ") || !current) {
      current = { path: headerPath(header), text: "" };
      sections.push(current);
    }
    current.text += line;
  }
  return sections;
}

/** `**` crosses directories (`**\/` also matches none), `*` and `?` stay inside one path segment. */
function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob.charAt(i);
    if (char === "*" && glob.charAt(i + 1) === "*") {
      const dirPrefix = glob.charAt(i + 2) === "/";
      source += dirPrefix ? "(?:.*/)?" : ".*";
      i += dirPrefix ? 2 : 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * Drops whole files whose path matches an exclude glob, then cuts the rest after the last line that fits
 * in `maxBytes` of UTF-8, so the reviewer never sees half a line. A newline byte never occurs inside a
 * multi-byte character, so the cut always lands on a character boundary.
 */
export function trimDiff(diff: string, { maxBytes, excludeGlobs = [] }: TrimOptions): TrimmedDiff {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error(`maxBytes must be a positive integer, got ${maxBytes}`);
  }
  const patterns = excludeGlobs.map(globToRegExp);
  const excludedFiles: string[] = [];
  let kept = "";
  for (const { path, text } of splitFiles(diff)) {
    if (path !== undefined && patterns.some((pattern) => pattern.test(path))) {
      excludedFiles.push(path);
    } else {
      kept += text;
    }
  }

  const bytes = Buffer.from(kept, "utf8");
  if (bytes.length <= maxBytes) {
    return { diff: kept, excludedFiles, truncated: false };
  }
  const lastNewline = bytes.lastIndexOf(NEWLINE, maxBytes - 1);
  return { diff: bytes.subarray(0, lastNewline + 1).toString("utf8"), excludedFiles, truncated: true };
}
