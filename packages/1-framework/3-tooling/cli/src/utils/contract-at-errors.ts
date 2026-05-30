import { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import { notOk, type Result } from '@prisma-next/utils/result';
import { join } from 'pathe';
import {
  CliStructuredError,
  errorContractValidationFailed,
  errorFileNotFound,
  errorSnapshotMissing,
  errorUnexpected,
  mapMigrationToolsError,
} from './cli-errors';

export function mapContractAtError(
  error: unknown,
  options?: { readonly artifactRole?: 'from' | 'to' },
): Result<never, CliStructuredError> {
  if (MigrationToolsError.is(error)) {
    switch (error.code) {
      case 'MIGRATION.SNAPSHOT_MISSING': {
        const refName =
          typeof error.details?.['refName'] === 'string'
            ? error.details['refName']
            : typeof error.details?.['identifier'] === 'string'
              ? error.details['identifier']
              : 'unknown';
        return notOk(errorSnapshotMissing(refName));
      }
      case 'MIGRATION.CONTRACT_DESERIALIZATION_FAILED': {
        const filePath =
          typeof error.details?.['filePath'] === 'string'
            ? error.details['filePath']
            : 'ref-snapshot';
        const message =
          typeof error.details?.['message'] === 'string' ? error.details['message'] : error.message;
        const isRefSnapshot = filePath.endsWith('.contract.json');
        return notOk(
          errorContractValidationFailed(
            isRefSnapshot
              ? `Ref snapshot contract failed to deserialize: ${message}`
              : `Predecessor contract at ${filePath} failed to deserialize: ${message}`,
            { where: { path: isRefSnapshot ? 'ref-snapshot' : filePath } },
          ),
        );
      }
      case 'MIGRATION.INVALID_JSON': {
        const filePath =
          typeof error.details?.['filePath'] === 'string' ? error.details['filePath'] : 'unknown';
        const message =
          typeof error.details?.['parseError'] === 'string'
            ? error.details['parseError']
            : error.message;
        const role = options?.artifactRole ?? 'from';
        return notOk(
          errorContractValidationFailed(
            role === 'to'
              ? `Target contract at ${filePath} failed to deserialize: ${message}`
              : `Predecessor contract at ${filePath} failed to deserialize: ${message}`,
            { where: { path: filePath } },
          ),
        );
      }
      case 'MIGRATION.BUNDLE_NOT_FOUND_FOR_GRAPH_NODE':
        return notOk(
          errorUnexpected(error.message, {
            why: error.why,
            fix: error.fix,
          }),
        );
      case 'MIGRATION.FILE_MISSING': {
        const file =
          typeof error.details?.['file'] === 'string' ? error.details['file'] : 'end-contract.json';
        const dir = typeof error.details?.['dir'] === 'string' ? error.details['dir'] : '';
        const jsonPath = dir ? join(dir, 'end-contract.json') : file;
        const role = options?.artifactRole ?? 'from';
        return notOk(
          errorFileNotFound(jsonPath, {
            why:
              role === 'to'
                ? `Target migration is missing its destination contract snapshot at ${jsonPath}`
                : `Predecessor migration is missing its destination contract snapshot at ${jsonPath}`,
            fix:
              role === 'to'
                ? 'Re-emit the target migration so its sibling `end-contract.json` / `end-contract.d.ts` are restored, then re-run this command.'
                : 'Re-emit the predecessor migration (`prisma-next migration plan` from its source) so its sibling `end-contract.json` is restored, then re-run this command.',
          }),
        );
      }
      default:
        return notOk(mapMigrationToolsError(error));
    }
  }
  if (CliStructuredError.is(error)) {
    return notOk(error);
  }
  throw error;
}
