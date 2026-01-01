/**
 * CLI error envelope for output formatting.
 * This is the serialized form of a CliStructuredError.
 */
export interface CliErrorEnvelope {
  readonly code: string;
  readonly domain: string;
  readonly severity: 'error' | 'warn' | 'info';
  readonly summary: string;
  readonly why: string | undefined;
  readonly fix: string | undefined;
  readonly where:
    | {
        readonly path: string | undefined;
        readonly line: number | undefined;
      }
    | undefined;
  readonly meta: Record<string, unknown> | undefined;
  readonly docsUrl: string | undefined;
}

/**
 * Structured CLI error that contains all information needed for error envelopes.
 * Call sites throw these errors with full context.
 */
export class CliStructuredError extends Error {
  readonly code: string;
  readonly domain: 'CLI' | 'RTM';
  readonly severity: 'error' | 'warn' | 'info';
  readonly why: string | undefined;
  readonly fix: string | undefined;
  readonly where:
    | {
        readonly path: string | undefined;
        readonly line: number | undefined;
      }
    | undefined;
  readonly meta: Record<string, unknown> | undefined;
  readonly docsUrl: string | undefined;

  constructor(
    code: string,
    summary: string,
    options?: {
      readonly domain?: 'CLI' | 'RTM';
      readonly severity?: 'error' | 'warn' | 'info';
      readonly why?: string;
      readonly fix?: string;
      readonly where?: { readonly path?: string; readonly line?: number };
      readonly meta?: Record<string, unknown>;
      readonly docsUrl?: string;
    },
  ) {
    super(summary);
    this.name = 'CliStructuredError';
    this.code = code;
    this.domain = options?.domain ?? 'CLI';
    this.severity = options?.severity ?? 'error';
    this.why = options?.why;
    this.fix = options?.fix;
    this.where = options?.where
      ? {
          path: options.where.path,
          line: options.where.line,
        }
      : undefined;
    this.meta = options?.meta;
    this.docsUrl = options?.docsUrl;
  }

  /**
   * Converts this error to a CLI error envelope for output formatting.
   */
  toEnvelope(): CliErrorEnvelope {
    const codePrefix = this.domain === 'CLI' ? 'PN-CLI-' : 'PN-RTM-';
    return {
      code: `${codePrefix}${this.code}`,
      domain: this.domain,
      severity: this.severity,
      summary: this.message,
      why: this.why,
      fix: this.fix,
      where: this.where,
      meta: this.meta,
      docsUrl: this.docsUrl,
    };
  }
}

// ============================================================================
// Config Errors (PN-CLI-4001-4007)
// ============================================================================

/**
 * Config file not found or missing.
 */
export function errorConfigFileNotFound(
  configPath?: string,
  options?: {
    readonly why?: string;
  },
): CliStructuredError {
  return new CliStructuredError('4001', 'Config file not found', {
    domain: 'CLI',
    ...(options?.why ? { why: options.why } : { why: 'Config file not found' }),
    fix: "Run 'prisma-next init' to create a config file",
    docsUrl: 'https://prisma-next.dev/docs/cli/config',
    ...(configPath ? { where: { path: configPath } } : {}),
  });
}

/**
 * Contract configuration missing from config.
 */
export function errorContractConfigMissing(options?: {
  readonly why?: string;
}): CliStructuredError {
  return new CliStructuredError('4002', 'Contract configuration missing', {
    domain: 'CLI',
    why: options?.why ?? 'The contract configuration is required for emit',
    fix: 'Add contract configuration to your prisma-next.config.ts',
    docsUrl: 'https://prisma-next.dev/docs/cli/contract-emit',
  });
}

/**
 * Contract validation failed.
 */
export function errorContractValidationFailed(
  reason: string,
  options?: {
    readonly where?: { readonly path?: string; readonly line?: number };
  },
): CliStructuredError {
  return new CliStructuredError('4003', 'Contract validation failed', {
    domain: 'CLI',
    why: reason,
    fix: 'Check your contract file for errors',
    docsUrl: 'https://prisma-next.dev/docs/contracts',
    ...(options?.where ? { where: options.where } : {}),
  });
}

/**
 * File not found.
 */
export function errorFileNotFound(
  filePath: string,
  options?: {
    readonly why?: string;
  },
): CliStructuredError {
  return new CliStructuredError('4004', 'File not found', {
    domain: 'CLI',
    why: options?.why ?? `File not found: ${filePath}`,
    fix: 'Check that the file path is correct',
    where: { path: filePath },
  });
}

/**
 * Database URL is required but not provided.
 */
export function errorDatabaseUrlRequired(options?: { readonly why?: string }): CliStructuredError {
  return new CliStructuredError('4005', 'Database URL is required', {
    domain: 'CLI',
    why: options?.why ?? 'Database URL is required for db verify',
    fix: 'Provide --db flag or config.db.url in prisma-next.config.ts',
  });
}

/**
 * Query runner factory is required but not provided in config.
 */
export function errorQueryRunnerFactoryRequired(options?: {
  readonly why?: string;
}): CliStructuredError {
  return new CliStructuredError('4006', 'Query runner factory is required', {
    domain: 'CLI',
    why: options?.why ?? 'Config.db.queryRunnerFactory is required for db verify',
    fix: 'Add db.queryRunnerFactory to prisma-next.config.ts',
    docsUrl: 'https://prisma-next.dev/docs/cli/db-verify',
  });
}

/**
 * Family verify.readMarker is required but not provided.
 */
export function errorFamilyReadMarkerSqlRequired(options?: {
  readonly why?: string;
}): CliStructuredError {
  return new CliStructuredError('4007', 'Family readMarker() is required', {
    domain: 'CLI',
    why: options?.why ?? 'Family verify.readMarker is required for db verify',
    fix: 'Ensure family.verify.readMarker() is exported by your family package',
    docsUrl: 'https://prisma-next.dev/docs/cli/db-verify',
  });
}

/**
 * JSON output format not supported.
 */
export function errorJsonFormatNotSupported(options: {
  readonly command: string;
  readonly format: string;
  readonly supportedFormats: readonly string[];
}): CliStructuredError {
  return new CliStructuredError('4008', 'Unsupported JSON format', {
    domain: 'CLI',
    why: `The ${options.command} command does not support --json ${options.format}`,
    fix: `Use --json ${options.supportedFormats.join(' or ')}, or omit --json for human output`,
    meta: {
      command: options.command,
      format: options.format,
      supportedFormats: options.supportedFormats,
    },
  });
}

/**
 * Driver is required for DB-connected commands but not provided.
 */
export function errorDriverRequired(options?: { readonly why?: string }): CliStructuredError {
  return new CliStructuredError('4010', 'Driver is required for DB-connected commands', {
    domain: 'CLI',
    why: options?.why ?? 'Config.driver is required for db verify',
    fix: 'Add driver to prisma-next.config.ts',
    docsUrl: 'https://prisma-next.dev/docs/cli/db-verify',
  });
}

/**
 * Migration planning failed due to conflicts.
 */
export function errorMigrationPlanningFailed(options: {
  readonly conflicts: readonly {
    readonly kind: string;
    readonly summary: string;
    readonly why?: string;
  }[];
  readonly why?: string;
}): CliStructuredError {
  // Build "why" from conflict summaries - these contain the actual problem description
  const conflictSummaries = options.conflicts.map((c) => c.summary);
  const computedWhy = options.why ?? conflictSummaries.join('\n');

  // Build "fix" from conflict "why" fields - these contain actionable advice
  const conflictFixes = options.conflicts
    .map((c) => c.why)
    .filter((why): why is string => typeof why === 'string');
  const computedFix =
    conflictFixes.length > 0
      ? conflictFixes.join('\n')
      : 'Use `db schema-verify` to inspect conflicts, or ensure the database is empty';

  return new CliStructuredError('4020', 'Migration planning failed', {
    domain: 'CLI',
    why: computedWhy,
    fix: computedFix,
    meta: { conflicts: options.conflicts },
    docsUrl: 'https://prisma-next.dev/docs/cli/db-init',
  });
}

/**
 * Target does not support migrations (missing createPlanner/createRunner).
 */
export function errorTargetMigrationNotSupported(options?: {
  readonly why?: string;
}): CliStructuredError {
  return new CliStructuredError('4021', 'Target does not support migrations', {
    domain: 'CLI',
    why: options?.why ?? 'The configured target does not provide migration planner/runner',
    fix: 'Ensure you are using a target that supports migrations',
    docsUrl: 'https://prisma-next.dev/docs/cli/db-init',
  });
}

/**
 * Config validation error (missing required fields).
 */
export function errorConfigValidation(
  field: string,
  options?: {
    readonly why?: string;
  },
): CliStructuredError {
  return new CliStructuredError('4001', 'Config file not found', {
    domain: 'CLI',
    why: options?.why ?? `Config must have a "${field}" field`,
    fix: "Run 'prisma-next init' to create a config file",
    docsUrl: 'https://prisma-next.dev/docs/cli/config',
  });
}

// ============================================================================
// Runtime Errors (PN-RTM-3000-3003)
// ============================================================================

/**
 * Contract marker not found in database.
 */
export function errorMarkerMissing(options?: {
  readonly why?: string;
  readonly dbUrl?: string;
}): CliStructuredError {
  return new CliStructuredError('3001', 'Marker missing', {
    domain: 'RTM',
    why: options?.why ?? 'Contract marker not found in database',
    fix: 'Run `prisma-next db sign --db <url>` to create marker',
  });
}

/**
 * Contract hash does not match database marker.
 */
export function errorHashMismatch(options?: {
  readonly why?: string;
  readonly expected?: string;
  readonly actual?: string;
}): CliStructuredError {
  return new CliStructuredError('3002', 'Hash mismatch', {
    domain: 'RTM',
    why: options?.why ?? 'Contract hash does not match database marker',
    fix: 'Migrate database or re-sign if intentional',
    ...(options?.expected || options?.actual
      ? {
          meta: {
            ...(options.expected ? { expected: options.expected } : {}),
            ...(options.actual ? { actual: options.actual } : {}),
          },
        }
      : {}),
  });
}

/**
 * Contract target does not match config target.
 */
export function errorTargetMismatch(
  expected: string,
  actual: string,
  options?: {
    readonly why?: string;
  },
): CliStructuredError {
  return new CliStructuredError('3003', 'Target mismatch', {
    domain: 'RTM',
    why:
      options?.why ??
      `Contract target does not match config target (expected: ${expected}, actual: ${actual})`,
    fix: 'Align contract target and config target',
    meta: { expected, actual },
  });
}

/**
 * Generic runtime error.
 */
export function errorRuntime(
  summary: string,
  options?: {
    readonly why?: string;
    readonly fix?: string;
    readonly meta?: Record<string, unknown>;
  },
): CliStructuredError {
  return new CliStructuredError('3000', summary, {
    domain: 'RTM',
    ...(options?.why ? { why: options.why } : { why: 'Verification failed' }),
    ...(options?.fix ? { fix: options.fix } : { fix: 'Check contract and database state' }),
    ...(options?.meta ? { meta: options.meta } : {}),
  });
}

// ============================================================================
// Generic Error
// ============================================================================

/**
 * Generic unexpected error.
 */
export function errorUnexpected(
  message: string,
  options?: {
    readonly why?: string;
    readonly fix?: string;
  },
): CliStructuredError {
  return new CliStructuredError('4999', 'Unexpected error', {
    domain: 'CLI',
    why: options?.why ?? message,
    fix: options?.fix ?? 'Check the error message and try again',
  });
}
