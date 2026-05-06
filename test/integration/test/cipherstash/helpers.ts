import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { int4Column } from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { createControlClient, enrichContract } from '@prisma-next/cli/control-api';
import type { Contract } from '@prisma-next/contract/types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import { emit } from '@prisma-next/emitter';
import type {
  CipherstashBulkDecryptArgs,
  CipherstashBulkEncryptArgs,
  CipherstashSdk,
  CipherstashSingleDecryptArgs,
} from '@prisma-next/extension-cipherstash';
import { encryptedString } from '@prisma-next/extension-cipherstash/column-types';
import cipherstashControl from '@prisma-next/extension-cipherstash/control';
import cipherstashPack from '@prisma-next/extension-cipherstash/pack';
import sqlControl from '@prisma-next/family-sql/control';
import sqlFamily from '@prisma-next/family-sql/pack';
import { createControlStack } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { sqlEmission } from '@prisma-next/sql-contract-emitter';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresControl from '@prisma-next/target-postgres/control';
import postgresPack from '@prisma-next/target-postgres/pack';
import { withClient } from '@prisma-next/test-utils';
import { createIntegrationTestDir } from '../utils/cli-test-helpers';

export function createCipherstashTsContract() {
  return defineContract({
    family: sqlFamily,
    target: postgresPack,
    extensionPacks: { cipherstash: cipherstashPack },
    models: {
      User: model('User', {
        fields: {
          id: field.column(int4Column).defaultSql('autoincrement()').id(),
          email: field.column(encryptedString({ equality: true, freeTextSearch: true })),
        },
      }).sql({ table: 'user' }),
    },
  });
}

export async function emitCipherstashTsContract<TContract extends Contract<SqlStorage>>(
  contract: TContract,
): Promise<Record<string, unknown>> {
  const stack = createControlStack({
    family: sqlControl,
    target: postgresControl,
    adapter: postgresAdapter,
    driver: undefined,
    extensionPacks: [cipherstashControl],
  });

  // Enrich so target/adapter/extension capabilities (notably `returning`)
  // land on the emitted JSON. Without this step the resulting contract has
  // an empty `capabilities: {}` and any ORM mutation that calls
  // `assertReturningCapability` fails at the runtime entry point.
  const enriched = enrichContract(contract, [postgresControl, postgresAdapter, cipherstashControl]);
  const emitted = await emit(enriched, stack, sqlEmission);
  return JSON.parse(emitted.contractJson) as Record<string, unknown>;
}

export async function emitCipherstashPslContract(
  schemaText: string,
): Promise<Record<string, unknown>> {
  const testDir = createIntegrationTestDir();
  const schemaPath = join(testDir, 'schema.prisma');
  writeFileSync(schemaPath, schemaText, 'utf-8');

  const stack = createControlStack({
    family: sqlControl,
    target: postgresControl,
    adapter: postgresAdapter,
    driver: undefined,
    extensionPacks: [cipherstashControl],
  });

  try {
    const contractConfig = prismaContract(schemaPath, {
      target: postgresControl,
    });

    const pslResult = await contractConfig.source.load({
      composedExtensionPacks: [cipherstashControl.id],
      scalarTypeDescriptors: stack.scalarTypeDescriptors,
      authoringContributions: stack.authoringContributions,
      codecLookup: stack.codecLookup,
      controlMutationDefaults: stack.controlMutationDefaults,
      resolvedInputs: [schemaPath],
    });

    if (!pslResult.ok) {
      throw new Error('cipherstash PSL emission failed');
    }

    const enriched = enrichContract(pslResult.value, [
      postgresControl,
      postgresAdapter,
      cipherstashControl,
    ]);
    const emitted = await emit(enriched, stack, sqlEmission);
    return JSON.parse(emitted.contractJson) as Record<string, unknown>;
  } finally {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }
}

export async function withCipherstashControlClient<T>(
  connectionString: string,
  fn: (client: ReturnType<typeof createControlClient>) => Promise<T>,
): Promise<T> {
  const client = createControlClient({
    family: sqlControl,
    target: postgresControl,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: [cipherstashControl],
  });
  try {
    await client.connect(connectionString);
    return await fn(client);
  } finally {
    await client.close();
  }
}

export interface EqlInstallMarkers {
  readonly schemaExists: boolean;
  readonly configurationTableExists: boolean;
}

export async function readEqlInstallMarkers(connectionString: string): Promise<EqlInstallMarkers> {
  let schemaExists = false;
  let configurationTableExists = false;
  await withClient(connectionString, async (client) => {
    const schema = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'eql_v2') AS exists",
    );
    schemaExists = schema.rows[0]?.exists === true;

    const table = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'eql_v2_configuration') AS exists",
    );
    configurationTableExists = table.rows[0]?.exists === true;
  });

  return { schemaExists, configurationTableExists };
}

interface MockCiphertext {
  readonly c: string;
  readonly i: {
    readonly t: string;
    readonly c: string;
  };
  readonly v: '2';
}

function asMockCiphertext(value: unknown): MockCiphertext {
  if (
    typeof value === 'object' &&
    value !== null &&
    'c' in value &&
    typeof value.c === 'string' &&
    'i' in value &&
    typeof value.i === 'object' &&
    value.i !== null &&
    't' in value.i &&
    typeof value.i.t === 'string' &&
    'c' in value.i &&
    typeof value.i.c === 'string'
  ) {
    return {
      c: value.c,
      i: {
        t: value.i.t,
        c: value.i.c,
      },
      v: '2',
    };
  }

  throw new Error(`unexpected ciphertext payload: ${JSON.stringify(value)}`);
}

function encodeCiphertext(plaintext: string, table: string, column: string): MockCiphertext {
  return {
    c: Buffer.from(plaintext, 'utf8').toString('base64'),
    i: {
      t: table,
      c: column,
    },
    v: '2',
  };
}

function decodeCiphertext(ciphertext: unknown): string {
  const parsed = asMockCiphertext(ciphertext);
  return Buffer.from(parsed.c, 'base64').toString('utf8');
}

export interface MockCipherstashSdk extends CipherstashSdk {
  readonly decryptCalls: CipherstashSingleDecryptArgs[];
  readonly bulkEncryptCalls: CipherstashBulkEncryptArgs[];
  readonly bulkDecryptCalls: CipherstashBulkDecryptArgs[];
}

export function createMockCipherstashSdk(): MockCipherstashSdk {
  const decryptCalls: CipherstashSingleDecryptArgs[] = [];
  const bulkEncryptCalls: CipherstashBulkEncryptArgs[] = [];
  const bulkDecryptCalls: CipherstashBulkDecryptArgs[] = [];

  return {
    decryptCalls,
    bulkEncryptCalls,
    bulkDecryptCalls,
    async decrypt(args) {
      decryptCalls.push(args);
      return decodeCiphertext(args.ciphertext);
    },
    async bulkEncrypt(args) {
      bulkEncryptCalls.push(args);
      return args.values.map((value) =>
        encodeCiphertext(value, args.routingKey.table, args.routingKey.column),
      );
    },
    async bulkDecrypt(args) {
      bulkDecryptCalls.push(args);
      return args.ciphertexts.map((ciphertext) => decodeCiphertext(ciphertext));
    },
  };
}
