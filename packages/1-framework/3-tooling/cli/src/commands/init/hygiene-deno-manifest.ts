import {
  applyEdits,
  modify,
  type ParseError,
  parse as parseJsonc,
  printParseErrorCode,
} from 'jsonc-parser';

export interface DenoImportsMergeResult {
  readonly content: string | null;
}

export class DenoManifestParseError extends Error {
  readonly errors: readonly ParseError[];

  constructor(errors: readonly ParseError[]) {
    super(formatDenoManifestParseErrors(errors));
    this.errors = errors;
    this.name = 'DenoManifestParseError';
  }
}

export function mergeDenoImports(
  existing: string,
  packages: readonly string[],
): DenoImportsMergeResult {
  const { config } = parseDenoManifestText(existing);
  const imports =
    typeof config['imports'] === 'object' &&
    config['imports'] !== null &&
    !Array.isArray(config['imports'])
      ? (config['imports'] as Record<string, unknown>)
      : {};

  const formattingOptions = {
    tabSize: detectIndent(existing),
    insertSpaces: true,
    eol: existing.includes('\r\n') ? '\r\n' : '\n',
  };

  let result = existing;
  let mutated = false;

  for (const name of packages) {
    const specifier = `npm:${name}@latest`;
    if (imports[name] === specifier) {
      continue;
    }
    const edits = modify(result, ['imports', name], specifier, { formattingOptions });
    result = applyEdits(result, edits);
    mutated = true;
  }

  return { content: mutated ? result : null };
}

function parseDenoManifestText(text: string): { readonly config: Record<string, unknown> } {
  const errors: ParseError[] = [];
  const value = parseJsonc(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
    allowEmptyContent: false,
  });

  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DenoManifestParseError(errors);
  }
  if (errors.length > 0) {
    throw new DenoManifestParseError(errors);
  }
  return { config: value as Record<string, unknown> };
}

function formatDenoManifestParseErrors(errors: readonly ParseError[]): string {
  if (errors.length === 0) {
    return 'Deno manifest is empty or not an object';
  }
  return errors.map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`).join('; ');
}

function detectIndent(text: string): number {
  const match = text.match(/^([ \t]+)\S/m);
  if (match === null) {
    return 2;
  }
  const indent = match[1] ?? '';
  if (indent.startsWith('\t')) {
    return 1;
  }
  return indent.length || 2;
}
