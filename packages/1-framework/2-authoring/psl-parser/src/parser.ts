import type {
  ParsePslDocumentInput,
  ParsePslDocumentResult,
  PslDefaultAttribute,
  PslDefaultValue,
  PslDiagnostic,
  PslDiagnosticCode,
  PslDocumentAst,
  PslEnum,
  PslEnumValue,
  PslField,
  PslFieldAttribute,
  PslIndexConstraint,
  PslModel,
  PslModelAttribute,
  PslNamedTypeDeclaration,
  PslPosition,
  PslReferentialAction,
  PslRelationAttribute,
  PslSpan,
  PslTypesBlock,
  PslUniqueConstraint,
} from './types';

const REFERENTIAL_ACTION_MAP: Record<string, PslReferentialAction> = {
  NoAction: 'noAction',
  Restrict: 'restrict',
  Cascade: 'cascade',
  SetNull: 'setNull',
  SetDefault: 'setDefault',
  noAction: 'noAction',
  restrict: 'restrict',
  cascade: 'cascade',
  setNull: 'setNull',
  setDefault: 'setDefault',
};

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
    }
  }
  const normalizedModels = models.map((model) => ({
    ...model,
    fields: model.fields.map((field) => {
      if (!namedTypeNames.has(field.typeName)) {
        return field;
      }
      const hasRelationAttribute = field.attributes.some(
        (attribute) => attribute.kind === 'relation',
      );
      if (
        hasRelationAttribute ||
        modelNames.has(field.typeName) ||
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
    ...(typesBlock ? { types: typesBlock } : {}),
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

  for (let lineIndex = bounds.startLine + 1; lineIndex < bounds.endLine; lineIndex += 1) {
    const raw = context.lines[lineIndex] ?? '';
    const line = stripInlineComment(raw).trim();
    if (line.length === 0) {
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
    span: createLineRangeSpan(context, bounds.startLine, bounds.endLine),
  };
}

function parseTypesBlock(context: ParserContext, bounds: BlockBounds): PslTypesBlock {
  const declarations: PslNamedTypeDeclaration[] = [];

  for (let lineIndex = bounds.startLine + 1; lineIndex < bounds.endLine; lineIndex += 1) {
    const raw = context.lines[lineIndex] ?? '';
    const line = stripInlineComment(raw).trim();
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
    const attributes = extractAttributeTokens(attributePart.trim());
    if (attributePart.trim().length > 0 && attributes.length === 0) {
      pushDiagnostic(context, {
        code: 'PSL_INVALID_TYPES_MEMBER',
        message: `Invalid type attributes in declaration "${line}"`,
        span: createTrimmedLineSpan(context, lineIndex),
      });
      continue;
    }

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
): PslUniqueConstraint | PslIndexConstraint | undefined {
  const attributeMatch = line.match(/^@@(unique|index)\s*\((.*)\)\s*$/);
  if (!attributeMatch) {
    pushDiagnostic(context, {
      code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
      message: `Unsupported model attribute "${line}"`,
      span: createTrimmedLineSpan(context, lineIndex),
    });
    return undefined;
  }

  const attributeKind = attributeMatch[1] ?? '';
  const argsRaw = attributeMatch[2] ?? '';
  const args = splitTopLevel(argsRaw, ',');
  const fieldsArg = args[0]?.trim() ?? '';
  if (!fieldsArg.startsWith('[') || !fieldsArg.endsWith(']')) {
    pushDiagnostic(context, {
      code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
      message: `Model attribute "${line}" must provide field list in brackets`,
      span: createTrimmedLineSpan(context, lineIndex),
    });
    return undefined;
  }

  const fields = parseBracketList(fieldsArg);
  if (attributeKind === 'unique') {
    return {
      kind: 'unique',
      fields,
      span: createTrimmedLineSpan(context, lineIndex),
    };
  }

  return {
    kind: 'index',
    fields,
    span: createTrimmedLineSpan(context, lineIndex),
  };
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
  const tokens = extractAttributeTokens(attributePart.trim());
  if (attributePart.trim().length > 0 && tokens.length === 0) {
    pushDiagnostic(context, {
      code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
      message: `Unsupported field attributes in "${line}"`,
      span: createTrimmedLineSpan(context, lineIndex),
    });
  }

  for (const token of tokens) {
    if (token === '@id') {
      attributes.push({ kind: 'id', span: createTrimmedLineSpan(context, lineIndex) });
      continue;
    }

    if (token === '@unique') {
      attributes.push({ kind: 'unique', span: createTrimmedLineSpan(context, lineIndex) });
      continue;
    }

    if (token.startsWith('@default(') && token.endsWith(')')) {
      const defaultAttribute = parseDefaultAttribute(context, token, lineIndex);
      if (defaultAttribute) {
        attributes.push(defaultAttribute);
      }
      continue;
    }

    if (token.startsWith('@relation(') && token.endsWith(')')) {
      const relationAttribute = parseRelationAttribute(context, token, lineIndex);
      if (relationAttribute) {
        attributes.push(relationAttribute);
      }
      continue;
    }

    pushDiagnostic(context, {
      code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
      message: `Unsupported field attribute "${token}"`,
      span: createTrimmedLineSpan(context, lineIndex),
    });
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

function parseRelationAttribute(
  context: ParserContext,
  token: string,
  lineIndex: number,
): PslRelationAttribute | undefined {
  const argsRaw = token.slice('@relation('.length, -1).trim();
  const parts = splitTopLevel(argsRaw, ',');
  const fields: string[] = [];
  const references: string[] = [];
  let onDelete: PslReferentialAction | undefined;
  let onUpdate: PslReferentialAction | undefined;

  for (const part of parts) {
    const [keyRaw, ...valueParts] = part.split(':');
    if (!keyRaw || valueParts.length === 0) {
      pushDiagnostic(context, {
        code: 'PSL_INVALID_RELATION_ATTRIBUTE',
        message: `Invalid relation argument "${part.trim()}"`,
        span: createTrimmedLineSpan(context, lineIndex),
      });
      continue;
    }

    const key = keyRaw.trim();
    const value = valueParts.join(':').trim();
    if (key === 'fields') {
      fields.push(...parseBracketList(value));
      continue;
    }
    if (key === 'references') {
      references.push(...parseBracketList(value));
      continue;
    }
    if (key === 'onDelete') {
      const action = parseReferentialAction(context, value, lineIndex);
      if (action) {
        onDelete = action;
      }
      continue;
    }
    if (key === 'onUpdate') {
      const action = parseReferentialAction(context, value, lineIndex);
      if (action) {
        onUpdate = action;
      }
      continue;
    }

    pushDiagnostic(context, {
      code: 'PSL_INVALID_RELATION_ATTRIBUTE',
      message: `Unsupported relation argument "${key}"`,
      span: createTrimmedLineSpan(context, lineIndex),
    });
  }

  if (fields.length === 0 || references.length === 0) {
    pushDiagnostic(context, {
      code: 'PSL_INVALID_RELATION_ATTRIBUTE',
      message: '@relation requires both fields and references arrays',
      span: createTrimmedLineSpan(context, lineIndex),
    });
    return undefined;
  }

  return {
    kind: 'relation',
    fields,
    references,
    ...(onDelete ? { onDelete } : {}),
    ...(onUpdate ? { onUpdate } : {}),
    span: createTrimmedLineSpan(context, lineIndex),
  };
}

function parseReferentialAction(
  context: ParserContext,
  value: string,
  lineIndex: number,
): PslReferentialAction | undefined {
  const action = REFERENTIAL_ACTION_MAP[value];
  if (action) {
    return action;
  }
  pushDiagnostic(context, {
    code: 'PSL_INVALID_REFERENTIAL_ACTION',
    message: `Unsupported referential action "${value}"`,
    span: createTrimmedLineSpan(context, lineIndex),
  });
  return undefined;
}

function parseDefaultAttribute(
  context: ParserContext,
  token: string,
  lineIndex: number,
): PslDefaultAttribute | undefined {
  const valueExpression = token.slice('@default('.length, -1).trim();
  const value = parseDefaultValue(valueExpression);
  if (!value) {
    pushDiagnostic(context, {
      code: 'PSL_INVALID_DEFAULT_VALUE',
      message: `Unsupported default value "${valueExpression}"`,
      span: createTrimmedLineSpan(context, lineIndex),
    });
    return undefined;
  }
  return {
    kind: 'default',
    value,
    span: createTrimmedLineSpan(context, lineIndex),
  };
}

function parseDefaultValue(valueExpression: string): PslDefaultValue | undefined {
  if (valueExpression === 'autoincrement()') {
    return {
      kind: 'function',
      name: 'autoincrement',
    };
  }

  if (valueExpression === 'now()') {
    return {
      kind: 'function',
      name: 'now',
    };
  }

  const stringMatch = valueExpression.match(/^(['"])(.*)\1$/);
  if (stringMatch) {
    return {
      kind: 'literal',
      value: stringMatch[2] ?? '',
    };
  }

  const numberValue = Number(valueExpression);
  if (!Number.isNaN(numberValue) && valueExpression.length > 0) {
    return {
      kind: 'literal',
      value: numberValue,
    };
  }

  if (valueExpression === 'true' || valueExpression === 'false') {
    return {
      kind: 'literal',
      value: valueExpression === 'true',
    };
  }

  return undefined;
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

function parseBracketList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return [];
  }
  const body = trimmed.slice(1, -1);
  return splitTopLevel(body, ',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function splitTopLevel(value: string, separator: ',' | ':' = ','): string[] {
  const parts: string[] = [];
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
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(value.slice(start));
  return parts;
}

function extractAttributeTokens(value: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && /\s/.test(value[index] ?? '')) {
      index += 1;
    }
    if (index >= value.length) {
      break;
    }

    if (value[index] !== '@') {
      break;
    }

    const start = index;
    index += 1;
    if (value[index] === '@') {
      index += 1;
    }

    while (index < value.length && /[A-Za-z0-9_.]/.test(value[index] ?? '')) {
      index += 1;
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
    }

    tokens.push(value.slice(start, index).trim());
  }

  return tokens;
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

function createTrimmedLineSpan(context: ParserContext, lineIndex: number): PslSpan {
  const line = context.lines[lineIndex] ?? '';
  const firstNonWhitespace = line.search(/\S/);
  const startColumn = firstNonWhitespace === -1 ? 0 : firstNonWhitespace;
  return {
    start: createPosition(context, lineIndex, startColumn),
    end: createPosition(context, lineIndex, line.length),
  };
}

function createLineRangeSpan(context: ParserContext, startLine: number, endLine: number): PslSpan {
  const startLineText = context.lines[startLine] ?? '';
  const endLineText = context.lines[endLine] ?? '';
  const firstNonWhitespace = startLineText.search(/\S/);
  const startColumn = firstNonWhitespace === -1 ? 0 : firstNonWhitespace;
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
