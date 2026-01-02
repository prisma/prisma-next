/**
 * Minimal metadata extracted from a database URL for logging or error output.
 * Sensitive fields (password, full URL) are never returned.
 */
export interface RedactedDatabaseUrl {
  readonly host?: string;
  readonly port?: string;
  readonly database?: string;
  readonly username?: string;
}

/**
 * Redacts a database connection URL to a minimal metadata object.
 *
 * Parsing errors are ignored and result in an empty object so callers never
 * leak raw URLs when the input is malformed.
 */
export function redactDatabaseUrl(url: string): RedactedDatabaseUrl {
  const redacted: RedactedDatabaseUrl = {};
  try {
    const parsed = new URL(url);
    if (parsed.hostname) {
      redacted.host = parsed.hostname;
    }
    if (parsed.port) {
      redacted.port = parsed.port;
    }
    if (parsed.pathname) {
      const database = parsed.pathname.replace(/^\//, '');
      if (database) {
        redacted.database = database;
      }
    }
    if (parsed.username) {
      redacted.username = parsed.username;
    }
  } catch {
    // Ignore parsing errors; return whatever metadata we managed to collect
  }
  return redacted;
}
