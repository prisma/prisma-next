/**
 * PSL reserved words that cannot be used as identifiers without escaping.
 */
const PSL_RESERVED_WORDS = new Set(['model', 'enum', 'types', 'type', 'generator', 'datasource']);

type NameResult = {
  readonly name: string;
  readonly map?: string;
};

/**
 * Checks if the string contains snake_case separators (underscores, hyphens, spaces).
 */
function hasSeparators(input: string): boolean {
  return /[_\s-]/.test(input);
}

/**
 * Converts a snake_case string to PascalCase.
 * Only splits on separators — preserves existing casing within words.
 */
function snakeToPascalCase(input: string): string {
  return input
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * Converts a snake_case string to camelCase.
 * Only splits on separators — preserves existing casing within words.
 */
function snakeToCamelCase(input: string): string {
  const parts = input.split(/[_\s-]+/).filter(Boolean);
  if (parts.length === 0) return input;
  const [firstPart, ...rest] = parts;
  if (!firstPart) {
    return input;
  }
  return (
    firstPart.charAt(0).toLowerCase() +
    firstPart.slice(1) +
    rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('')
  );
}

/**
 * Checks if a name needs escaping (reserved word or starts with digit).
 */
function needsEscaping(name: string): boolean {
  return PSL_RESERVED_WORDS.has(name.toLowerCase()) || /^\d/.test(name);
}

/**
 * Escapes a name by prefixing with underscore.
 */
function escapeName(name: string): string {
  return `_${name}`;
}

function escapeIfNeeded(name: string): string {
  return needsEscaping(name) ? escapeName(name) : name;
}

/**
 * Converts a database table name to a PSL model name.
 * snake_case → PascalCase, with @@map("db_name") when the name was transformed.
 * Names that are already PascalCase (no separators, start with uppercase) are kept as-is.
 */
export function toModelName(tableName: string): NameResult {
  let name: string;

  if (hasSeparators(tableName)) {
    name = snakeToPascalCase(tableName);
  } else {
    // Ensure first character is uppercase
    name = tableName.charAt(0).toUpperCase() + tableName.slice(1);
  }

  if (needsEscaping(name)) {
    const escaped = escapeName(name);
    return { name: escaped, map: tableName };
  }

  if (name !== tableName) {
    return { name, map: tableName };
  }

  return { name };
}

/**
 * Converts a database column name to a PSL field name.
 * snake_case → camelCase, with @map("db_col") when the name was transformed.
 * Names that are already camelCase (no separators, start with lowercase) are kept as-is.
 */
export function toFieldName(columnName: string): NameResult {
  let name: string;

  if (hasSeparators(columnName)) {
    name = snakeToCamelCase(columnName);
  } else {
    // Ensure first character is lowercase
    name = columnName.charAt(0).toLowerCase() + columnName.slice(1);
  }

  if (needsEscaping(name)) {
    const escaped = escapeName(name);
    return { name: escaped, map: columnName };
  }

  if (name !== columnName) {
    return { name, map: columnName };
  }

  return { name };
}

/**
 * Converts a Postgres enum type name to a PSL enum name.
 * snake_case → PascalCase, with @@map when transformed.
 */
export function toEnumName(pgTypeName: string): NameResult {
  let name: string;

  if (hasSeparators(pgTypeName)) {
    name = snakeToPascalCase(pgTypeName);
  } else {
    name = pgTypeName.charAt(0).toUpperCase() + pgTypeName.slice(1);
  }

  if (needsEscaping(name)) {
    const escaped = escapeName(name);
    return { name: escaped, map: pgTypeName };
  }

  if (name !== pgTypeName) {
    return { name, map: pgTypeName };
  }

  return { name };
}

/**
 * Simple English pluralization for back-relation field names.
 * Handles: s→ses, y→ies, default→s
 */
export function pluralize(word: string): string {
  if (
    word.endsWith('s') ||
    word.endsWith('x') ||
    word.endsWith('z') ||
    word.endsWith('ch') ||
    word.endsWith('sh')
  ) {
    return `${word}es`;
  }
  if (word.endsWith('y') && !/[aeiou]y$/i.test(word)) {
    return `${word.slice(0, -1)}ies`;
  }
  return `${word}s`;
}

/**
 * Derives a relation field name from FK column names.
 *
 * For single-column FKs: strip _id/Id suffix, camelCase the result.
 * For composite FKs: use the referenced table name (lowercased, camelCased).
 */
export function deriveRelationFieldName(
  fkColumns: readonly string[],
  referencedTableName: string,
): string {
  if (fkColumns.length === 1) {
    const [col] = fkColumns;
    if (!col) {
      return escapeIfNeeded(snakeToCamelCase(referencedTableName));
    }
    // Strip common FK suffixes
    const stripped = col.replace(/_id$/i, '').replace(/Id$/, '');

    if (stripped.length > 0 && stripped !== col) {
      return escapeIfNeeded(snakeToCamelCase(stripped));
    }
    // If stripping didn't change anything, use the referenced table name
    return escapeIfNeeded(snakeToCamelCase(referencedTableName));
  }

  // Composite FK: use referenced table name
  return escapeIfNeeded(snakeToCamelCase(referencedTableName));
}

/**
 * Derives a back-relation field name.
 * For 1:N: pluralize the child model name (lowercased first char).
 * For 1:1: lowercase first char of child model name.
 */
export function deriveBackRelationFieldName(childModelName: string, isOneToOne: boolean): string {
  const base = childModelName.charAt(0).toLowerCase() + childModelName.slice(1);
  return isOneToOne ? base : pluralize(base);
}

/**
 * Converts a column name to a named type name for the types block.
 * E.g., column "email" with type "character varying(255)" → "Email"
 */
export function toNamedTypeName(columnName: string): string {
  if (hasSeparators(columnName)) {
    return snakeToPascalCase(columnName);
  }
  return columnName.charAt(0).toUpperCase() + columnName.slice(1);
}
