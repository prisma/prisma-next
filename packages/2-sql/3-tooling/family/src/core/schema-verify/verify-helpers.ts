/**
 * Pure verification helper functions for SQL schema verification.
 * These functions verify schema IR against contract requirements.
 */

import type { SchemaIssue, SchemaVerificationNode } from '@prisma-next/core-control-plane/types';
import type {
  ForeignKey,
  Index,
  PrimaryKey,
  UniqueConstraint,
} from '@prisma-next/sql-contract/types';
import type { SqlForeignKeyIR, SqlIndexIR, SqlUniqueIR } from '@prisma-next/sql-schema-ir/types';

/**
 * Compares two arrays of strings for equality (order-sensitive).
 */
export function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Verifies primary key matches between contract and schema.
 * Returns 'pass' or 'fail'.
 */
export function verifyPrimaryKey(
  contractPK: PrimaryKey,
  schemaPK: PrimaryKey | undefined,
  tableName: string,
  issues: SchemaIssue[],
): 'pass' | 'fail' {
  if (!schemaPK) {
    issues.push({
      kind: 'primary_key_mismatch',
      table: tableName,
      expected: contractPK.columns.join(', '),
      message: `Table "${tableName}" is missing primary key`,
    });
    return 'fail';
  }

  if (!arraysEqual(contractPK.columns, schemaPK.columns)) {
    issues.push({
      kind: 'primary_key_mismatch',
      table: tableName,
      expected: contractPK.columns.join(', '),
      actual: schemaPK.columns.join(', '),
      message: `Table "${tableName}" has primary key mismatch: expected columns [${contractPK.columns.join(', ')}], got [${schemaPK.columns.join(', ')}]`,
    });
    return 'fail';
  }

  // Compare name if both are modeled
  if (contractPK.name && schemaPK.name && contractPK.name !== schemaPK.name) {
    issues.push({
      kind: 'primary_key_mismatch',
      table: tableName,
      indexOrConstraint: contractPK.name,
      expected: contractPK.name,
      actual: schemaPK.name,
      message: `Table "${tableName}" has primary key name mismatch: expected "${contractPK.name}", got "${schemaPK.name}"`,
    });
    return 'fail';
  }

  return 'pass';
}

/**
 * Verifies foreign keys match between contract and schema.
 * Returns verification nodes for the tree.
 */
export function verifyForeignKeys(
  contractFKs: readonly ForeignKey[],
  schemaFKs: readonly SqlForeignKeyIR[],
  tableName: string,
  tablePath: string,
  issues: SchemaIssue[],
  strict: boolean,
): SchemaVerificationNode[] {
  const nodes: SchemaVerificationNode[] = [];

  // Check each contract FK exists in schema
  for (const contractFK of contractFKs) {
    const fkPath = `${tablePath}.foreignKeys[${contractFK.columns.join(',')}]`;
    const matchingFK = schemaFKs.find((fk) => {
      return (
        arraysEqual(fk.columns, contractFK.columns) &&
        fk.referencedTable === contractFK.references.table &&
        arraysEqual(fk.referencedColumns, contractFK.references.columns)
      );
    });

    if (!matchingFK) {
      issues.push({
        kind: 'foreign_key_mismatch',
        table: tableName,
        expected: `${contractFK.columns.join(', ')} -> ${contractFK.references.table}(${contractFK.references.columns.join(', ')})`,
        message: `Table "${tableName}" is missing foreign key: ${contractFK.columns.join(', ')} -> ${contractFK.references.table}(${contractFK.references.columns.join(', ')})`,
      });
      nodes.push({
        status: 'fail',
        kind: 'foreignKey',
        name: `foreignKey(${contractFK.columns.join(', ')})`,
        contractPath: fkPath,
        code: 'foreign_key_mismatch',
        message: 'Foreign key missing',
        expected: contractFK,
        actual: undefined,
        children: [],
      });
    } else {
      // Compare name if both are modeled
      if (contractFK.name && matchingFK.name && contractFK.name !== matchingFK.name) {
        issues.push({
          kind: 'foreign_key_mismatch',
          table: tableName,
          indexOrConstraint: contractFK.name,
          expected: contractFK.name,
          actual: matchingFK.name,
          message: `Table "${tableName}" has foreign key name mismatch: expected "${contractFK.name}", got "${matchingFK.name}"`,
        });
        nodes.push({
          status: 'fail',
          kind: 'foreignKey',
          name: `foreignKey(${contractFK.columns.join(', ')})`,
          contractPath: fkPath,
          code: 'foreign_key_mismatch',
          message: 'Foreign key name mismatch',
          expected: contractFK.name,
          actual: matchingFK.name,
          children: [],
        });
      } else {
        nodes.push({
          status: 'pass',
          kind: 'foreignKey',
          name: `foreignKey(${contractFK.columns.join(', ')})`,
          contractPath: fkPath,
          code: '',
          message: '',
          expected: undefined,
          actual: undefined,
          children: [],
        });
      }
    }
  }

  // Check for extra FKs in strict mode
  if (strict) {
    for (const schemaFK of schemaFKs) {
      const matchingFK = contractFKs.find((fk) => {
        return (
          arraysEqual(fk.columns, schemaFK.columns) &&
          fk.references.table === schemaFK.referencedTable &&
          arraysEqual(fk.references.columns, schemaFK.referencedColumns)
        );
      });

      if (!matchingFK) {
        issues.push({
          kind: 'extra_foreign_key',
          table: tableName,
          message: `Extra foreign key found in database (not in contract): ${schemaFK.columns.join(', ')} -> ${schemaFK.referencedTable}(${schemaFK.referencedColumns.join(', ')})`,
        });
        nodes.push({
          status: 'fail',
          kind: 'foreignKey',
          name: `foreignKey(${schemaFK.columns.join(', ')})`,
          contractPath: `${tablePath}.foreignKeys[${schemaFK.columns.join(',')}]`,
          code: 'extra_foreign_key',
          message: 'Extra foreign key found',
          expected: undefined,
          actual: schemaFK,
          children: [],
        });
      }
    }
  }

  return nodes;
}

/**
 * Verifies unique constraints match between contract and schema.
 * Returns verification nodes for the tree.
 */
export function verifyUniqueConstraints(
  contractUniques: readonly UniqueConstraint[],
  schemaUniques: readonly SqlUniqueIR[],
  tableName: string,
  tablePath: string,
  issues: SchemaIssue[],
  strict: boolean,
): SchemaVerificationNode[] {
  const nodes: SchemaVerificationNode[] = [];

  // Check each contract unique exists in schema
  for (const contractUnique of contractUniques) {
    const uniquePath = `${tablePath}.uniques[${contractUnique.columns.join(',')}]`;
    const matchingUnique = schemaUniques.find((u) =>
      arraysEqual(u.columns, contractUnique.columns),
    );

    if (!matchingUnique) {
      issues.push({
        kind: 'unique_constraint_mismatch',
        table: tableName,
        expected: contractUnique.columns.join(', '),
        message: `Table "${tableName}" is missing unique constraint: ${contractUnique.columns.join(', ')}`,
      });
      nodes.push({
        status: 'fail',
        kind: 'unique',
        name: `unique(${contractUnique.columns.join(', ')})`,
        contractPath: uniquePath,
        code: 'unique_constraint_mismatch',
        message: 'Unique constraint missing',
        expected: contractUnique,
        actual: undefined,
        children: [],
      });
    } else {
      // Compare name if both are modeled
      if (
        contractUnique.name &&
        matchingUnique.name &&
        contractUnique.name !== matchingUnique.name
      ) {
        issues.push({
          kind: 'unique_constraint_mismatch',
          table: tableName,
          indexOrConstraint: contractUnique.name,
          expected: contractUnique.name,
          actual: matchingUnique.name,
          message: `Table "${tableName}" has unique constraint name mismatch: expected "${contractUnique.name}", got "${matchingUnique.name}"`,
        });
        nodes.push({
          status: 'fail',
          kind: 'unique',
          name: `unique(${contractUnique.columns.join(', ')})`,
          contractPath: uniquePath,
          code: 'unique_constraint_mismatch',
          message: 'Unique constraint name mismatch',
          expected: contractUnique.name,
          actual: matchingUnique.name,
          children: [],
        });
      } else {
        nodes.push({
          status: 'pass',
          kind: 'unique',
          name: `unique(${contractUnique.columns.join(', ')})`,
          contractPath: uniquePath,
          code: '',
          message: '',
          expected: undefined,
          actual: undefined,
          children: [],
        });
      }
    }
  }

  // Check for extra uniques in strict mode
  if (strict) {
    for (const schemaUnique of schemaUniques) {
      const matchingUnique = contractUniques.find((u) =>
        arraysEqual(u.columns, schemaUnique.columns),
      );

      if (!matchingUnique) {
        issues.push({
          kind: 'extra_unique_constraint',
          table: tableName,
          message: `Extra unique constraint found in database (not in contract): ${schemaUnique.columns.join(', ')}`,
        });
        nodes.push({
          status: 'fail',
          kind: 'unique',
          name: `unique(${schemaUnique.columns.join(', ')})`,
          contractPath: `${tablePath}.uniques[${schemaUnique.columns.join(',')}]`,
          code: 'extra_unique_constraint',
          message: 'Extra unique constraint found',
          expected: undefined,
          actual: schemaUnique,
          children: [],
        });
      }
    }
  }

  return nodes;
}

/**
 * Verifies indexes match between contract and schema.
 * Returns verification nodes for the tree.
 */
export function verifyIndexes(
  contractIndexes: readonly Index[],
  schemaIndexes: readonly SqlIndexIR[],
  tableName: string,
  tablePath: string,
  issues: SchemaIssue[],
  strict: boolean,
): SchemaVerificationNode[] {
  const nodes: SchemaVerificationNode[] = [];

  // Check each contract index exists in schema
  for (const contractIndex of contractIndexes) {
    const indexPath = `${tablePath}.indexes[${contractIndex.columns.join(',')}]`;
    const matchingIndex = schemaIndexes.find(
      (idx) => arraysEqual(idx.columns, contractIndex.columns) && idx.unique === false,
    );

    if (!matchingIndex) {
      issues.push({
        kind: 'index_mismatch',
        table: tableName,
        expected: contractIndex.columns.join(', '),
        message: `Table "${tableName}" is missing index: ${contractIndex.columns.join(', ')}`,
      });
      nodes.push({
        status: 'fail',
        kind: 'index',
        name: `index(${contractIndex.columns.join(', ')})`,
        contractPath: indexPath,
        code: 'index_mismatch',
        message: 'Index missing',
        expected: contractIndex,
        actual: undefined,
        children: [],
      });
    } else {
      // Compare name if both are modeled
      if (contractIndex.name && matchingIndex.name && contractIndex.name !== matchingIndex.name) {
        issues.push({
          kind: 'index_mismatch',
          table: tableName,
          indexOrConstraint: contractIndex.name,
          expected: contractIndex.name,
          actual: matchingIndex.name,
          message: `Table "${tableName}" has index name mismatch: expected "${contractIndex.name}", got "${matchingIndex.name}"`,
        });
        nodes.push({
          status: 'fail',
          kind: 'index',
          name: `index(${contractIndex.columns.join(', ')})`,
          contractPath: indexPath,
          code: 'index_mismatch',
          message: 'Index name mismatch',
          expected: contractIndex.name,
          actual: matchingIndex.name,
          children: [],
        });
      } else {
        nodes.push({
          status: 'pass',
          kind: 'index',
          name: `index(${contractIndex.columns.join(', ')})`,
          contractPath: indexPath,
          code: '',
          message: '',
          expected: undefined,
          actual: undefined,
          children: [],
        });
      }
    }
  }

  // Check for extra indexes in strict mode
  if (strict) {
    for (const schemaIndex of schemaIndexes) {
      // Skip unique indexes (they're handled as unique constraints)
      if (schemaIndex.unique) {
        continue;
      }

      const matchingIndex = contractIndexes.find((idx) =>
        arraysEqual(idx.columns, schemaIndex.columns),
      );

      if (!matchingIndex) {
        issues.push({
          kind: 'extra_index',
          table: tableName,
          message: `Extra index found in database (not in contract): ${schemaIndex.columns.join(', ')}`,
        });
        nodes.push({
          status: 'fail',
          kind: 'index',
          name: `index(${schemaIndex.columns.join(', ')})`,
          contractPath: `${tablePath}.indexes[${schemaIndex.columns.join(',')}]`,
          code: 'extra_index',
          message: 'Extra index found',
          expected: undefined,
          actual: schemaIndex,
          children: [],
        });
      }
    }
  }

  return nodes;
}

/**
 * Verifies required extensions exist in schema.
 * Extracts extension names from contract.extensions (keys) and compares with schemaIR.extensions.
 * Filters out the target name (e.g., 'postgres') as it's not an extension.
 * Returns verification nodes for the tree.
 */
export function verifyExtensions(
  contractExtensions: Record<string, unknown> | undefined,
  schemaExtensions: readonly string[],
  contractTarget: string,
  issues: SchemaIssue[],
  _strict: boolean,
): SchemaVerificationNode[] {
  const nodes: SchemaVerificationNode[] = [];

  if (!contractExtensions) {
    return nodes;
  }

  // Extract extension names from contract (keys of extensions object)
  // Filter out the target name - it's not an extension (e.g., 'postgres' is the target, not an extension)
  const contractExtensionNames = Object.keys(contractExtensions).filter(
    (name) => name !== contractTarget,
  );

  // Check each contract extension exists in schema
  // Extension names in contract may differ from database extension names
  // (e.g., contract has 'pgvector' but database has 'vector')
  // We need to match more flexibly - try exact match, then check if either contains the other
  for (const extName of contractExtensionNames) {
    const extPath = `extensions.${extName}`;
    // Normalize extension names for comparison (remove common prefixes like 'pg')
    const normalizedExtName = extName.toLowerCase().replace(/^pg/, '');
    const matchingExt = schemaExtensions.find((e) => {
      const normalizedE = e.toLowerCase();
      // Exact match
      if (normalizedE === normalizedExtName || normalizedE === extName.toLowerCase()) {
        return true;
      }
      // Check if one contains the other (e.g., 'pgvector' contains 'vector', 'vector' is in 'pgvector')
      if (normalizedE.includes(normalizedExtName) || normalizedExtName.includes(normalizedE)) {
        return true;
      }
      return false;
    });

    // Map extension names to descriptive labels
    const extensionLabels: Record<string, string> = {
      pg: 'database is postgres',
      pgvector: 'vector extension is enabled',
      vector: 'vector extension is enabled',
    };
    const extensionLabel = extensionLabels[extName] ?? `extension "${extName}" is enabled`;

    if (!matchingExt) {
      issues.push({
        kind: 'extension_missing',
        table: '',
        message: `Extension "${extName}" is missing from database`,
      });
      nodes.push({
        status: 'fail',
        kind: 'extension',
        name: extensionLabel,
        contractPath: extPath,
        code: 'extension_missing',
        message: `Extension "${extName}" is missing`,
        expected: undefined,
        actual: undefined,
        children: [],
      });
    } else {
      nodes.push({
        status: 'pass',
        kind: 'extension',
        name: extensionLabel,
        contractPath: extPath,
        code: '',
        message: '',
        expected: undefined,
        actual: undefined,
        children: [],
      });
    }
  }

  // In strict mode, we don't check for extra extensions (they're allowed)
  // Extensions are additive - having extra extensions doesn't break the contract

  return nodes;
}

/**
 * Computes counts of pass/warn/fail nodes by traversing the tree.
 */
export function computeCounts(node: SchemaVerificationNode): {
  pass: number;
  warn: number;
  fail: number;
  totalNodes: number;
} {
  let pass = 0;
  let warn = 0;
  let fail = 0;

  function traverse(n: SchemaVerificationNode): void {
    if (n.status === 'pass') {
      pass++;
    } else if (n.status === 'warn') {
      warn++;
    } else if (n.status === 'fail') {
      fail++;
    }

    if (n.children) {
      for (const child of n.children) {
        traverse(child);
      }
    }
  }

  traverse(node);

  return {
    pass,
    warn,
    fail,
    totalNodes: pass + warn + fail,
  };
}
