import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { ModelSymbol, ResolvedAttribute } from '@prisma-next/psl-parser';
import { parseQuotedStringLiteral } from '@prisma-next/psl-parser';
import { ifDefined } from '@prisma-next/utils/defined';

export { parseQuotedStringLiteral };

export function getPositionalArgument(attr: ResolvedAttribute, index = 0): string | undefined {
  return attr.args.filter((arg) => arg.kind === 'positional')[index]?.value;
}

export function getNamedArgument(attr: ResolvedAttribute, name: string): string | undefined {
  const arg = attr.args.find((a) => a.kind === 'named' && a.name === name);
  return arg?.value;
}

export function parseFieldList(value: string): readonly string[] {
  const inner = value.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (inner.length === 0) return [];
  return splitTopLevel(inner).map((s) => s.trim());
}

export interface ParsedIndexField {
  readonly name: string;
  readonly isWildcard: boolean;
  readonly direction?: number;
}

export function parseIndexFieldList(value: string): readonly ParsedIndexField[] {
  const segments = parseFieldList(value);
  return segments.map(parseIndexFieldSegment);
}

function parseIndexFieldSegment(segment: string): ParsedIndexField {
  const wildcardMatch = segment.match(/^wildcard\(\s*(.*?)\s*\)$/);
  if (wildcardMatch) {
    const scope = wildcardMatch[1] ?? '';
    return {
      name: scope.length > 0 ? `${scope}.$**` : '$**',
      isWildcard: true,
    };
  }

  const modifierMatch = segment.match(/^(\w+)\(\s*sort:\s*(\w+)\s*\)$/);
  if (modifierMatch) {
    const fieldName = modifierMatch[1] ?? segment;
    const sortValue = modifierMatch[2];
    return {
      name: fieldName,
      isWildcard: false,
      direction: sortValue === 'Desc' ? -1 : 1,
    };
  }

  return { name: segment, isWildcard: false };
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

export function lowerFirst(value: string): string {
  if (value.length === 0) return value;
  return value[0]?.toLowerCase() + value.slice(1);
}

export function getAttribute(
  attributes: readonly ResolvedAttribute[],
  name: string,
): ResolvedAttribute | undefined {
  return attributes.find((attr) => attr.name === name);
}

export function getMapName(attributes: readonly ResolvedAttribute[]): string | undefined {
  const mapAttr = getAttribute(attributes, 'map');
  if (!mapAttr) return undefined;
  const arg = mapAttr.args[0];
  if (!arg) return undefined;
  return stripQuotes(arg.value);
}

export interface ParsedRelationAttribute {
  readonly fields?: readonly string[];
  readonly references?: readonly string[];
  /**
   * Set when local FK fields are declared (`from:`) but the referenced key is
   * omitted (`to:` absent). The caller resolves the referenced columns from the
   * target model's `@id`. `references` stays undefined in this case; the two
   * never co-occur.
   */
  readonly referencesInferred?: true;
  /**
   * The FK-side relation field named by `inverse:` on a one-to-many back-relation
   * list field. A bare relation-field name pinning the owning foreign-key field,
   * used to disambiguate when multiple relations link the same pair of models.
   */
  readonly inverse?: string;
}

/**
 * Parses a single `@relation` directional argument value (`from:`/`to:`). A
 * single field may be bare (`from: userId`) or bracketed (`from: [userId]`);
 * composites must be bracketed (`from: [a, b]`).
 */
function parseRelationFieldArgument(raw: string): readonly string[] | undefined {
  const trimmed = raw.trim();
  const entries = trimmed.startsWith('[') ? parseFieldList(trimmed) : [trimmed];
  if (entries.length === 0 || entries.some((entry) => entry.length === 0)) {
    return undefined;
  }
  return entries;
}

export function parseRelationAttribute(input: {
  readonly attributes: readonly ResolvedAttribute[];
  readonly modelName: string;
  readonly fieldName: string;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): ParsedRelationAttribute | undefined {
  const relationAttr = getAttribute(input.attributes, 'relation');
  if (!relationAttr) return undefined;

  let fromRaw: string | undefined;
  let toRaw: string | undefined;
  let inverse: string | undefined;

  for (const arg of relationAttr.args) {
    if (arg.kind === 'positional' || arg.name === 'name') {
      input.diagnostics.push({
        code: 'PSL_LEGACY_RELATION_NAME',
        message: `Relation field "${input.modelName}.${input.fieldName}" uses @relation(name:) (or a positional @relation("...")), which is no longer supported — disambiguate with inverse: (1:N back-relation) or through: Junction.field (M:N)`,
        sourceId: input.sourceId,
        span: arg.span,
      });
      return undefined;
    }
    if (arg.name === 'fields' || arg.name === 'references') {
      input.diagnostics.push({
        code: 'PSL_LEGACY_FIELDS_REFERENCES',
        message: `Relation field "${input.modelName}.${input.fieldName}" uses @relation(fields:/references:), which is no longer supported — use from:/to: instead`,
        sourceId: input.sourceId,
        span: arg.span,
      });
      return undefined;
    }
    if (arg.name === 'from') {
      fromRaw = arg.value;
    } else if (arg.name === 'to') {
      toRaw = arg.value;
    } else if (arg.name === 'inverse') {
      const trimmed = arg.value.trim();
      inverse = trimmed.length > 0 ? trimmed : undefined;
    }
  }

  if (toRaw !== undefined && fromRaw === undefined) {
    input.diagnostics.push({
      code: 'PSL_INVALID_RELATION_ATTRIBUTE',
      message: `Relation field "${input.modelName}.${input.fieldName}" requires a from argument naming the local foreign-key field(s)`,
      sourceId: input.sourceId,
      span: relationAttr.span,
    });
    return undefined;
  }

  let fields: readonly string[] | undefined;
  let references: readonly string[] | undefined;
  let referencesInferred: true | undefined;
  if (fromRaw !== undefined) {
    const parsedFields = parseRelationFieldArgument(fromRaw);
    if (!parsedFields) {
      input.diagnostics.push({
        code: 'PSL_INVALID_RELATION_ATTRIBUTE',
        message: `Relation field "${input.modelName}.${input.fieldName}" requires a bare field or bracketed list for from`,
        sourceId: input.sourceId,
        span: relationAttr.span,
      });
      return undefined;
    }
    fields = parsedFields;

    if (toRaw !== undefined) {
      const parsedReferences = parseRelationFieldArgument(toRaw);
      if (!parsedReferences) {
        input.diagnostics.push({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: `Relation field "${input.modelName}.${input.fieldName}" requires a bare field or bracketed list for to`,
          sourceId: input.sourceId,
          span: relationAttr.span,
        });
        return undefined;
      }
      references = parsedReferences;
    } else {
      // `to:` omitted ⇒ the referenced columns default to the target model's
      // `@id`. The caller, which holds the target model, resolves them.
      referencesInferred = true;
    }
  }

  return {
    ...ifDefined('fields', fields),
    ...ifDefined('references', references),
    ...ifDefined('referencesInferred', referencesInferred),
    ...ifDefined('inverse', inverse),
  };
}

/**
 * Resolves a model's `@id` field names in declaration order — an inline `@id`
 * on a single field, or a model-level `@@id([...])` list. Returns undefined
 * when the model declares no identity, which is what makes an omitted `to:`
 * un-inferable for a relation targeting it.
 */
export function resolveTargetIdFieldNames(model: ModelSymbol): readonly string[] | undefined {
  const blockId = getAttribute(model.attributes, 'id');
  if (blockId) {
    const raw = getNamedArgument(blockId, 'fields') ?? getPositionalArgument(blockId);
    const fields = raw ? parseFieldList(raw) : undefined;
    if (fields && fields.length > 0) {
      return fields;
    }
    return undefined;
  }

  const inlineIdFields = Object.values(model.fields).filter((field) =>
    field.attributes.some((attribute) => attribute.name === 'id'),
  );
  if (inlineIdFields.length === 1) {
    const idField = inlineIdFields[0];
    return idField ? [idField.name] : undefined;
  }
  return undefined;
}

function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}
