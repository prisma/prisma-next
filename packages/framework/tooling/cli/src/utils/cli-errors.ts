/**
 * Structured CLI error that contains all information needed for error envelopes.
 * Call sites throw these errors with full context, and mapErrorToCliEnvelope extracts the fields.
 */
export class CliStructuredError extends Error {
  readonly code: string;
  readonly domain: 'CLI' | 'RTM';
  readonly severity: 'error' | 'warn' | 'info';
  readonly why?: string;
  readonly fix?: string;
  readonly where?: {
    readonly path?: string;
    readonly line?: number;
  };
  readonly meta?: Record<string, unknown>;
  readonly docsUrl?: string;
  readonly exitCode?: number;

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
      readonly exitCode?: number;
    },
  ) {
    super(summary);
    this.name = 'CliStructuredError';
    this.code = code;
    this.domain = options?.domain ?? 'CLI';
    this.severity = options?.severity ?? 'error';
    if (options?.why !== undefined) {
      this.why = options.why;
    }
    if (options?.fix !== undefined) {
      this.fix = options.fix;
    }
    if (options?.where !== undefined) {
      this.where = options.where;
    }
    if (options?.meta !== undefined) {
      this.meta = options.meta;
    }
    if (options?.docsUrl !== undefined) {
      this.docsUrl = options.docsUrl;
    }
    if (options?.exitCode !== undefined) {
      this.exitCode = options.exitCode;
    }
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
    exitCode: 2,
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
    exitCode: 2,
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
    exitCode: 2,
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
    exitCode: 2,
  });
}

/**
 * Family verify.readMarkerSql is required but not provided.
 */
export function errorFamilyReadMarkerSqlRequired(options?: {
  readonly why?: string;
}): CliStructuredError {
  return new CliStructuredError('4007', 'Family readMarkerSql() is required', {
    domain: 'CLI',
    why: options?.why ?? 'Family verify.readMarkerSql is required for db verify',
    fix: 'Ensure family.verify.readMarkerSql() is exported by your family package',
    docsUrl: 'https://prisma-next.dev/docs/cli/db-verify',
    exitCode: 2,
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
    exitCode: 2,
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
    exitCode: 1,
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
    exitCode: 1,
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
    exitCode: 1,
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
    exitCode: 1,
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
    exitCode: 1,
  });
}
