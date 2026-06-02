import type { ContractCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { CodecDescriptorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';
import { createAstCodecResolver } from './ast-codec-resolver';

/**
 * Build a contract-free {@link ContractCodecRegistry} that resolves codecs
 * purely from AST-supplied {@link import('@prisma-next/framework-components/codec').CodecRef}s
 * against a target's descriptor registry.
 *
 * The control plane uses this to encode lowered DML parameters (marker /
 * ledger writes) without an `ExecutionContext` or a contract walk: control DML
 * carries each value's codec at the value site (`param(value, { codecId })`),
 * so dispatch only ever needs `forCodecRef`. `forColumn` is never reached and
 * returns `undefined`.
 */
export function createControlCodecRegistry(
  descriptors: CodecDescriptorRegistry,
): ContractCodecRegistry {
  const resolver = createAstCodecResolver(descriptors, (ref) => ({
    name: ref.codecId,
    usedAt: [],
  }));
  return {
    forColumn: () => undefined,
    forCodecRef: (ref) => resolver.forCodecRef(ref),
  };
}
