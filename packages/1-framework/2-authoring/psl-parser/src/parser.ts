import { ifDefined } from '@prisma-next/utils/defined';
import type {
  ParsePslDocumentInput,
  ParsePslDocumentResult,
  PslAttribute,
  PslAttributeArgument,
  PslAttributeTarget,
  PslDiagnostic,
  PslDiagnosticCode,
  PslDocumentAst,
  PslEnum,
  PslEnumValue,
  PslField,
  PslFieldAttribute,
  PslModel,
  PslModelAttribute,
  PslNamedTypeDeclaration,
  PslPosition,
  PslSpan,
  PslTypesBlock,
} from './types';

const SCALAR_TYPES = new Set([
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'DateTime',
  'Json',
  'Bytes',
]);

interface BlockBounds {
  readonly startLine: number;
  readonly endLine: number;
  readonly closed: boolean;
}

interface ParserContext {
  readonly schema: string;
  readonly sourceId: string;
  readonly lines: readonly string[];
  readonly lineOffsets: readonly number[];
  readonly diagnostics: PslDiagnostic[];
}

export function parsePslDocument(input: ParsePslDocumentInput): ParsePslDocumentResult {
  const normalizedSchema = input.schema.replaceAll('\r\n', '\n');
  const lines = normalizedSchema.split('\n');
  const lineOffsets = computeLineOffsets(normalizedSchema);
  const diagnostics: PslDiagnostic[] = [];
  const context: ParserContext = {
    schema: normalizedSchema,
    sourceId: input.sourceId,
    lines,
    lineOffsets,
    diagnostics,
  };

  const models: PslModel[] = [];
  const enums: PslEnum[] = [];
  let typesBlock: PslTypesBlock | undefined;

  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const rawLine = lines[lineIndex] ?? '';
    const line = stripInlineComment(rawLine).trim();
    if (line.length === 0) {
      lineIndex += 1;
      continue;
    }

    const modelMatch = line.match(/^model\s+([A-Za-z_]\w*)\s*\{$/);
    if (modelMatch) {
      const bounds = findBlockBounds(context, lineIndex);
      const name = modelMatch[1] ?? '';
      if (name.length === 0) {
        lineIndex = bounds.endLine + 1;
        continue;
      }
      models.push(parseModelBlock(context, name, bounds));
      lineIndex = bounds.endLine + 1;
      continue;
    }

    const enumMatch = line.match(/^enum\s+([A-Za-z_]\w*)\s*\{$/);
    if (enumMatch) {
      const bounds = findBlockBounds(context, lineIndex);
      const name = enumMatch[1] ?? '';
      if (name.length === 0) {
        lineIndex = bounds.endLine + 1;
        continue;
      }
      enums.push(parseEnumBlock(context, name, bounds));
      lineIndex = bounds.endLine + 1;
      continue;
    }

    if (/^types\s*\{$/.test(line)) {
      const bounds = findBlockBounds(context, lineIndex);
      typesBlock = parseTypesBlock(context, bounds);
      lineIndex = bounds.endLine + 1;
      continue;
    }

    if (line.includes('{')) {
      const blockName = line.split(/\s+/)[0] ?? 'block';
      pushDiagnostic(context, {
        code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
        message: `Unsupported top-level block "${blockName}"`,
        span: createTrimmedLineSpan(context, lineIndex),
      });
      const bounds = findBlockBounds(context, lineIndex);
      lineIndex = bounds.endLine + 1;
      continue;
    }

    pushDiagnostic(context, {
      code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
      message: `Unsupported top-level declaration "${line}"`,
      span: createTrimmedLineSpan(context, lineIndex),
    });
    lineIndex += 1;
  }

  const namedTypeNames = new Set(
    (typesBlock?.declarations ?? []).map((declaration) => declaration.name),
  );
  const modelNames = new Set(models.map((model) => model.name));
  const enumNames = new Set(enums.map((enumBlock) => enumBlock.name));
  for (const declaration of typesBlock?.declarations ?? []) {
    if (SCALAR_TYPES.has(declaration.name)) {
      pushDiagnostic(context, {
        code: 'PSL_INVALID_TYPES_MEMBER',
        message: `Named type "${declaration.name}" conflicts with scalar type "${declaration.name}"`,
        span: declaration.span,
      });
      continue;
    }
    if (modelNames.has(declaration.name)) {
      pushDiagnostic(context, {
        code: 'PSL_INVALID_TYPES_MEMBER',
        message: `Named type "${declaration.name}" conflicts with model name "${declaration.name}"`,
        span: declaration.span,
      });
      continue;
    }
    if (enumNames.has(declaration.name)) {
      pushDiagnostic(context, {
        code: 'PSL_INVALID_TYPES_MEMBER',
        message: `Named type "${declaration.name}" conflicts with enum name "${declaration.name}"`,
        span: declaration.span,
      });
    }
  }
  const normalizedModels = models.map((model) => ({
    ...model,
    fields: model.fields.map((field) => {
      if (!namedTypeNames.has(field.typeName)) {
        return field;
      }
      const hasRelationAttribute = field.attributes.some(
        (attribute) => attribute.name === 'relation',
      );
      if (
        hasRelationAttribute ||
        modelNames.has(field.typeName) ||
        enumNames.has(field.typeName) ||
        SCALAR_TYPES.has(field.typeName)
      ) {
        return field;
      }
      return {
        ...field,
        typeRef: field.typeName,
      };
    }),
  }));

  const ast: PslDocumentAst = {
    kind: 'document',
    sourceId: input.sourceId,
    models: normalizedModels,
    enums,
    ...ifDefined('types', typesBlock),
    span: {
      start: createPosition(context, 0, 0),
      end: createPosition(
        context,
        Math.max(lines.length - 1, 0),
        (lines[Math.max(lines.length - 1, 0)] ?? '').length,
      ),
    },
  };

  return {
    ast,
    diagnostics,
    ok: diagnostics.length === 0,
  };
}

function parseModelBlock(context: ParserContext, name: string, bounds: BlockBounds): PslModel {
  const fields: PslField[] = [];
  const attributes: PslModelAttribute[] = [];

  for (let lineIndex = bounds.startLine + 1; lineIndex < bounds.endLine; lineIndex += 1) {
    const raw = context.lines[lineIndex] ?? '';
    const line = stripInlineComment(raw).trim();
    if (line.length === 0) {
      continue;
    }

    if (line.startsWith('@@')) {
      const attribute = parseModelAttribute(context, line, lineIndex);
      if (attribute) {
        attributes.push(attribute);
      }
      continue;
    }

    const field = parseField(context, line, lineIndex);
    if (field) {
      fields.push(field);
    }
  }

  return {
    kind: 'model',
    name,
    fields,
    attributes,
    span: createLineRangeSpan(context, bounds.startLine, bounds.endLine),
  };
}

function parseEnumBlock(context: ParserContext, name: string, bounds: BlockBounds): PslEnum {
  const values: PslEnumValue[] = [];
  const attributes: PslAttribute[] = [];

  for (let lineIndex = bounds.startLine + 1; lineIndex < bounds.endLine; lineIndex += 1) {
    const raw = context.lines[lineIndex] ?? '';
    const line = stripInlineComment(raw).trim();
    if (line.length === 0) {
      continue;
    }

    if (line.startsWith('@@')) {
      const attribute = parseEnumAttribute(context, line, lineIndex);
      if (attribute) {
        attributes.push(attribute);
      }
      continue;
    }

    const valueMatch = line.match(/^([A-Za-z_]\w*)$/);
    if (!valueMatch) {
      pushDiagnostic(context, {
        code: 'PSL_INVALID_ENUM_MEMBER',
        message: `Invalid enum value declaration "${line}"`,
        span: createTrimmedLineSpan(context, lineIndex),
      });
      continue;
    }

    values.push({
      kind: 'enumValue',
      name: valueMatch[1] ?? '',
      span: createTrimmedLineSpan(context, lineIndex),
    });
  }

  return {
    kind: 'enum',
    name,
    values,
    attributes,
    span: createLineRangeSpan(context, bounds.startLine, bounds.endLine),
  };
}

function parseTypesBlock(context: ParserContext, bounds: BlockBounds): PslTypesBlock {
  const declarations: PslNamedTypeDeclaration[] = [];

  for (let lineIndex = bounds.startLine + 1; lineIndex < bounds.endLine; lineIndex += 1) {
    const raw = context.lines[lineIndex] ?? '';
    const lineWithoutComment = stripInlineComment(raw);
    const line = lineWithoutComment.trim();
    if (line.length === 0) {
      continue;
    }

    const declarationMatch = line.match(/^([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)(.*)$/);
    if (!declarationMatch) {
      pushDiagnostic(context, {
        code: 'PSL_INVALID_TYPES_MEMBER',
        message: `Invalid types declaration "${line}"`,
        span: createTrimmedLineSpan(context, lineIndex),
      });
      continue;
    }

    const declarationName = declarationMatch[1] ?? '';
    const baseType = declarationMatch[2] ?? '';
    const attributePart = declarationMatch[3] ?? '';
    const trimmedStartColumn = firstNonWhitespaceColumn(raw);
    const attributeOffset = line.length - attributePart.length;
    const attributeSource = attributePart.trimStart();
    const leadingAttributeWhitespace = attributePart.length - attributeSource.length;
    const attributeParse = extractAttributeTokensWithSpans(
      context,
      lineIndex,
      attributeSource,
      trimmedStartColumn + attributeOffset + leadingAttributeWhitespace,
    );
    if (!attributeParse.ok) {
      continue;
    }
    const attributes = attributeParse.tokens
      .map((token) =>
        parseAttributeToken(context, {
          token: token.text,
          target: 'namedType',
          lineIndex,
          span: token.span,
        }),
      )
      .filter((attribute): attribute is PslAttribute => Boolean(attribute));

    declarations.push({
      kind: 'namedType',
      name: declarationName,
      baseType,
      attributes,
      span: createTrimmedLineSpan(context, lineIndex),
    });
  }

  return {
    kind: 'types',
    declarations,
    span: createLineRangeSpan(context, bounds.startLine, bounds.endLine),
  };
}

function parseModelAttribute(
  context: ParserContext,
  line: string,
  lineIndex: number,
): PslModelAttribute | undefined {
  const rawLine = context.lines[lineIndex] ?? '';
  const tokenParse = extractAttributeTokensWithSpans(
    context,
    lineIndex,
    line,
    firstNonWhitespaceColumn(rawLine),
  );
  if (!tokenParse.ok || tokenParse.tokens.length !== 1) {
    pushDiagnostic(context, {
      code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
      message: `Invalid model attribute syntax "${line}"`,
      span: createTrimmedLineSpan(context, lineIndex),
    });
    return undefined;
  }
  const token = tokenParse.tokens[0];
  if (!token) {
    return undefined;
  }
  return parseAttributeToken(context, {
    token: token.text,
    target: 'model',
    lineIndex,
    span: token.span,
  });
}

function parseEnumAttribute(
  context: ParserContext,
  line: string,
  lineIndex: number,
): PslAttribute | undefined {
  const rawLine = context.lines[lineIndex] ?? '';
  const tokenParse = extractAttributeTokensWithSpans(
    context,
    lineIndex,
    line,
    firstNonWhitespaceColumn(rawLine),
  );
  if (!tokenParse.ok || tokenParse.tokens.length !== 1) {
    pushDiagnostic(context, {
      code: 'PSL_INVALID_ENUM_MEMBER',
      message: `Invalid enum value declaration "${line}"`,
      span: createTrimmedLineSpan(context, lineIndex),
    });
    return undefined;
  }
  const token = tokenParse.tokens[0];
  if (!token) {
    return undefined;
  }
  const parsed = parseAttributeToken(context, {
    token: token.text,
    target: 'enum',
    lineIndex,
    span: token.span,
  });
  if (!parsed) {
    return undefined;
  }
  if (parsed.name !== 'map') {
    pushDiagnostic(context, {
      code: 'PSL_INVALID_ENUM_MEMBER',
      message: `Invalid enum value declaration "${line}"`,
      span: createTrimmedLineSpan(context, lineIndex),
    });
    return undefined;
  }
  return parsed;
}

function parseField(context: ParserContext, line: string, lineIndex: number): PslField | undefined {
  const fieldMatch = line.match(/^([A-Za-z_]\w*)\s+([A-Za-z_]\w*(?:\[\])?)(\?)?(.*)$/);
  if (!fieldMatch) {
    pushDiagnostic(context, {
      code: 'PSL_INVALID_MODEL_MEMBER',
      message: `Invalid model member declaration "${line}"`,
      span: createTrimmedLineSpan(context, lineIndex),
    });
    return undefined;
  }

  const fieldName = fieldMatch[1] ?? '';
  const rawTypeToken = fieldMatch[2] ?? '';
  const optionalMarker = fieldMatch[3] ?? '';
  const attributePart = fieldMatch[4] ?? '';
  const list = rawTypeToken.endsWith('[]');
  const typeName = list ? rawTypeToken.slice(0, -2) : rawTypeToken;
  const optional = optionalMarker === '?';

  const attributes: PslFieldAttribute[] = [];
  const rawLine = context.lines[lineIndex] ?? '';
  const trimmedStartColumn = firstNonWhitespaceColumn(rawLine);
  const attributeOffset = line.length - attributePart.length;
  const attributeSource = attributePart.trimStart();
  const leadingAttributeWhitespace = attributePart.length - attributeSource.length;
  const tokenParse = extractAttributeTokensWithSpans(
    context,
    lineIndex,
    attributeSource,
    trimmedStartColumn + attributeOffset + leadingAttributeWhitespace,
  );
  if (!tokenParse.ok) {
    return {
      kind: 'field',
      name: fieldName,
      typeName,
      optional,
      list,
      attributes,
      span: createTrimmedLineSpan(context, lineIndex),
    };
  }

  for (const token of tokenParse.tokens) {
    const parsed = parseAttributeToken(context, {
      token: token.text,
      target: 'field',
      lineIndex,
      span: token.span,
    });
    if (parsed) {
      attributes.push(parsed);
    }
  }

  return {
    kind: 'field',
    name: fieldName,
    typeName,
    optional,
    list,
    attributes,
    span: createTrimmedLineSpan(context, lineIndex),
  };
}

function parseAttributeToken(
  context: ParserContext,
  input: {
    readonly token: string;
    readonly target: PslAttributeTarget;
    readonly lineIndex: number;
    readonly span: PslSpan;
  },
): PslAttribute | undefined {
  const expectsBlockPrefix = input.target === 'model' || input.target === 'enum';
  const targetLabel = input.target === 'enum' ? 'Enum' : 'Model';
  if (expectsBlockPrefix && !input.token.startsWith('@@')) {
    pushDiagnostic(context, {
      code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
      message: `${targetLabel} attribute "${input.token}" must use @@ prefix`,
      span: input.span,
    });
    return undefined;
  }
  if (!expectsBlockPrefix && !input.token.startsWith('@')) {
    pushDiagnostic(context, {
      code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
      message: `Attribute "${input.token}" must use @ prefix`,
      span: input.span,
    });
    return undefined;
  }
  if (!expectsBlockPrefix && input.token.startsWith('@@')) {
    pushDiagnostic(context, {
      code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
      message: `Attribute "${input.token}" is not valid in ${input.target} context`,
      span: input.span,
    });
    return undefined;
  }

  const rawBody = expectsBlockPrefix ? input.token.slice(2) : input.token.slice(1);
  const openParen = rawBody.indexOf('(');
  const closeParen = rawBody.lastIndexOf(')');
  const hasArgs = openParen >= 0 || closeParen >= 0;
  if ((openParen >= 0 && closeParen === -1) || (openParen === -1 && closeParen >= 0)) {
    pushDiagnostic(context, {
      code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
      message: `Invalid attribute syntax "${input.token}"`,
      span: input.span,
    });
    return undefined;
  }

  const name = (openParen >= 0 ? rawBody.slice(0, openParen) : rawBody).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(name)) {
    pushDiagnostic(context, {
      code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
      message: `Invalid attribute name "${name || input.token}"`,
      span: input.span,
    });
    return undefined;
  }

  let args: readonly PslAttributeArgument[] = [];
  if (hasArgs && openParen >= 0 && closeParen >= openParen) {
    if (closeParen !== rawBody.length - 1) {
      pushDiagnostic(context, {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: `Invalid trailing syntax in attribute "${input.token}"`,
        span: input.span,
      });
      return undefined;
    }
    const argsRaw = rawBody.slice(openParen + 1, closeParen);
    const parsedArgs = parseAttributeArguments(context, {
      argsRaw,
      argsOffset: input.span.start.column - 1 + (expectsBlockPrefix ? 2 : 1) + openParen + 1,
      lineIndex: input.lineIndex,
      token: input.token,
      span: input.span,
    });
    if (!parsedArgs) {
      return undefined;
    }
    args = parsedArgs;
  }

  return {
    kind: 'attribute',
    target: input.target,
    name,
    args,
    span: input.span,
  };
}

function parseAttributeArguments(
  context: ParserContext,
  input: {
    readonly argsRaw: string;
    readonly argsOffset: number;
    readonly lineIndex: number;
    readonly token: string;
    readonly span: PslSpan;
  },
): readonly PslAttributeArgument[] | undefined {
  const trimmed = input.argsRaw.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const parts = splitTopLevelSegments(input.argsRaw, ',');
  const args: PslAttributeArgument[] = [];

  for (const part of parts) {
    const original = part.value;
    const trimmedPart = original.trim();
    if (trimmedPart.length === 0) {
      pushDiagnostic(context, {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: `Invalid empty argument in attribute "${input.token}"`,
        span: input.span,
      });
      return undefined;
    }

    const leadingWhitespace = original.length - original.trimStart().length;
    const partStart = input.argsOffset + part.start + leadingWhitespace;
    const partEnd = partStart + trimmedPart.length;
    const partSpan = createInlineSpan(context, input.lineIndex, partStart, partEnd);

    const namedSplit = splitTopLevelSegments(trimmedPart, ':');
    if (namedSplit.length > 1) {
      const first = namedSplit[0];
      if (!first) {
        pushDiagnostic(context, {
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: `Invalid named argument syntax "${trimmedPart}"`,
          span: partSpan,
        });
        return undefined;
      }
      const name = first.value.trim();
      const rawValue = trimmedPart.slice(first.end + 1).trim();
      if (!name || rawValue.length === 0) {
        pushDiagnostic(context, {
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: `Invalid named argument syntax "${trimmedPart}"`,
          span: partSpan,
        });
        return undefined;
      }
      args.push({
        kind: 'named',
        name,
        value: normalizeAttributeArgumentValue(rawValue),
        span: partSpan,
      });
      continue;
    }

    args.push({
      kind: 'positional',
      value: normalizeAttributeArgumentValue(trimmedPart),
      span: partSpan,
    });
  }

  return args;
}

function normalizeAttributeArgumentValue(value: string): string {
  return value.trim();
}

function findBlockBounds(context: ParserContext, startLine: number): BlockBounds {
  let depth = 0;

  for (let lineIndex = startLine; lineIndex < context.lines.length; lineIndex += 1) {
    const line = stripInlineComment(context.lines[lineIndex] ?? '');
    let quote: '"' | "'" | null = null;
    let previousCharacter = '';
    for (const character of line) {
      if (quote) {
        if (character === quote && previousCharacter !== '\\') {
          quote = null;
        }
        previousCharacter = character;
        continue;
      }

      if (character === '"' || character === "'") {
        quote = character;
        previousCharacter = character;
        continue;
      }

      if (character === '{') {
        depth += 1;
      }
      if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          return { startLine, endLine: lineIndex, closed: true };
        }
      }
      previousCharacter = character;
    }
  }

  pushDiagnostic(context, {
    code: 'PSL_UNTERMINATED_BLOCK',
    message: 'Unterminated block declaration',
    span: createTrimmedLineSpan(context, startLine),
  });
  return {
    startLine,
    endLine: context.lines.length - 1,
    closed: false,
  };
}

interface TopLevelSegment {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

function splitTopLevelSegments(value: string, separator: ',' | ':'): TopLevelSegment[] {
  const parts: TopLevelSegment[] = [];
  let depthParen = 0;
  let depthBracket = 0;
  let quote: '"' | "'" | null = null;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (quote) {
      if (character === quote && value[index - 1] !== '\\') {
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

    if (character === separator && depthParen === 0 && depthBracket === 0) {
      parts.push({
        value: value.slice(start, index),
        start,
        end: index,
      });
      start = index + 1;
    }
  }

  parts.push({
    value: value.slice(start),
    start,
    end: value.length,
  });
  return parts;
}

function extractAttributeTokensWithSpans(
  context: ParserContext,
  lineIndex: number,
  value: string,
  startColumn: number,
): { readonly ok: boolean; readonly tokens: readonly { text: string; span: PslSpan }[] } {
  const tokens: { text: string; span: PslSpan }[] = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && /\s/.test(value[index] ?? '')) {
      index += 1;
    }
    if (index >= value.length) {
      break;
    }

    if (value[index] !== '@') {
      pushDiagnostic(context, {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: `Invalid attribute syntax "${value.trim()}"`,
        span: createInlineSpan(context, lineIndex, startColumn + index, startColumn + value.length),
      });
      return { ok: false, tokens };
    }

    const start = index;
    index += 1;
    if (value[index] === '@') {
      index += 1;
    }

    const nameStart = index;
    while (index < value.length && /[A-Za-z0-9_.-]/.test(value[index] ?? '')) {
      index += 1;
    }

    if (index === nameStart) {
      pushDiagnostic(context, {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: `Invalid attribute syntax "${value.slice(start).trim()}"`,
        span: createInlineSpan(context, lineIndex, startColumn + start, startColumn + value.length),
      });
      return { ok: false, tokens };
    }

    if (value[index] === '(') {
      let depth = 0;
      let quote: '"' | "'" | null = null;
      while (index < value.length) {
        const char = value[index] ?? '';
        if (quote) {
          if (char === quote && value[index - 1] !== '\\') {
            quote = null;
          }
          index += 1;
          continue;
        }

        if (char === '"' || char === "'") {
          quote = char;
          index += 1;
          continue;
        }

        if (char === '(') {
          depth += 1;
        } else if (char === ')') {
          depth -= 1;
          if (depth === 0) {
            index += 1;
            break;
          }
        }
        index += 1;
      }
      if (depth !== 0) {
        pushDiagnostic(context, {
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: `Unterminated attribute argument list in "${value.slice(start).trim()}"`,
          span: createInlineSpan(
            context,
            lineIndex,
            startColumn + start,
            startColumn + value.length,
          ),
        });
        return { ok: false, tokens };
      }
    }

    const tokenText = value.slice(start, index).trim();
    tokens.push({
      text: tokenText,
      span: createInlineSpan(context, lineIndex, startColumn + start, startColumn + index),
    });

    while (index < value.length && /\s/.test(value[index] ?? '')) {
      index += 1;
    }

    if (index < value.length && value[index] !== '@') {
      break;
    }
  }

  if (index < value.length && value[index] !== '@') {
    pushDiagnostic(context, {
      code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
      message: `Invalid attribute syntax "${value.trim()}"`,
      span: createInlineSpan(context, lineIndex, startColumn + index, startColumn + value.length),
    });
    return { ok: false, tokens };
  }

  return { ok: true, tokens };
}

function stripInlineComment(line: string): string {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length - 1; index += 1) {
    const current = line[index] ?? '';
    const next = line[index + 1] ?? '';

    if (quote) {
      if (current === quote && line[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }

    if (current === '"' || current === "'") {
      quote = current;
      continue;
    }

    if (current === '/' && next === '/') {
      return line.slice(0, index);
    }
  }

  return line;
}

function computeLineOffsets(schema: string): number[] {
  const offsets = [0];
  for (let index = 0; index < schema.length; index += 1) {
    if (schema[index] === '\n') {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function firstNonWhitespaceColumn(line: string): number {
  const first = line.search(/\S/);
  return first === -1 ? 0 : first;
}

function createInlineSpan(
  context: ParserContext,
  lineIndex: number,
  startColumn: number,
  endColumn: number,
): PslSpan {
  return {
    start: createPosition(context, lineIndex, startColumn),
    end: createPosition(context, lineIndex, endColumn),
  };
}

function createTrimmedLineSpan(context: ParserContext, lineIndex: number): PslSpan {
  const line = context.lines[lineIndex] ?? '';
  const startColumn = firstNonWhitespaceColumn(line);
  return {
    start: createPosition(context, lineIndex, startColumn),
    end: createPosition(context, lineIndex, line.length),
  };
}

function createLineRangeSpan(context: ParserContext, startLine: number, endLine: number): PslSpan {
  const startLineText = context.lines[startLine] ?? '';
  const endLineText = context.lines[endLine] ?? '';
  const startColumn = firstNonWhitespaceColumn(startLineText);
  return {
    start: createPosition(context, startLine, startColumn),
    end: createPosition(context, endLine, endLineText.length),
  };
}

function createPosition(
  context: ParserContext,
  lineIndex: number,
  columnIndex: number,
): PslPosition {
  const clampedLineIndex = Math.max(0, Math.min(lineIndex, context.lineOffsets.length - 1));
  const lineText = context.lines[clampedLineIndex] ?? '';
  const clampedColumnIndex = Math.max(0, Math.min(columnIndex, lineText.length));
  return {
    offset: (context.lineOffsets[clampedLineIndex] ?? 0) + clampedColumnIndex,
    line: clampedLineIndex + 1,
    column: clampedColumnIndex + 1,
  };
}

function pushDiagnostic(
  context: ParserContext,
  diagnostic: Omit<PslDiagnostic, 'sourceId'> & { readonly code: PslDiagnosticCode },
): void {
  context.diagnostics.push({
    ...diagnostic,
    sourceId: context.sourceId,
  });
}
