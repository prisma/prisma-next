import { isCI } from './is-ci';

export type OutputFormat = 'pretty' | 'json';

const OUTPUT_FORMATS: readonly OutputFormat[] = ['pretty', 'json'];

export interface GlobalFlags {
  readonly format: OutputFormat;
  readonly json?: boolean;
  readonly quiet?: boolean;
  readonly verbose?: number;
  readonly color?: boolean;
  readonly interactive?: boolean;
  readonly yes?: boolean;
}

/**
 * Common options parsed by Commander.js for every command.
 * Extend this for command-specific options instead of duplicating these fields.
 */
export interface CommonCommandOptions {
  readonly format?: string;
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

function isJsonFlagSet(json: string | boolean | undefined): boolean {
  return json === true;
}

function resolveOutputFormat(options: CommonCommandOptions): OutputFormat {
  const formatOption = options.format;
  const jsonFlag = isJsonFlagSet(options.json);

  if (formatOption !== undefined) {
    if (formatOption !== 'pretty' && formatOption !== 'json') {
      throw new Error(
        `Invalid --format value "${formatOption}". Allowed values: ${OUTPUT_FORMATS.join(', ')}.`,
      );
    }
    if (jsonFlag && formatOption === 'pretty') {
      throw new Error(
        'Cannot use --format pretty together with --json. Use --format json or --json alone for JSON output.',
      );
    }
    return formatOption;
  }

  if (jsonFlag) {
    return 'json';
  }

  if (!process.stdout.isTTY) {
    return 'json';
  }

  return 'pretty';
}

/**
 * Parses global flags from CLI options.
 * Handles verbosity flags (-v, --trace), output format (--format, --json),
 * quiet mode, color, interactivity (--interactive/--no-interactive), and
 * auto-accept (-y/--yes).
 */
export function parseGlobalFlags(options: CommonCommandOptions): GlobalFlags {
  const format = resolveOutputFormat(options);
  const flags: {
    format: OutputFormat;
    json?: boolean;
    quiet?: boolean;
    verbose?: number;
    color?: boolean;
    interactive?: boolean;
    yes?: boolean;
  } = { format };

  if (format === 'json') {
    flags.json = true;
  }

  if (options.quiet || options.q) {
    flags.quiet = true;
  }

  if (options.trace || process.env['PRISMA_NEXT_TRACE'] === '1') {
    flags.verbose = 2;
  } else if (options.verbose || options.v || process.env['PRISMA_NEXT_DEBUG'] === '1') {
    flags.verbose = 1;
  } else {
    flags.verbose = 0;
  }

  if (process.env['NO_COLOR'] || flags.json) {
    flags.color = false;
  } else if (options['no-color']) {
    flags.color = false;
  } else if (options.color !== undefined) {
    flags.color = options.color;
  } else {
    flags.color = process.stdout.isTTY && !isCI();
  }

  if (options['no-interactive']) {
    flags.interactive = false;
  } else if (options.interactive !== undefined) {
    flags.interactive = options.interactive;
  } else {
    flags.interactive = !!process.stdout.isTTY;
  }

  if (options.yes || options.y) {
    flags.yes = true;
  }

  return flags as GlobalFlags;
}
