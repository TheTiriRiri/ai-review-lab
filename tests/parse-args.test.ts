import { describe, expect, it } from "vitest";

import { parseArgs } from "../src/parse-args.js";

describe("parseArgs", () => {
  it("returns the defaults when no flags are given", () => {
    expect(parseArgs([])).toEqual({ limit: 10, verbose: false, format: "text" });
  });

  it("parses --limit, --verbose and --format", () => {
    expect(parseArgs(["--limit=25", "--verbose", "--format=json"])).toEqual({
      limit: 25,
      verbose: true,
      format: "json",
    });
  });

  it("rejects an unknown flag and names it", () => {
    expect(() => parseArgs(["--colour=red"])).toThrow(/unknown flag "--colour"/);
  });

  it("rejects a limit that is not a positive integer", () => {
    expect(() => parseArgs(["--limit=abc"])).toThrow(/--limit/);
    expect(() => parseArgs(["--limit=0"])).toThrow(/--limit/);
    expect(() => parseArgs(["--limit=2.5"])).toThrow(/--limit/);
  });

  it("rejects a format outside json and text", () => {
    expect(() => parseArgs(["--format=xml"])).toThrow(/--format/);
  });

  it("rejects a value given to the boolean --verbose flag", () => {
    expect(() => parseArgs(["--verbose=yes"])).toThrow(/--verbose/);
  });
});
