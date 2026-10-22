export interface Config {
  apiToken: string;
  baseUrl: string;
  timeoutMs: number;
}

export type Env = Readonly<Record<string, string | undefined>>;

const REQUIRED_KEYS = ["API_TOKEN", "BASE_URL"] as const;
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Reads the client configuration from environment variables.
 * Error messages name the keys only: a value may be a secret, so it never reaches a log.
 */
export function loadConfig(env: Env): Config {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`missing config keys: ${missing.join(", ")}`);
  }

  const baseUrl = env.BASE_URL as string;
  let protocol: string;
  try {
    protocol = new URL(baseUrl).protocol;
  } catch {
    throw new Error("invalid config key BASE_URL: expected an http or https URL");
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("invalid config key BASE_URL: expected an http or https URL");
  }

  const rawTimeout = env.TIMEOUT_MS;
  if (rawTimeout !== undefined && !/^[1-9]\d*$/.test(rawTimeout)) {
    throw new Error("invalid config key TIMEOUT_MS: expected a positive integer");
  }

  return {
    apiToken: env.API_TOKEN as string,
    baseUrl,
    timeoutMs: rawTimeout === undefined ? DEFAULT_TIMEOUT_MS : Number(rawTimeout),
  };
}

/** A one-line description safe for logs: the token is masked down to its last four characters. */
export function describeConfig(config: Config): string {
  const tail = config.apiToken.length > 4 ? config.apiToken.slice(-4) : "";
  return `apiToken=****${tail} baseUrl=${config.baseUrl} timeoutMs=${config.timeoutMs}`;
}
