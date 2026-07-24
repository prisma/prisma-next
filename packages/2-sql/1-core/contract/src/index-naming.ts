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
 * One D9 exact-name warning hit: a `map:`-named object carrying a
 * hand-authorable SQL body. `subject` is `index` here and `policy` when
 * policies adopt the same warning.
 */
export interface ExactNameBodyWarning {
  readonly subject: 'index' | 'policy';
  readonly exactName: string;
}

const EXACT_NAME_BODY_GUIDANCE =
  "Drift detection compares the authored SQL text byte-for-byte against Postgres's reprinted form, which is only reliable when the text was captured by contract infer. For hand-authored definitions, use name: and let Prisma Next manage the physical name; to migrate an adopted object to managed naming, replace map: with name: (keeping the body text unchanged) and apply the resulting rename migration.";

export const EXACT_NAME_BODY_WARNING_CODE = 'PN_EXACT_NAME_BODY_COMPARISON';

/**
 * A D9 hit rendered as a generic `{ code, message }` warning entry (the
 * shape the framework's `AuthoringWarningSink` accepts), still carrying its
 * structured fields so an accumulating layer can narrow it back into the
 * per-build {@link ExactNameBodyWarning} batch via
 * {@link isExactNameBodyWarningEntry}.
 */
export interface ExactNameBodyWarningEntry extends ExactNameBodyWarning {
  readonly code: typeof EXACT_NAME_BODY_WARNING_CODE;
  readonly message: string;
}

export function exactNameBodyWarningEntry(
  warning: ExactNameBodyWarning,
): ExactNameBodyWarningEntry {
  return {
    code: EXACT_NAME_BODY_WARNING_CODE,
    message: formatExactNameBodyWarning(warning),
    subject: warning.subject,
    exactName: warning.exactName,
  };
}

export function isExactNameBodyWarningEntry(w: {
  readonly code: string;
  readonly message: string;
}): w is ExactNameBodyWarningEntry {
  if (w.code !== EXACT_NAME_BODY_WARNING_CODE) return false;
  const candidate: Partial<ExactNameBodyWarning> & { readonly code: string } = w;
  return (
    (candidate.subject === 'index' || candidate.subject === 'policy') &&
    typeof candidate.exactName === 'string'
  );
}

const WARNING_BATCH_THRESHOLD = 5;

function formatExactNameBodyWarning(warning: ExactNameBodyWarning): string {
  return `${warning.subject} "${warning.exactName}" uses map: with a SQL body. ${EXACT_NAME_BODY_GUIDANCE}`;
}

/**
 * Flushes collected D9 warnings once per contract build: per-item warnings
 * (each naming its object) up to the threshold, one summary with the name
 * list above it — an adopted contract re-emit (which carries `map:` + body
 * for every adopted object once infer emits them) must not wall-of-text.
 */
export function flushExactNameBodyWarnings(warnings: readonly ExactNameBodyWarning[]): void {
  if (warnings.length === 0) {
    return;
  }
  if (warnings.length <= WARNING_BATCH_THRESHOLD) {
    for (const warning of warnings) {
      process.emitWarning(formatExactNameBodyWarning(warning), {
        code: EXACT_NAME_BODY_WARNING_CODE,
      });
    }
    return;
  }
  process.emitWarning(
    `${warnings.length} objects use map: with a SQL body. ${EXACT_NAME_BODY_GUIDANCE}\n` +
      warnings.map((warning) => `  - ${warning.subject} "${warning.exactName}"`).join('\n'),
    { code: EXACT_NAME_BODY_WARNING_CODE },
  );
}

/**
 * Lowers an authored index into the name-identified entity `contract.json`
 * persists: exact mode adopts `map` verbatim (no prefix, no hash); managed
 * mode appends the content-hash suffix to the authored or default prefix.
 * The cross-field guards are the shared enforcement backstop for both
 * authoring surfaces (PSL pre-empts them with span-anchored diagnostics).
 */
export function lowerAuthoredIndex(
  tableName: string,
  authored: AuthoredIndexInput,
  warnings?: { push(warning: ExactNameBodyWarning): void },
): IndexInput {
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
      const warning: ExactNameBodyWarning = { subject: 'index', exactName: authored.map };
      if (warnings !== undefined) {
        warnings.push(warning);
      } else {
        flushExactNameBodyWarnings([warning]);
      }
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
