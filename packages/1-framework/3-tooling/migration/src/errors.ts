/**
 * Structured error for migration tooling operations.
 *
 * Follows the NAMESPACE.SUBCODE convention from ADR 027. All codes live under
 * the MIGRATION namespace. These are tooling-time errors (file I/O, attestation,
 * migration history reconstruction), distinct from the runtime MIGRATION.* codes for apply-time
 * failures (PRECHECK_FAILED, POSTCHECK_FAILED, etc.).
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
    fix: 'Ensure the migration directory contains both migration.json and ops.json. If the directory is corrupt, delete it and re-run migration plan.',
    details: { file, dir },
  });
}

export function errorInvalidJson(filePath: string, parseError: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_JSON', 'Invalid JSON in migration file', {
    why: `Failed to parse "${filePath}": ${parseError}`,
    fix: 'Fix the JSON syntax error, or delete the migration directory and re-run migration plan.',
    details: { filePath, parseError },
  });
}

export function errorInvalidManifest(filePath: string, reason: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_MANIFEST', 'Invalid migration manifest', {
    why: `Manifest at "${filePath}" is invalid: ${reason}`,
    fix: 'Ensure the manifest has all required fields (from, to, kind, toContract). If corrupt, delete and re-plan.',
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

export function errorSameSourceAndTarget(dirName: string, hash: string): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.SAME_SOURCE_AND_TARGET',
    'Migration has same source and target',
    {
      why: `Migration "${dirName}" has from === to === "${hash}". A migration must transition between two different contract states.`,
      fix: 'Delete the invalid migration directory and re-run migration plan.',
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

export function errorDuplicateMigrationId(migrationId: string): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.DUPLICATE_MIGRATION_ID',
    'Duplicate migrationId in migration graph',
    {
      why: `Multiple migrations share migrationId "${migrationId}". Each migration must have a unique content-addressed identity.`,
      fix: 'Regenerate one of the conflicting migrations so each migrationId is unique, then re-run migration commands.',
      details: { migrationId },
    },
  );
}
