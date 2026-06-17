import { readFile, writeFile } from 'node:fs/promises';
import { EOL } from 'node:os';
import { type FormatOptions, format, PslFormatError } from '@prisma-next/psl-parser/format';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { loadConfig } from '../../config-loader';
import { CliStructuredError, errorRuntime, errorUnexpected } from '../../utils/cli-errors';

export interface FormatOperationOptions {
  /** Path to the prisma-next.config.ts file. */
  readonly configPath?: string;
  /**
   * System newline string used when `formatter.newline` is absent. Defaults to
   * `os.EOL`; injectable so the resolution is testable without touching
   * `process`/`os`. This is the ONLY place `os.EOL` enters the format flow —
   * the engine never reads `os`.
   */
  readonly eol?: string;
}

export interface FormatOperationResult {
  /** Whether the source was a PSL file that got rewritten in place. */
  readonly formatted: boolean;
  /** Absolute path that was formatted; undefined when nothing was formatted. */
  readonly path?: string;
}

/**
 * Resolves the engine `newline` option: an explicit `formatter.newline` wins;
 * otherwise the system EOL maps `\r\n` → `CRLF` and anything else → `LF`.
 */
export function resolveNewline(
  formatterNewline: 'LF' | 'CRLF' | undefined,
  eol: string,
): 'LF' | 'CRLF' {
  if (formatterNewline !== undefined) {
    return formatterNewline;
  }
  return eol === '\r\n' ? 'CRLF' : 'LF';
}

/**
 * Formats the contract source file in place when it is PSL.
 *
 * Loads the config, reads `config.contract.source.sourceFormat`: anything other
 * than `'psl'` (including absent) is left untouched and reported as "nothing to
 * format" (`formatted: false`). For PSL, it reads `inputs[0]` (resolved to an
 * absolute path by the config loader), formats it via the PSL formatter engine,
 * and writes the result back to the same file. A `PslFormatError` surfaces as a
 * structured CLI error with no partial write.
 */
export async function executeFormat(
  options: FormatOperationOptions,
): Promise<Result<FormatOperationResult, CliStructuredError>> {
  const eol = options.eol ?? EOL;

  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig(options.configPath);
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    return notOk(errorUnexpected(error instanceof Error ? error.message : String(error)));
  }

  const source = config.contract?.source;
  if (source?.sourceFormat !== 'psl') {
    return ok({ formatted: false });
  }

  const inputPath = source.inputs?.[0];
  if (inputPath === undefined) {
    return ok({ formatted: false });
  }

  let contents: string;
  try {
    contents = await readFile(inputPath, 'utf-8');
  } catch (error) {
    return notOk(
      errorRuntime('Failed to read contract source file', {
        why: error instanceof Error ? error.message : String(error),
        fix: `Check that ${inputPath} exists and is readable.`,
      }),
    );
  }

  const formatOptions: FormatOptions = {
    indent: config.formatter?.indent ?? 2,
    newline: resolveNewline(config.formatter?.newline, eol),
  };

  let formatted: string;
  try {
    formatted = format(contents, formatOptions);
  } catch (error) {
    if (error instanceof PslFormatError) {
      return notOk(
        errorRuntime('Cannot format PSL with parse errors', {
          why: error.message,
          fix: 'Fix the parse errors in your schema and try again.',
          meta: { diagnostics: error.diagnostics },
        }),
      );
    }
    return notOk(errorUnexpected(error instanceof Error ? error.message : String(error)));
  }

  await writeFile(inputPath, formatted, 'utf-8');

  return ok({ formatted: true, path: inputPath });
}
