import { basename, dirname, relative } from 'pathe';

/**
 * Build the canonical "re-emit this package" remediation hint.
 *
 * Every on-disk migration package ships its own `migration.ts` author-time
 * file. Running it regenerates `migration.json` and `ops.json` with the
 * correct hash + metadata, so it is the right primitive whenever a single
 * package's on-disk artifacts are missing, malformed, or otherwise corrupt.
 * Pointing users at `migration plan` would emit a *new* package rather than
 * heal the broken one.
 */
function reemitHint(dir: string, fallback?: string): string {
  const relativeDir = relative(process.cwd(), dir);
  const reemit = `Re-emit the package by running \`node "${relativeDir}/migration.ts"\``;
  return fallback ? `${reemit}, ${fallback}` : `${reemit}.`;
}

/**
 * Structured error for migration tooling operations.
 *
 * Follows the NAMESPACE.SUBCODE convention from ADR 027. All codes live under
 * the MIGRATION namespace. These are tooling-time errors (file I/O, hash
 * verification, migration history reconstruction), distinct from the runtime
 * MIGRATION.* codes for apply-time failures (PRECHECK_FAILED, POSTCHECK_FAILED,
 * etc.).
 *
 * Fields:
 * - code:     Stable machine-readable code (MIGRATION.SUBCODE)
 * - category: Always 'MIGRATION'
 * - why:      Explains the cause in plain language
 * - fix:      Actionable remediation step
 * - details:  Machine-readable structured data for agents
 */
export class MigrationToolsError extends Error {
  readonly code: string;
  readonly category = 'MIGRATION' as const;
  readonly why: string;
  readonly fix: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: string,
    summary: string,
    options: {
      readonly why: string;
      readonly fix: string;
      readonly details?: Record<string, unknown>;
    },
  ) {
    super(summary);
    this.name = 'MigrationToolsError';
    this.code = code;
    this.why = options.why;
    this.fix = options.fix;
    this.details = options.details;
  }

  static is(error: unknown): error is MigrationToolsError {
    if (!(error instanceof Error)) return false;
    const candidate = error as MigrationToolsError;
    return candidate.name === 'MigrationToolsError' && typeof candidate.code === 'string';
  }
}

export function errorDirectoryExists(dir: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.DIR_EXISTS', 'Migration directory already exists', {
    why: `The directory "${dir}" already exists. Each migration must have a unique directory.`,
    fix: 'Use --name to pick a different name, or delete the existing directory and re-run.',
    details: { dir },
  });
}

export function errorMissingFile(file: string, dir: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.FILE_MISSING', `Missing ${file}`, {
    why: `Expected "${file}" in "${dir}" but the file does not exist.`,
    fix: reemitHint(
      dir,
      'or delete the directory if the migration is unwanted and the source TypeScript is gone.',
    ),
    details: { file, dir },
  });
}

export function errorInvalidJson(filePath: string, parseError: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_JSON', 'Invalid JSON in migration file', {
    why: `Failed to parse "${filePath}": ${parseError}`,
    fix: reemitHint(dirname(filePath), 'or restore the directory from version control.'),
    details: { filePath, parseError },
  });
}

export function errorInvalidManifest(filePath: string, reason: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_MANIFEST', 'Invalid migration manifest', {
    why: `Migration manifest at "${filePath}" is invalid: ${reason}`,
    fix: reemitHint(dirname(filePath), 'or restore the directory from version control.'),
    details: { filePath, reason },
  });
}

export function errorInvalidSlug(slug: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_NAME', 'Invalid migration name', {
    why: `The slug "${slug}" contains no valid characters after sanitization (only a-z, 0-9 are kept).`,
    fix: 'Provide a name with at least one alphanumeric character, e.g. --name add_users.',
    details: { slug },
  });
}

export function errorInvalidDestName(destName: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_DEST_NAME', 'Invalid copy destination name', {
    why: `The destination name "${destName}" must be a single path segment (no ".." or directory separators).`,
    fix: 'Use a simple file name such as "contract.json" for each destination in the copy list.',
    details: { destName },
  });
}

export function errorSameSourceAndTarget(dir: string, hash: string): MigrationToolsError {
  const dirName = basename(dir);
  return new MigrationToolsError(
    'MIGRATION.SAME_SOURCE_AND_TARGET',
    'Migration has same source and target',
    {
      why: `Migration "${dirName}" has from === to === "${hash}". A migration must transition between two different contract states.`,
      fix: reemitHint(
        dir,
        'or delete the directory if the migration is unwanted and the source TypeScript is gone.',
      ),
      details: { dirName, hash },
    },
  );
}

export function errorAmbiguousTarget(
  branchTips: readonly string[],
  context?: {
    divergencePoint: string;
    branches: readonly {
      tip: string;
      edges: readonly { dirName: string; from: string; to: string }[];
    }[];
  },
): MigrationToolsError {
  const divergenceInfo = context
    ? `\nDivergence point: ${context.divergencePoint}\nBranches:\n${context.branches.map((b) => `  → ${b.tip} (${b.edges.length} edge(s): ${b.edges.map((e) => e.dirName).join(' → ') || 'direct'})`).join('\n')}`
    : '';
  return new MigrationToolsError('MIGRATION.AMBIGUOUS_TARGET', 'Ambiguous migration target', {
    why: `The migration history has diverged into multiple branches: ${branchTips.join(', ')}. This typically happens when two developers plan migrations from the same starting point.${divergenceInfo}`,
    fix: 'Use `migration ref set <name> <hash>` to target a specific branch, delete one of the conflicting migration directories and re-run `migration plan`, or use --from <hash> to explicitly select a starting point.',
    details: {
      branchTips,
      ...(context ? { divergencePoint: context.divergencePoint, branches: context.branches } : {}),
    },
  });
}

export function errorNoInitialMigration(nodes: readonly string[]): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.NO_INITIAL_MIGRATION', 'No initial migration found', {
    why: `No migration starts from the empty contract state (known hashes: ${nodes.join(', ')}). At least one migration must originate from the empty state.`,
    fix: 'Inspect the migrations directory for corrupted migration.json files. At least one migration must start from the empty contract hash.',
    details: { nodes },
  });
}

export function errorInvalidRefs(refsPath: string, reason: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_REFS', 'Invalid refs.json', {
    why: `refs.json at "${refsPath}" is invalid: ${reason}`,
    fix: 'Ensure refs.json is a flat object mapping valid ref names to contract hash strings.',
    details: { path: refsPath, reason },
  });
}

export function errorInvalidRefFile(filePath: string, reason: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_REF_FILE', 'Invalid ref file', {
    why: `Ref file at "${filePath}" is invalid: ${reason}`,
    fix: 'Ensure the ref file contains valid JSON with { "hash": "sha256:<64 hex chars>", "invariants": ["..."] }.',
    details: { path: filePath, reason },
  });
}

export function errorInvalidRefName(refName: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_REF_NAME', 'Invalid ref name', {
    why: `Ref name "${refName}" is invalid. Names must be lowercase alphanumeric with hyphens or forward slashes (no "." or ".." segments).`,
    fix: `Use a valid ref name (e.g., "staging", "envs/production").`,
    details: { refName },
  });
}

export function errorNoTarget(reachableHashes: readonly string[]): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.NO_TARGET', 'No migration target could be resolved', {
    why: `The migration history contains cycles and no target can be resolved automatically (reachable hashes: ${reachableHashes.join(', ')}). This typically happens after rollback migrations (e.g., C1→C2→C1).`,
    fix: 'Use --from <hash> to specify the planning origin explicitly.',
    details: { reachableHashes },
  });
}

export function errorInvalidRefValue(value: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_REF_VALUE', 'Invalid ref value', {
    why: `Ref value "${value}" is not a valid contract hash. Values must be in the format "sha256:<64 hex chars>" or "sha256:empty".`,
    fix: 'Use a valid storage hash from `prisma-next contract emit` output or an existing migration.',
    details: { value },
  });
}

export function errorDuplicateMigrationHash(migrationHash: string): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.DUPLICATE_MIGRATION_HASH',
    'Duplicate migrationHash in migration graph',
    {
      why: `Multiple migrations share migrationHash "${migrationHash}". Each migration must have a unique content-addressed identity.`,
      fix: 'Regenerate one of the conflicting migrations so each migrationHash is unique, then re-run migration commands.',
      details: { migrationHash },
    },
  );
}

export function errorInvalidInvariantId(invariantId: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_INVARIANT_ID', 'Invalid invariantId', {
    why: `invariantId ${JSON.stringify(invariantId)} is invalid. Ids must be non-empty and contain no whitespace or control characters (including Unicode whitespace like NBSP); other content (kebab-case, camelCase, namespaced, Unicode letters) is allowed.`,
    fix: 'Pick an invariantId without spaces, tabs, newlines, or control characters — e.g. "backfill-user-phone", "users/backfill-phone", or "BackfillUserPhone".',
    details: { invariantId },
  });
}

export function errorDuplicateInvariantInEdge(invariantId: string): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.DUPLICATE_INVARIANT_IN_EDGE',
    'Duplicate invariantId on a single migration',
    {
      why: `invariantId "${invariantId}" is declared by more than one dataTransform on the same migration. The marker stores invariants as a set and the routing layer treats them as edge-level, so two ops cannot share a routing identity.`,
      fix: 'Rename one of the conflicting dataTransform invariantIds, or drop invariantId on the op that does not need to be routing-visible.',
      details: { invariantId },
    },
  );
}

export function errorProvidedInvariantsMismatch(
  filePath: string,
  stored: readonly string[],
  derived: readonly string[],
): MigrationToolsError {
  const storedSet = new Set(stored);
  const derivedSet = new Set(derived);
  const missing = [...derivedSet].filter((id) => !storedSet.has(id));
  const extra = [...storedSet].filter((id) => !derivedSet.has(id));
  // When sets agree but arrays don't, the only difference is ordering — call
  // it out so the reader doesn't stare at two visually-identical arrays.
  // Canonical providedInvariants is sorted ascending; a manifest with the
  // same ids in a different order is still a mismatch (the hash check would
  // also fail), but the human-readable diagnostic is otherwise unhelpful.
  const orderingOnly = missing.length === 0 && extra.length === 0;
  const why = orderingOnly
    ? `migration.json at "${filePath}" stores providedInvariants ${JSON.stringify(stored)}, but the canonical value derived from ops.json is ${JSON.stringify(derived)} — same ids, different order. Canonical providedInvariants is sorted ascending.`
    : `migration.json at "${filePath}" stores providedInvariants ${JSON.stringify(stored)}, but the value derived from ops.json is ${JSON.stringify(derived)}. The manifest copy was likely hand-edited without re-emitting.`;
  return new MigrationToolsError(
    'MIGRATION.PROVIDED_INVARIANTS_MISMATCH',
    'providedInvariants on migration.json disagrees with ops.json',
    {
      why,
      fix: reemitHint(dirname(filePath), 'or restore the directory from version control.'),
      details: { filePath, stored, derived, difference: { missing, extra } },
    },
  );
}

export function errorMigrationHashMismatch(
  dir: string,
  storedHash: string,
  computedHash: string,
): MigrationToolsError {
  // Render a cwd-relative path in the human-readable diagnostic so users
  // running CLI commands from the project root see a familiar short path.
  // Keep the absolute path in `details.dir` for machine consumers.
  const relativeDir = relative(process.cwd(), dir);
  return new MigrationToolsError('MIGRATION.HASH_MISMATCH', 'Migration package is corrupt', {
    why: `Stored migrationHash "${storedHash}" does not match the recomputed hash "${computedHash}" for "${relativeDir}". The migration.json or ops.json has been edited or partially written since emit.`,
    fix: reemitHint(dir, 'or restore the directory from version control.'),
    details: { dir, storedHash, computedHash },
  });
}
