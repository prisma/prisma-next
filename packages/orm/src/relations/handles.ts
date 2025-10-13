import { Schema, RelationGraph } from '@prisma/relational-ir';

export interface RelationHandles {
  [tableName: string]: {
    [relationName: string]: RelationHandle;
  };
}

export interface RelationHandle<P extends string = string, K extends string = string> {
  parent: P;
  child: string;
  cardinality: '1:N' | 'N:1';
  on: {
    parentCols: string[];
    childCols: string[];
  };
  name: K;
}

export function buildRelationHandles(ir: Schema, graph: RelationGraph): RelationHandles {
  const handles: RelationHandles = {};

  for (const [tableName, table] of Object.entries(ir.tables)) {
    handles[tableName] = {};

    // 1:N relations (outgoing edges from reverseEdges)
    const oneToMany = graph.reverseEdges.get(tableName) ?? [];
    for (const edge of oneToMany) {
      handles[tableName][edge.name] = {
        parent: tableName,
        child: edge.from.table,
        cardinality: '1:N',
        on: { parentCols: edge.to.columns, childCols: edge.from.columns },
        name: edge.name,
      };
    }

    // N:1 relations (incoming edges from edges)
    const manyToOne = graph.edges.get(tableName) ?? [];
    for (const edge of manyToOne) {
      handles[tableName][edge.name] = {
        parent: tableName,
        child: edge.to.table,
        cardinality: 'N:1',
        on: { parentCols: edge.from.columns, childCols: edge.to.columns },
        name: edge.name,
      };
    }
  }

  return handles;
}
