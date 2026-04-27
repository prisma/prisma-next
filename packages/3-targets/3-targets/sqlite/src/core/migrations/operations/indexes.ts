import { buildCreateIndexSql, buildDropIndexSql } from '../planner-ddl-builders';
import { buildTargetDetails } from '../planner-target-details';
import { esc, type Op, step } from './shared';

export function createIndex(tableName: string, indexName: string, columns: readonly string[]): Op {
  return {
    id: `index.${tableName}.${indexName}`,
    label: `Create index ${indexName} on ${tableName}`,
    summary: `Creates index ${indexName} on ${tableName}`,
    operationClass: 'additive',
    target: { id: 'sqlite', details: buildTargetDetails('index', indexName, tableName) },
    precheck: [
      step(
        `ensure index "${indexName}" is missing`,
        `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'index' AND name = '${esc(indexName)}'`,
      ),
    ],
    execute: [
      step(`create index "${indexName}"`, buildCreateIndexSql(tableName, indexName, columns)),
    ],
    postcheck: [
      step(
        `verify index "${indexName}" exists`,
        `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'index' AND name = '${esc(indexName)}'`,
      ),
    ],
  };
}

export function dropIndex(tableName: string, indexName: string): Op {
  return {
    id: `dropIndex.${tableName}.${indexName}`,
    label: `Drop index ${indexName} on ${tableName}`,
    summary: `Drops index ${indexName} on ${tableName} which is not in the contract`,
    operationClass: 'destructive',
    target: { id: 'sqlite', details: buildTargetDetails('index', indexName, tableName) },
    precheck: [
      step(
        `ensure index "${indexName}" exists`,
        `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'index' AND name = '${esc(indexName)}'`,
      ),
    ],
    execute: [step(`drop index "${indexName}"`, buildDropIndexSql(indexName))],
    postcheck: [
      step(
        `verify index "${indexName}" is gone`,
        `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'index' AND name = '${esc(indexName)}'`,
      ),
    ],
  };
}
