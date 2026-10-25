import { describe, expect, it } from "vitest";

import { addBusinessDays, daysBetween, parseIsoDate } from "../src/date-range.js";

describe("parseIsoDate", () => {
  it("parses YYYY-MM-DD as UTC midnight", () => {
    const d = parseIsoDate("2026-10-22");
    expect(d.toISOString()).toBe("2026-10-22T00:00:00.000Z");
  });

  it("rejects a calendar date that does not exist", () => {
    expect(() => parseIsoDate("2026-02-30")).toThrow(/2026-02-30/);
    expect(() => parseIsoDate("2026-13-01")).toThrow(/2026-13-01/);
  });

  it("rejects anything that is not exactly YYYY-MM-DD", () => {
    for (const input of ["2026-1-1", "20261022", "2026-10-22T00:00:00Z", " 2026-10-22", ""]) {
      expect(() => parseIsoDate(input), input).toThrow(/YYYY-MM-DD/);
    }
  });
});

describe("daysBetween", () => {
  it("counts whole UTC days from the first date to the second", () => {
    expect(daysBetween(parseIsoDate("2026-10-20"), parseIsoDate("2026-10-22"))).toBe(2);
  });

  it("is negative when the second date is earlier", () => {
    expect(daysBetween(parseIsoDate("2026-10-22"), parseIsoDate("2026-10-20"))).toBe(-2);
  });

  it("is zero for the same date", () => {
    const d = parseIsoDate("2026-10-22");
    expect(daysBetween(d, d)).toBe(0);
  });

  it("ignores the time of day", () => {
    const lateEvening = new Date("2026-10-20T23:59:00.000Z");
    const earlyMorning = new Date("2026-10-21T00:01:00.000Z");
    expect(daysBetween(lateEvening, earlyMorning)).toBe(1);
  });
});

describe("addBusinessDays", () => {
  it("skips the weekend when stepping forward from a Friday", () => {
    expect(addBusinessDays(parseIsoDate("2026-10-23"), 1).toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });

  it("adds five business days across one weekend", () => {
    expect(addBusinessDays(parseIsoDate("2026-10-21"), 5).toISOString()).toBe("2026-10-28T00:00:00.000Z");
  });

  it("returns the same date for zero days", () => {
    expect(addBusinessDays(parseIsoDate("2026-10-22"), 0).toISOString()).toBe("2026-10-22T00:00:00.000Z");
  });

  it("does not mutate the start date", () => {
    const start = parseIsoDate("2026-10-22");
    addBusinessDays(start, 3);
    expect(start.toISOString()).toBe("2026-10-22T00:00:00.000Z");
  });

  it("steps back over the weekend for a negative count", () => {
    expect(addBusinessDays(parseIsoDate("2026-10-26"), -1).toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });

  it("subtracts five business days across one weekend", () => {
    expect(addBusinessDays(parseIsoDate("2026-10-28"), -5).toISOString()).toBe("2026-10-21T00:00:00.000Z");
  });

  it("counts back to the previous Friday from a weekend start", () => {
    expect(addBusinessDays(parseIsoDate("2026-10-25"), -1).toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });
});
