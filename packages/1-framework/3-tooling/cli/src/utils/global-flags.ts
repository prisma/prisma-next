export interface GlobalFlags {
  readonly json?: 'object' | 'ndjson';
  readonly quiet?: boolean;
  readonly verbose?: number; // 0, 1, or 2
  readonly timestamps?: boolean;
  readonly color?: boolean;
}

export interface CliOptions {
  readonly json?: string | boolean;
  readonly quiet?: boolean;
  readonly q?: boolean;
  readonly verbose?: boolean;
  readonly v?: boolean;
  readonly vv?: boolean;
  readonly trace?: boolean;
  readonly timestamps?: boolean;
  readonly color?: boolean;
  readonly 'no-color'?: boolean;
}

/**
 * Parses global flags from CLI options.
 * Handles verbosity flags (-v, -vv, --trace), JSON output, quiet mode, timestamps, and color.
 */
export function parseGlobalFlags(options: CliOptions): GlobalFlags {
  const flags: {
    json?: 'object' | 'ndjson';
    quiet?: boolean;
    verbose?: number;
    timestamps?: boolean;
    color?: boolean;
  } = {};

  // JSON output
  if (options.json === true || options.json === 'object') {
    flags.json = 'object';
  } else if (options.json === 'ndjson') {
    flags.json = 'ndjson';
  }

  // Quiet mode
  if (options.quiet || options.q) {
    flags.quiet = true;
  }

  // Verbosity: -v = 1, -vv or --trace = 2
  if (options.vv || options.trace) {
    flags.verbose = 2;
  } else if (options.verbose || options.v) {
    flags.verbose = 1;
  } else {
    flags.verbose = 0;
  }

  // Timestamps
  if (options.timestamps) {
    flags.timestamps = true;
  }

  // Color: respect NO_COLOR env var, --color/--no-color flags
  // When JSON output is enabled (any format), disable color to ensure clean JSON output
  if (process.env['NO_COLOR'] || flags.json) {
    flags.color = false;
  } else if (options['no-color']) {
    flags.color = false;
  } else if (options.color !== undefined) {
    flags.color = options.color;
  } else {
    // Default: enable color if TTY
    flags.color = process.stdout.isTTY && !process.env['CI'];
  }

  return flags as GlobalFlags;
}
