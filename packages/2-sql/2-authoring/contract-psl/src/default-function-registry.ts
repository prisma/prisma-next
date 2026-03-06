import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { ColumnDefault, ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type { PslSpan } from '@prisma-next/psl-parser';

interface DefaultFunctionArgument {
  readonly raw: string;
  readonly span: PslSpan;
}

export interface ParsedDefaultFunctionCall {
  readonly name: string;
  readonly raw: string;
  readonly args: readonly DefaultFunctionArgument[];
  readonly span: PslSpan;
}

export interface DefaultFunctionLoweringContext {
  readonly sourceId: string;
  readonly modelName: string;
  readonly fieldName: string;
}

type LoweredDefaultValue =
  | { readonly kind: 'storage'; readonly defaultValue: ColumnDefault }
  | { readonly kind: 'execution'; readonly generated: ExecutionMutationDefaultValue };

type LoweredDefaultResult =
  | { readonly ok: true; readonly value: LoweredDefaultValue }
  | { readonly ok: false; readonly diagnostic: ContractSourceDiagnostic };

export type DefaultFunctionLoweringHandler = (input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}) => LoweredDefaultResult;

export type DefaultFunctionRegistry = ReadonlyMap<string, DefaultFunctionLoweringHandler>;

function resolveSpanPositionFromBase(
  base: PslSpan,
  text: string,
  offset: number,
): PslSpan['start'] {
  const safeOffset = Math.min(Math.max(0, offset), text.length);
  let line = base.start.line;
  let column = base.start.column;

  for (let index = 0; index < safeOffset; index += 1) {
    const character = text[index] ?? '';
    if (character === '\r') {
      if (text[index + 1] === '\n' && index + 1 < safeOffset) {
        index += 1;
      }
      line += 1;
      column = 1;
      continue;
    }
    if (character === '\n') {
      line += 1;
      column = 1;
      continue;
    }
    column += 1;
  }

  return {
    offset: base.start.offset + safeOffset,
    line,
    column,
  };
}

function createSpanFromBase(
  base: PslSpan,
  startOffset: number,
  endOffset: number,
  text: string,
): PslSpan {
  const safeStart = Math.max(0, Math.min(startOffset, text.length));
  const safeEnd = Math.max(safeStart, Math.min(endOffset, text.length));
  return {
    start: resolveSpanPositionFromBase(base, text, safeStart),
    end: resolveSpanPositionFromBase(base, text, safeEnd),
  };
}

function splitTopLevelArgs(raw: string): Array<{ raw: string; start: number; end: number }> {
  if (raw.trim().length === 0) {
    return [];
  }

  const parts: Array<{ raw: string; start: number; end: number }> = [];
  let depthParen = 0;
  let depthBracket = 0;
  let quote: '"' | "'" | null = null;
  let start = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index] ?? '';
    if (quote) {
      if (character === quote && raw[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === '(') {
      depthParen += 1;
      continue;
    }
    if (character === ')') {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }
    if (character === '[') {
      depthBracket += 1;
      continue;
    }
    if (character === ']') {
      depthBracket = Math.max(0, depthBracket - 1);
      continue;
    }

    if (character === ',' && depthParen === 0 && depthBracket === 0) {
      parts.push({
        raw: raw.slice(start, index),
        start,
        end: index,
      });
      start = index + 1;
    }
  }

  parts.push({
    raw: raw.slice(start),
    start,
    end: raw.length,
  });

  return parts;
}

export function parseDefaultFunctionCall(
  expression: string,
  expressionSpan: PslSpan,
): ParsedDefaultFunctionCall | undefined {
  const trimmed = expression.trim();
  const leadingWhitespace = expression.length - expression.trimStart().length;
  const trailingWhitespace = expression.length - expression.trimEnd().length;
  const contentEnd = expression.length - trailingWhitespace;

  const openParen = trimmed.indexOf('(');
  const closeParen = trimmed.lastIndexOf(')');
  if (openParen <= 0 || closeParen !== trimmed.length - 1) {
    return undefined;
  }

  const functionName = trimmed.slice(0, openParen).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(functionName)) {
    return undefined;
  }

  const functionArgsRaw = trimmed.slice(openParen + 1, closeParen);
  const parts = splitTopLevelArgs(functionArgsRaw);
  const args: DefaultFunctionArgument[] = [];
  for (const part of parts) {
    const raw = part.raw.trim();
    if (raw.length === 0) {
      return undefined;
    }
    const leadingPartWhitespace = part.raw.length - part.raw.trimStart().length;
    const argStart = leadingWhitespace + openParen + 1 + part.start + leadingPartWhitespace;
    const argEnd = argStart + raw.length;
    args.push({
      raw,
      span: createSpanFromBase(expressionSpan, argStart, argEnd, expression),
    });
  }

  const functionStart = leadingWhitespace;
  const functionEnd = contentEnd;
  return {
    name: functionName,
    raw: trimmed,
    args,
    span: createSpanFromBase(expressionSpan, functionStart, functionEnd, expression),
  };
}

function invalidArgumentDiagnostic(input: {
  readonly context: DefaultFunctionLoweringContext;
  readonly span: PslSpan;
  readonly message: string;
}): LoweredDefaultResult {
  return {
    ok: false,
    diagnostic: {
      code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
      message: input.message,
      sourceId: input.context.sourceId,
      span: input.span,
    },
  };
}

function executionGenerator(
  id: ExecutionMutationDefaultValue['id'],
  params?: Record<string, unknown>,
): LoweredDefaultResult {
  return {
    ok: true,
    value: {
      kind: 'execution',
      generated: {
        kind: 'generator',
        id,
        ...(params ? { params } : {}),
      },
    },
  };
}

function expectNoArgs(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
  readonly usage: string;
}): LoweredDefaultResult | undefined {
  if (input.call.args.length === 0) {
    return undefined;
  }
  return invalidArgumentDiagnostic({
    context: input.context,
    span: input.call.span,
    message: `Default function "${input.call.name}" does not accept arguments. Use ${input.usage}.`,
  });
}

function parseIntegerArgument(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return undefined;
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value)) {
    return undefined;
  }
  return value;
}

function parseStringLiteral(raw: string): string | undefined {
  const match = raw.trim().match(/^(['"])(.*)\1$/s);
  if (!match) {
    return undefined;
  }
  return match[2] ?? '';
}

function lowerAutoincrement(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  const maybeNoArgs = expectNoArgs({
    call: input.call,
    context: input.context,
    usage: '`autoincrement()`',
  });
  if (maybeNoArgs) {
    return maybeNoArgs;
  }
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: {
        kind: 'function',
        expression: 'autoincrement()',
      },
    },
  };
}

function lowerNow(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  const maybeNoArgs = expectNoArgs({
    call: input.call,
    context: input.context,
    usage: '`now()`',
  });
  if (maybeNoArgs) {
    return maybeNoArgs;
  }
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: {
        kind: 'function',
        expression: 'now()',
      },
    },
  };
}

function lowerUuid(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  if (input.call.args.length === 0) {
    return executionGenerator('uuidv4');
  }
  if (input.call.args.length !== 1) {
    return invalidArgumentDiagnostic({
      context: input.context,
      span: input.call.span,
      message:
        'Default function "uuid" accepts at most one version argument: `uuid()`, `uuid(4)`, or `uuid(7)`.',
    });
  }
  const version = parseIntegerArgument(input.call.args[0]?.raw ?? '');
  if (version === 4) {
    return executionGenerator('uuidv4');
  }
  if (version === 7) {
    return executionGenerator('uuidv7');
  }
  return invalidArgumentDiagnostic({
    context: input.context,
    span: input.call.args[0]?.span ?? input.call.span,
    message:
      'Default function "uuid" supports only `uuid()`, `uuid(4)`, or `uuid(7)` in SQL PSL provider v1.',
  });
}

function lowerCuid(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  if (input.call.args.length === 0) {
    return {
      ok: false,
      diagnostic: {
        code: 'PSL_UNKNOWN_DEFAULT_FUNCTION',
        message:
          'Default function "cuid()" is not supported in SQL PSL provider v1. Use `cuid(2)` instead.',
        sourceId: input.context.sourceId,
        span: input.call.span,
      },
    };
  }
  if (input.call.args.length !== 1) {
    return invalidArgumentDiagnostic({
      context: input.context,
      span: input.call.span,
      message: 'Default function "cuid" accepts exactly one version argument: `cuid(2)`.',
    });
  }
  const version = parseIntegerArgument(input.call.args[0]?.raw ?? '');
  if (version === 2) {
    return executionGenerator('cuid2');
  }
  return invalidArgumentDiagnostic({
    context: input.context,
    span: input.call.args[0]?.span ?? input.call.span,
    message: 'Default function "cuid" supports only `cuid(2)` in SQL PSL provider v1.',
  });
}

function lowerUlid(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  const maybeNoArgs = expectNoArgs({
    call: input.call,
    context: input.context,
    usage: '`ulid()`',
  });
  if (maybeNoArgs) {
    return maybeNoArgs;
  }
  return executionGenerator('ulid');
}

function lowerNanoid(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  if (input.call.args.length === 0) {
    return executionGenerator('nanoid');
  }
  if (input.call.args.length !== 1) {
    return invalidArgumentDiagnostic({
      context: input.context,
      span: input.call.span,
      message:
        'Default function "nanoid" accepts at most one size argument: `nanoid()` or `nanoid(<2-255>)`.',
    });
  }
  const size = parseIntegerArgument(input.call.args[0]?.raw ?? '');
  if (size !== undefined && size >= 2 && size <= 255) {
    return executionGenerator('nanoid', { size });
  }
  return invalidArgumentDiagnostic({
    context: input.context,
    span: input.call.args[0]?.span ?? input.call.span,
    message: 'Default function "nanoid" size argument must be an integer between 2 and 255.',
  });
}

function lowerDbgenerated(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  if (input.call.args.length !== 1) {
    return invalidArgumentDiagnostic({
      context: input.context,
      span: input.call.span,
      message:
        'Default function "dbgenerated" requires exactly one string argument: `dbgenerated("...")`.',
    });
  }
  const rawExpression = parseStringLiteral(input.call.args[0]?.raw ?? '');
  if (rawExpression === undefined) {
    return invalidArgumentDiagnostic({
      context: input.context,
      span: input.call.args[0]?.span ?? input.call.span,
      message: 'Default function "dbgenerated" argument must be a string literal.',
    });
  }
  if (rawExpression.trim().length === 0) {
    return invalidArgumentDiagnostic({
      context: input.context,
      span: input.call.args[0]?.span ?? input.call.span,
      message: 'Default function "dbgenerated" argument cannot be empty.',
    });
  }
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: {
        kind: 'function',
        expression: rawExpression,
      },
    },
  };
}

const supportedFunctionUsageByName: Readonly<Record<string, readonly string[]>> = {
  autoincrement: ['autoincrement()'],
  now: ['now()'],
  uuid: ['uuid()', 'uuid(4)', 'uuid(7)'],
  cuid: ['cuid(2)'],
  ulid: ['ulid()'],
  nanoid: ['nanoid()', 'nanoid(n)'],
  dbgenerated: ['dbgenerated("...")'],
};

const unknownFunctionSuggestionsByName: Readonly<Record<string, string>> = {
  cuid2: 'Use `cuid(2)`.',
  uuidv4: 'Use `uuid()` or `uuid(4)`.',
  uuidv7: 'Use `uuid(7)`.',
};

function formatSupportedFunctionList(registry: DefaultFunctionRegistry): string {
  const signatures = Array.from(registry.keys())
    .sort()
    .flatMap((functionName) => supportedFunctionUsageByName[functionName] ?? [`${functionName}()`]);
  return signatures.length > 0 ? signatures.join(', ') : 'none';
}

export function createBuiltinDefaultFunctionRegistry(): DefaultFunctionRegistry {
  return new Map<string, DefaultFunctionLoweringHandler>([
    ['autoincrement', lowerAutoincrement],
    ['now', lowerNow],
    ['uuid', lowerUuid],
    ['cuid', lowerCuid],
    ['ulid', lowerUlid],
    ['nanoid', lowerNanoid],
    ['dbgenerated', lowerDbgenerated],
  ]);
}

export function lowerDefaultFunctionWithRegistry(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly registry: DefaultFunctionRegistry;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  const handler = input.registry.get(input.call.name);
  if (handler) {
    return handler({ call: input.call, context: input.context });
  }
  const supportedFunctionList = formatSupportedFunctionList(input.registry);
  const suggestion = unknownFunctionSuggestionsByName[input.call.name];

  return {
    ok: false,
    diagnostic: {
      code: 'PSL_UNKNOWN_DEFAULT_FUNCTION',
      message: `Default function "${input.call.name}" is not supported in SQL PSL provider v1. Supported functions: ${supportedFunctionList}.${suggestion ? ` ${suggestion}` : ''}`,
      sourceId: input.context.sourceId,
      span: input.call.span,
    },
  };
}
