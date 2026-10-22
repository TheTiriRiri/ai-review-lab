import { describe, expect, it } from "vitest";

import stripFences from "./strip-fences.js";

describe("strip-fences transform", () => {
  it("removes a json code fence around the object", () => {
    expect(stripFences('```json\n{"verdict":"fail"}\n```')).toBe('{"verdict":"fail"}');
  });

  it("removes a bare fence together with the whitespace around it", () => {
    expect(stripFences('\n  ```\n{"verdict":"pass"}\n```  \n')).toBe('{"verdict":"pass"}');
  });

  it("returns unfenced output trimmed and otherwise unchanged", () => {
    expect(stripFences('  {"summary":"use ```code``` here"}\n')).toBe('{"summary":"use ```code``` here"}');
  });

  it("passes output that is not a string through untouched", () => {
    const parsed = { verdict: "pass" };
    expect(stripFences(parsed)).toBe(parsed);
  });
});
