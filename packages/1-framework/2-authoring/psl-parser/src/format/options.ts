export interface FormatOptions {
  readonly indent?: number | 'tab';
  readonly newline?: 'LF' | 'CRLF';
}

export interface ResolvedFormatOptions {
  readonly indentUnit: string;
  readonly newline: string;
}

export function resolveFormatOptions(options: FormatOptions | undefined): ResolvedFormatOptions {
  const indent = options?.indent ?? 2;
  if (indent !== 'tab' && (typeof indent !== 'number' || !Number.isInteger(indent) || indent < 1)) {
    throw new TypeError(
      `Invalid format options: indent must be a positive integer or 'tab', got ${String(indent)}`,
    );
  }
  const newline = options?.newline ?? 'LF';
  if (newline !== 'LF' && newline !== 'CRLF') {
    throw new TypeError(
      `Invalid format options: newline must be 'LF' or 'CRLF', got ${String(newline)}`,
    );
  }
  return {
    indentUnit: indent === 'tab' ? '\t' : ' '.repeat(indent),
    newline: newline === 'CRLF' ? '\r\n' : '\n',
  };
}
