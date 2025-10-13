import { createFromBuilder } from './builder';
import { Tables, Table, TABLE_NAME, TableName, ContractMismatchMode, FromBuilder } from './types';
import { Schema } from '@prisma/relational-ir';

export interface SqlOptions {
  onContractMismatch?: ContractMismatchMode;
}

export function sql(
  ir: Schema,
  opts?: SqlOptions,
): {
  from<TTables extends Tables>(table: Table<any> | TableName<TTables>): FromBuilder<any, never>;
} {
  const contractHash = ir.contractHash;
  const onContractMismatch = opts?.onContractMismatch ?? 'error';

  return {
    from<TTables extends Tables>(table: Table<any> | TableName<TTables>) {
      const tableName = typeof table === 'string' ? table : table[TABLE_NAME];

      // Verify table has matching contract hash
      if (typeof table !== 'string' && table.__contractHash !== contractHash) {
        const msg =
          `E_CONTRACT_MISMATCH: contract hash mismatch in from()\n` +
          `→ expected: ${contractHash || 'undefined'}\n→ got: ${table.__contractHash || 'undefined'}\n` +
          `Hint: ensure all DSL elements come from the same IR`;

        if (onContractMismatch === 'warn') {
          console.warn(msg);
        } else {
          throw new Error(msg);
        }
      }

      return createFromBuilder(tableName, { contractHash, onContractMismatch }) as any;
    },
  };
}
