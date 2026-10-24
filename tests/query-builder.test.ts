import { describe, expect, it } from "vitest";

import { assertIdentifier, select } from "../src/query-builder.js";

describe("select", () => {
  it("builds a plain select without conditions", () => {
    expect(select("users").build()).toEqual({ sql: "SELECT * FROM users", params: [] });
  });

  it("parameterizes every where value in order", () => {
    const query = select("users").where("age", ">=", 18).where("name", "LIKE", "A%").build();
    expect(query).toEqual({
      sql: "SELECT * FROM users WHERE age >= $1 AND name LIKE $2",
      params: [18, "A%"],
    });
  });

  it("appends a limit after the conditions", () => {
    expect(select("users").where("active", "=", true).limit(5).build().sql).toBe(
      "SELECT * FROM users WHERE active = $1 LIMIT 5",
    );
  });

  it("sorts by the given expression before the limit", () => {
    expect(select("users").orderBy("created_at DESC").limit(10).build().sql).toBe(
      "SELECT * FROM users ORDER BY created_at DESC LIMIT 10",
    );
  });

  it("rejects a limit that is not a positive integer", () => {
    expect(() => select("users").limit(0)).toThrow(/limit/);
    expect(() => select("users").limit(1.5)).toThrow(/limit/);
  });

  it("rejects a table name that is not a bare identifier", () => {
    expect(() => select("users; DROP TABLE users")).toThrow(/identifier/);
  });

  it("rejects non-identifier column names", () => {
    expect(() => select("users").where("name OR 1=1", "=", "x")).toThrow(/identifier/);
    expect(() => select("users").where("u.name", "=", "x")).toThrow(/identifier/);
  });

  it("rejects an operator outside the whitelist", () => {
    expect(() => select("users").where("name", "IN" as never, "x")).toThrow(/operator/);
  });

  it("does not interpolate values into the sql text", () => {
    const { sql } = select("users").where("name", "=", "'; DROP TABLE users; --").build();
    expect(sql).not.toContain("DROP");
  });
});

describe("assertIdentifier", () => {
  it("accepts letters, digits and underscores starting with a letter or underscore", () => {
    for (const name of ["users", "_tmp", "user_2", "Order"]) {
      expect(() => assertIdentifier(name), name).not.toThrow();
    }
  });

  it("rejects everything else", () => {
    for (const name of ["2fast", "user-name", "users table", "", "ünïcode", "a.b"]) {
      expect(() => assertIdentifier(name), name).toThrow(/identifier/);
    }
  });
});
