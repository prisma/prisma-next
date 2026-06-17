import { type } from 'arktype';

export interface FormatOptions {
  readonly indent?: number | 'tab';
  readonly newline?: 'LF' | 'CRLF';
}

export interface ResolvedFormatOptions {
  readonly indentUnit: string;
  readonly newline: string;
}

const FormatOptionsSchema = type({
  'indent?': type('number.integer >= 1').or("'tab'"),
  'newline?': type("'LF'").or("'CRLF'"),
});

const DEFAULT_INDENT_WIDTH = 2;

export function resolveFormatOptions(options: FormatOptions | undefined): ResolvedFormatOptions {
  const validated = FormatOptionsSchema(options ?? {});
  if (validated instanceof type.errors) {
    throw new Error(`Invalid format options: ${validated.summary}`);
  }
  const indent = validated.indent ?? DEFAULT_INDENT_WIDTH;
  return {
    indentUnit: indent === 'tab' ? '\t' : ' '.repeat(indent),
    newline: validated.newline === 'CRLF' ? '\r\n' : '\n',
  };
}
