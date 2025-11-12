export interface CliErrorEnvelope {
  readonly code: string;
  readonly domain: string;
  readonly severity: 'error' | 'warn' | 'info';
  readonly summary: string;
  readonly why?: string;
  readonly fix?: string;
  readonly where?: {
    readonly path?: string;
    readonly line?: number;
  };
  readonly meta?: Record<string, unknown>;
  readonly docsUrl?: string;
  /**
   * Exit code for this error. 2 for usage/config errors, 1 for runtime errors.
   */
  readonly exitCode?: number;
}

/**
 * Creates a CLI error envelope with PN-CLI-4xxx code.
 */
export function createCliError(
  code: string,
  summary: string,
  options?: {
    readonly why?: string;
    readonly fix?: string;
    readonly where?: { readonly path?: string; readonly line?: number };
    readonly meta?: Record<string, unknown>;
    readonly docsUrl?: string;
    readonly exitCode?: number;
  },
): CliErrorEnvelope {
  return {
    code: `PN-CLI-${code}`,
    domain: 'CLI',
    severity: 'error',
    summary,
    why: options?.why,
    fix: options?.fix,
    where: options?.where,
    meta: options?.meta,
    docsUrl: options?.docsUrl,
    exitCode: options?.exitCode,
  };
}

/**
 * Creates a runtime error envelope with PN-RTM-3xxx code.
 */
export function createRtmError(
  code: string,
  summary: string,
  options?: {
    readonly why?: string;
    readonly fix?: string;
    readonly where?: { readonly path?: string; readonly line?: number };
    readonly meta?: Record<string, unknown>;
    readonly docsUrl?: string;
    readonly exitCode?: number;
  },
): CliErrorEnvelope {
  return {
    code: `PN-RTM-${code}`,
    domain: 'RTM',
    severity: 'error',
    summary,
    why: options?.why,
    fix: options?.fix,
    where: options?.where,
    meta: options?.meta,
    docsUrl: options?.docsUrl,
    exitCode: options?.exitCode ?? 1,
  };
}

/**
 * Maps common errors to CLI error envelopes.
 */
export function mapErrorToCliEnvelope(error: unknown): CliErrorEnvelope {
  if (error instanceof Error) {
    const message = error.message;

    // Config file not found (usage/config error - exit code 2)
    if (message.includes('Config file not found') || message.includes('not found')) {
      return createCliError('4001', 'Config file not found', {
        why: message,
        fix: 'Create prisma-next.config.ts in your project root or specify a path with --config',
        docsUrl: 'https://prisma-next.dev/docs/cli/config',
        exitCode: 2,
      });
    }

    // Contract config missing (usage/config error - exit code 2)
    if (message.includes('Config.contract is required')) {
      return createCliError('4002', 'Contract configuration missing', {
        why: 'The contract configuration is required for emit',
        fix: 'Add contract configuration to your prisma-next.config.ts',
        docsUrl: 'https://prisma-next.dev/docs/cli/contract-emit',
        exitCode: 2,
      });
    }

    // Contract validation errors
    if (
      message.includes('Contract') &&
      (message.includes('invalid') || message.includes('validation'))
    ) {
      return createCliError('4003', 'Contract validation failed', {
        why: message,
        fix: 'Check your contract file for errors',
        docsUrl: 'https://prisma-next.dev/docs/contracts',
      });
    }

    // File I/O errors
    if (
      message.includes('ENOENT') ||
      message.includes('Cannot find') ||
      message.includes('No such file')
    ) {
      return createCliError('4004', 'File not found', {
        why: message,
        fix: 'Check that the file path is correct',
      });
    }

    // Database URL missing (usage/config error - exit code 2)
    if (message.includes('Database URL is required')) {
      return createCliError('4005', 'Database URL is required', {
        why: message,
        fix: 'Provide --db flag, config.db.url, or DATABASE_URL environment variable',
        exitCode: 2,
      });
    }

    // Generic error (runtime error - exit code 1)
    return createCliError('4999', 'Unexpected error', {
      why: message,
      fix: 'Check the error message and try again',
      exitCode: 1,
    });
  }

  return createCliError('4999', 'Unexpected error', {
    why: String(error),
    fix: 'Check the error message and try again',
    exitCode: 1,
  });
}
