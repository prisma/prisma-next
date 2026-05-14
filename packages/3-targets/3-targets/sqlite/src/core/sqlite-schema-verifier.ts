import type { Contract } from '@prisma-next/contract/types';
import { SqlSchemaVerifierBase } from '@prisma-next/family-sql/ir';
import type { SchemaIssue, SchemaVerifyOptions } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';

/**
 * SQLite target `SchemaVerifier` concretion. Mirrors the Postgres
 * shape: hooks return the empty list pending the call-site migration
 * that routes the existing verifier behaviour through the SPI.
 */
export class SqliteSchemaVerifier extends SqlSchemaVerifierBase<Contract<SqlStorage>, SqlSchemaIR> {
  protected verifyCommonSqlSchema(
    _options: SchemaVerifyOptions<Contract<SqlStorage>, SqlSchemaIR>,
  ): readonly SchemaIssue[] {
    return [];
  }

  protected verifyTargetExtensions(
    _options: SchemaVerifyOptions<Contract<SqlStorage>, SqlSchemaIR>,
  ): readonly SchemaIssue[] {
    return [];
  }
}
