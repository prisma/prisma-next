export interface GlobalFlags {
  readonly json?: boolean;
  readonly quiet?: boolean;
  readonly verbose?: number; // 0, 1, or 2
  readonly color?: boolean;
  readonly interactive?: boolean;
  readonly yes?: boolean;
}

/**
 * Common options parsed by Commander.js for every command.
 * Extend this for command-specific options instead of duplicating these fields.
 */
export interface CommonCommandOptions {
  readonly json?: string | boolean;
  readonly quiet?: boolean;
  readonly q?: boolean;
  readonly verbose?: boolean;
  readonly v?: boolean;
  readonly trace?: boolean;
  readonly color?: boolean;
  readonly 'no-color'?: boolean;
  readonly interactive?: boolean;
  readonly 'no-interactive'?: boolean;
  readonly yes?: boolean;
  readonly y?: boolean;
}

/**
 * Parses global flags from CLI options.
 * Handles verbosity flags (-v, --trace), JSON output, quiet mode, color,
 * interactivity (--interactive/--no-interactive), and auto-accept (-y/--yes).
 */
export function parseGlobalFlags(options: CommonCommandOptions): GlobalFlags {
  const flags: {
    json?: boolean;
    quiet?: boolean;
    verbose?: number;
    color?: boolean;
    interactive?: boolean;
    yes?: boolean;
  } = {};

  // JSON output: explicit --json flag or auto-detect piped stdout (Unix convention)
  if (options.json || !process.stdout.isTTY) {
    flags.json = true;
  }

  // Quiet mode
  if (options.quiet || options.q) {
    flags.quiet = true;
  }

  // Verbosity: -v = 1, --trace = 2
  // Env toggles: PRISMA_NEXT_TRACE=1 ≅ --trace, PRISMA_NEXT_DEBUG=1 ≅ -v
  if (options.trace || process.env['PRISMA_NEXT_TRACE'] === '1') {
    flags.verbose = 2;
  } else if (options.verbose || options.v || process.env['PRISMA_NEXT_DEBUG'] === '1') {
    flags.verbose = 1;
  } else {
    flags.verbose = 0;
  }

  // Color: respect NO_COLOR env var, --color/--no-color flags
  // When JSON output is enabled, disable color to ensure clean JSON output
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

  // Interactivity: --interactive/--no-interactive
  // Default: interactive when stdout is a TTY
  if (options['no-interactive']) {
    flags.interactive = false;
  } else if (options.interactive !== undefined) {
    flags.interactive = options.interactive;
  } else {
    flags.interactive = !!process.stdout.isTTY;
  }

  // Auto-accept prompts: -y/--yes
  if (options.yes || options.y) {
    flags.yes = true;
  }

  return flags as GlobalFlags;
}
