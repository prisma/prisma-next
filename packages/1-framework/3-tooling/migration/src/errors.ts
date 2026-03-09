/**
 * Structured error for migration tooling operations.
 *
 * Follows the NAMESPACE.SUBCODE convention from ADR 027. All codes live under
 * the MIGRATION namespace. These are tooling-time errors (file I/O, attestation,
 * migration-chain reconstruction), distinct from the runtime MIGRATION.* codes for apply-time
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

export function errorSelfLoop(dirName: string, hash: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.SELF_LOOP', 'Self-loop in migration graph', {
    why: `Migration "${dirName}" has from === to === "${hash}". A migration must transition between two different contract states.`,
    fix: 'Delete the invalid migration directory and re-run migration plan.',
    details: { dirName, hash },
  });
}

export function errorAmbiguousLeaf(leaves: readonly string[]): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.AMBIGUOUS_LEAF', 'Ambiguous migration graph', {
    why: `Multiple leaf nodes found: ${leaves.join(', ')}. The migration graph has diverged — this typically happens when two developers plan migrations from the same starting point.`,
    fix: 'Delete one of the conflicting migration directories, then re-run `migration plan` to re-plan it from the remaining branch. Or use --from <hash> to explicitly select a starting point.',
    details: { leaves },
  });
}

export function errorNoRoot(nodes: readonly string[]): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.NO_ROOT', 'Migration graph has no root', {
    why: `No root migration found in the migration graph (nodes: ${nodes.join(', ')}). No migration starts from the empty contract hash, or all edges form a disconnected subgraph.`,
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
    why: `Ref name "${refName}" is invalid. Names must be lowercase alphanumeric with hyphens or forward slashes, no path traversal.`,
    fix: `Use a valid ref name (e.g., "staging", "envs/production").`,
    details: { refName },
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
