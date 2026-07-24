import {
  assertWireNamePrefixLength,
  computeIndexContentHash,
  defaultIndexName,
  formatWireName,
} from '@prisma-next/sql-schema-ir/naming';
import { contractError } from './contract-errors';
import type { IndexInput } from './ir/sql-index';

/**
 * An index as authored, before naming: `map` is an exact physical name
 * (adopted verbatim); `name` is a managed wire-name prefix. With neither,
 * the managed prefix defaults to `defaultIndexName(table, columns)`.
 * Exactly one of `columns` / `expression` is set; `where` and `unique`
 * participate in the content hash alongside them.
 */
export interface AuthoredIndexInput {
  readonly columns?: readonly string[];
  readonly expression?: string;
  readonly where?: string;
  readonly unique?: boolean;
  readonly map?: string;
  readonly name?: string;
  readonly type?: string;
  readonly options?: Record<string, unknown>;
}

/**
 * The D9 exact-name warning: hand-authoring a SQL body under `map:` makes
 * drift detection a byte-for-byte compare against Postgres's reprint, which
 * is only reliable for infer-captured text. Wording is pinned by the project
 * decision; `subject` is `index` here and `policy` when policies adopt it.
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
  const carried = {
    ...(authored.columns !== undefined && { columns: authored.columns }),
    ...(authored.expression !== undefined && { expression: authored.expression }),
    ...(authored.where !== undefined && { where: authored.where }),
    unique,
    ...(authored.type !== undefined && { type: authored.type }),
    ...(authored.options !== undefined && { options: authored.options }),
  } as const;

  if (authored.map !== undefined) {
    if (authored.expression !== undefined || authored.where !== undefined) {
      emitExactNameBodyWarning('index', authored.map);
    }
    return { name: authored.map, ...carried };
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
  return { name: formatWireName(prefix, hash), prefix, ...carried };
}
