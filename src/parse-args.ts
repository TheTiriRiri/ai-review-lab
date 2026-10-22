export type OutputFormat = "json" | "text";

export interface Options {
  limit: number;
  verbose: boolean;
  format: OutputFormat;
}

const DEFAULTS: Options = { limit: 10, verbose: false, format: "text" };

/**
 * Parses `--flag` and `--flag=value` arguments into typed options.
 * Unknown flags and malformed values throw, so a typo never falls back to a default silently.
 */
export function parseArgs(argv: readonly string[]): Options {
  const options: Options = { ...DEFAULTS };

  for (const arg of argv) {
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const value = eq === -1 ? undefined : arg.slice(eq + 1);

    switch (name) {
      case "--limit": {
        if (value === undefined || !/^[1-9]\d*$/.test(value)) {
          throw new Error(`--limit must be a positive integer`);
        }
        options.limit = Number(value);
        break;
      }
      case "--verbose": {
        if (value !== undefined) {
          throw new Error(`--verbose takes no value`);
        }
        options.verbose = true;
        break;
      }
      case "--format": {
        if (value !== "json" && value !== "text") {
          throw new Error(`--format must be "json" or "text"`);
        }
        options.format = value;
        break;
      }
      default:
        throw new Error(`unknown flag "${name}"`);
    }
  }

  return options;
}
