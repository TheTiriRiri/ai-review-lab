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

const FILE_HEADER = /^diff --git a\/.+? b\/(.+)$/;
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

/** Splits a diff at its `diff --git` headers; text before the first header is a section without a path. */
function splitFiles(diff: string): FileSection[] {
  const sections: FileSection[] = [];
  let current: FileSection | undefined;
  for (const line of diff.split(/(?<=\n)/)) {
    const header = FILE_HEADER.exec(line.replace(/\r?\n$/, ""));
    if (header || !current) {
      current = { path: header?.[1], text: "" };
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
