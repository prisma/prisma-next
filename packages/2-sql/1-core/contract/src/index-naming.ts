import {
  assertWireNamePrefixLength,
  computeIndexContentHash,
  defaultIndexName,
  formatWireName,
} from '@prisma-next/sql-schema-ir/naming';
import { contractError } from './contract-errors';
import type { IndexInput } from './ir/sql-index';

/**
 * The authored element structure: a fields index carries `columns`, an
 * expression index carries `expression` — exactly one, never both.
 */
export type AuthoredIndexElements =
  | { readonly columns: readonly string[]; readonly expression?: never }
  | { readonly columns?: never; readonly expression: string };

/**
 * An index as authored, before naming: `map` is an exact physical name
 * (adopted verbatim); `name` is a managed wire-name prefix. With neither,
 * the managed prefix defaults to `defaultIndexName(table, columns)`.
 * `where`, `unique`, `type`, and `options` participate in the content hash
 * alongside the elements.
 */
export type AuthoredIndexInput = AuthoredIndexElements & {
  readonly where: string | undefined;
  readonly unique: boolean | undefined;
  readonly map: string | undefined;
  readonly name: string | undefined;
  readonly type: string | undefined;
  readonly options: Record<string, unknown> | undefined;
};

/**
 * The exact-name warning: hand-authoring a SQL body under `map:` makes
 * drift detection a byte-for-byte compare against Postgres's reprint, which
 * is only reliable for infer-captured text. `subject` is `index` here and
 * `policy` when policies adopt it.
 */
function emitExactNameBodyWarning(subject: string, exactName: string): void {
  process.emitWarning(
    `${subject} "${exactName}" uses map: with a SQL body. Drift detection compares the authored SQL text byte-for-byte against Postgres's reprinted form, which is only reliable when the text was captured by contract infer. For hand-authored definitions, use name: and let Prisma Next manage the physical name; to migrate an adopted object to managed naming, replace map: with name: (keeping the body text unchanged) and apply the resulting rename migration.`,
    { code: 'PN_EXACT_NAME_BODY_COMPARISON' },
  );
}

/**
 * Lowers an authored index into the name-identified entity `contract.json`
 * persists: exact mode adopts `map` verbatim (no prefix, no hash); managed
 * mode appends the content-hash suffix to the authored or default prefix.
 * The cross-field guards are the shared enforcement backstop for both
 * authoring surfaces (PSL pre-empts them with span-anchored diagnostics).
 */
export function lowerAuthoredIndex(tableName: string, authored: AuthoredIndexInput): IndexInput {
  if ((authored.columns === undefined) === (authored.expression === undefined)) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      `Index on table "${tableName}": an index takes either fields (columns) or an expression — exactly one, not both.`,
    );
  }
  if (authored.map !== undefined && authored.name !== undefined) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      `Index "${authored.map}" on table "${tableName}": map and name are mutually exclusive — map adopts an exact physical name, name is a managed prefix.`,
    );
  }
  if (
    authored.expression !== undefined &&
    authored.name === undefined &&
    authored.map === undefined
  ) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      `Index on table "${tableName}": an expression index requires an explicit name (name:) or exact physical name (map:) — a default name cannot be derived from an expression.`,
    );
  }

  const unique = authored.unique ?? false;

  if (authored.map !== undefined) {
    if (authored.expression !== undefined || authored.where !== undefined) {
      emitExactNameBodyWarning('index', authored.map);
    }
    const carried = {
      name: authored.map,
      prefix: undefined,
      where: authored.where,
      unique,
      type: authored.type,
      options: authored.options,
    };
    return authored.expression !== undefined
      ? { ...carried, expression: authored.expression }
      : { ...carried, columns: authored.columns ?? [] };
  }

  const prefix = authored.name ?? defaultIndexName(tableName, authored.columns ?? []);
  assertWireNamePrefixLength(prefix, 'index prefix');
  const hash = computeIndexContentHash({
    ...(authored.columns !== undefined && { columns: authored.columns }),
    ...(authored.expression !== undefined && { expression: authored.expression }),
    ...(authored.where !== undefined && { where: authored.where }),
    unique,
    ...(authored.type !== undefined && { type: authored.type }),
    ...(authored.options !== undefined && { options: authored.options }),
  });
  const carried = {
    name: formatWireName(prefix, hash),
    prefix,
    where: authored.where,
    unique,
    type: authored.type,
    options: authored.options,
  };
  return authored.expression !== undefined
    ? { ...carried, expression: authored.expression }
    : { ...carried, columns: authored.columns ?? [] };
}
