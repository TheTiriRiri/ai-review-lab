import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// promptfoo renders every test var as a Nunjucks template before it fills {{diff}} in the prompt, so template
// syntax inside a fixture would reach the model altered. PROMPTFOO_DISABLE_TEMPLATING is no way out: it also
// leaves {{diff}} itself unfilled. The fixture diffs therefore stay free of template syntax.
const FIXTURES = new URL("./fixtures/", import.meta.url);
const CONFIG = readFileSync(new URL("./promptfooconfig.yaml", import.meta.url), "utf8");
const TEMPLATE_SYNTAX = /\{\{|\{%|\{#/;
const diffs = readdirSync(FIXTURES).filter((name) => name.endsWith(".diff"));

describe("eval fixture diffs", () => {
  it("include every diff the promptfoo config reads", () => {
    const used = [...CONFIG.matchAll(/file:\/\/fixtures\/([^\s"']+)/g)].map(([, name]) => name);
    expect(used).not.toHaveLength(0);
    expect(diffs).toEqual(expect.arrayContaining(used));
  });

  it.each(diffs)("%s carries no Nunjucks syntax", (name) => {
    expect(readFileSync(new URL(name, FIXTURES), "utf8")).not.toMatch(TEMPLATE_SYNTAX);
  });
});
