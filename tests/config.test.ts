import { describe, expect, it } from "vitest";

import { describeConfig, loadConfig } from "../src/config.js";

const env = {
  API_TOKEN: "secret-token-value-abcd",
  BASE_URL: "https://api.example.test",
  TIMEOUT_MS: "2500",
};

describe("loadConfig", () => {
  it("reads the token, base url and timeout", () => {
    expect(loadConfig(env)).toEqual({
      apiToken: "secret-token-value-abcd",
      baseUrl: "https://api.example.test",
      timeoutMs: 2500,
    });
  });

  it("defaults the timeout to 5000 ms", () => {
    const { TIMEOUT_MS: _omitted, ...withoutTimeout } = env;
    expect(loadConfig(withoutTimeout).timeoutMs).toBe(5000);
  });

  it("lists every missing key in one error", () => {
    expect(() => loadConfig({})).toThrow("missing config keys: API_TOKEN, BASE_URL");
  });

  it("names the key, never the value, when the base url is invalid", () => {
    let message = "";
    try {
      loadConfig({ ...env, BASE_URL: "not-a-url" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/BASE_URL/);
    expect(message).not.toContain("not-a-url");
  });

  it("rejects a base url that is not http or https", () => {
    expect(() => loadConfig({ ...env, BASE_URL: "ftp://files.example.test" })).toThrow(/BASE_URL/);
  });

  it("rejects a timeout that is not a positive integer", () => {
    expect(() => loadConfig({ ...env, TIMEOUT_MS: "abc" })).toThrow(/TIMEOUT_MS/);
    expect(() => loadConfig({ ...env, TIMEOUT_MS: "-1" })).toThrow(/TIMEOUT_MS/);
  });
});

describe("describeConfig", () => {
  it("never contains the raw token", () => {
    const text = describeConfig(loadConfig(env));
    expect(text).not.toContain("secret-token-value-abcd");
  });

  it("shows only the last four characters of the token", () => {
    expect(describeConfig(loadConfig(env))).toContain("apiToken=****abcd");
  });

  it("shows the base url and timeout in clear", () => {
    const text = describeConfig(loadConfig(env));
    expect(text).toContain("baseUrl=https://api.example.test");
    expect(text).toContain("timeoutMs=2500");
  });
});
