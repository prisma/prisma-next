import type { ColumnDefault, ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type { ContractSourceDiagnostic } from '@prisma-next/core-control-plane/config-types';
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

function createSpanFromBase(base: PslSpan, startOffset: number, endOffset: number): PslSpan {
  const safeStart = Math.max(0, startOffset);
  const safeEnd = Math.max(safeStart, endOffset);
  return {
    start: {
      offset: base.start.offset + safeStart,
      line: base.start.line,
      column: base.start.column + safeStart,
    },
    end: {
      offset: base.start.offset + safeEnd,
      line: base.start.line,
      column: base.start.column + safeEnd,
    },
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
  const args = parts
    .map((part) => {
      const raw = part.raw.trim();
      if (raw.length === 0) {
        return undefined;
      }
      const leadingPartWhitespace = part.raw.length - part.raw.trimStart().length;
      const argStart = leadingWhitespace + openParen + 1 + part.start + leadingPartWhitespace;
      const argEnd = argStart + raw.length;
      return {
        raw,
        span: createSpanFromBase(expressionSpan, argStart, argEnd),
      } satisfies DefaultFunctionArgument;
    })
    .filter((arg): arg is DefaultFunctionArgument => Boolean(arg));

  const functionStart = leadingWhitespace;
  const functionEnd = contentEnd;
  return {
    name: functionName,
    raw: trimmed,
    args,
    span: createSpanFromBase(expressionSpan, functionStart, functionEnd),
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

function executionGenerator(id: string, params?: Record<string, unknown>): LoweredDefaultResult {
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

export function createBuiltinDefaultFunctionRegistry(): DefaultFunctionRegistry {
  return new Map<string, DefaultFunctionLoweringHandler>([
    ['autoincrement', lowerAutoincrement],
    ['now', lowerNow],
    ['uuid', lowerUuid],
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

  if (input.call.name === 'cuid') {
    return {
      ok: false,
      diagnostic: {
        code: 'PSL_UNKNOWN_DEFAULT_FUNCTION',
        message:
          'Default function "cuid" is not supported in SQL PSL provider v1. Use `uuid()`, `uuid(7)`, `ulid()`, or `nanoid()` instead.',
        sourceId: input.context.sourceId,
        span: input.call.span,
      },
    };
  }

  return {
    ok: false,
    diagnostic: {
      code: 'PSL_UNKNOWN_DEFAULT_FUNCTION',
      message: `Default function "${input.call.name}" is not supported in SQL PSL provider v1. Supported functions: autoincrement(), now(), uuid(), uuid(7), ulid(), nanoid(), nanoid(n), dbgenerated("...").`,
      sourceId: input.context.sourceId,
      span: input.call.span,
    },
  };
}
