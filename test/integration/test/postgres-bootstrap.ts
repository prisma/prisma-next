import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { LoweredStatement } from '@prisma-next/sql-relational-core/ast';
import {
  buildControlTableBootstrapQueries,
  buildSignMarkerBootstrapQueries,
} from '@prisma-next/target-postgres/contract-free';
import type { PostgresContract } from '@prisma-next/target-postgres/types';
import type { Client } from 'pg';

const postgresControlAdapter = createPostgresAdapter();
const postgresControlLowererContext = { contract: {} as PostgresContract };

export async function executeLoweredStatement(
  client: Client,
  statement: LoweredStatement,
): Promise<void> {
  if (statement.params.length > 0) {
    await client.query(statement.sql, [...statement.params]);
    return;
  }
  await client.query(statement.sql);
}

export async function bootstrapPostgresSignMarkerTables(client: Client): Promise<void> {
  for (const query of buildSignMarkerBootstrapQueries()) {
    await executeLoweredStatement(
      client,
      postgresControlAdapter.lower(query, postgresControlLowererContext),
    );
  }
}

export async function bootstrapPostgresControlSchema(client: Client): Promise<void> {
  const schemaQuery = buildControlTableBootstrapQueries()[0];
  if (!schemaQuery) {
    throw new Error('expected prisma_contract schema bootstrap query');
  }
  await executeLoweredStatement(
    client,
    postgresControlAdapter.lower(schemaQuery, postgresControlLowererContext),
  );
}

export async function bootstrapPostgresControlTables(client: Client): Promise<void> {
  for (const query of buildControlTableBootstrapQueries()) {
    await executeLoweredStatement(
      client,
      postgresControlAdapter.lower(query, postgresControlLowererContext),
    );
  }
}
