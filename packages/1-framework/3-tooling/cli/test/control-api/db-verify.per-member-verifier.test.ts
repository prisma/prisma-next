import { createSqlContract } from '@prisma-next/contract/testing';
import type { Contract } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { createContractSpaceMember } from '@prisma-next/migration-tools/aggregate';
import { blindCast } from '@prisma-next/utils/casts';
import { describe, expect, it, vi } from 'vitest';
import {
  createPerMemberVerifier,
  type ExecuteDbVerifyOptions,
} from '../../src/control-api/operations/db-verify';

describe('createPerMemberVerifier', () => {
  it('passes the resolved contract value to verifySchema, not the contract() thunk', () => {
    const contract = createSqlContract({
      target: 'postgres',
      storage: {
        namespaces: { [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, tables: { user: {} } } },
      },
    });
    const member = createContractSpaceMember({
      spaceId: 'app',
      packages: [],
      refs: {},
      headRef: { hash: contract.storage.storageHash, invariants: [] },
      refsDir: '/tmp/refs',
      resolveContract: () => contract,
      deserializeContract: (json) => json as Contract,
    });

    const verifySchema = vi.fn().mockReturnValue({
      ok: true,
      summary: 'ok',
      contract: { storageHash: contract.storage.storageHash },
      target: { expected: 'postgres' },
      schema: {
        issues: [],
        root: {
          status: 'pass',
          kind: 'root',
          name: 'app',
          contractPath: '',
          code: 'OK',
          message: '',
          expected: undefined,
          actual: undefined,
          children: [],
        },
        counts: { pass: 0, warn: 0, fail: 0, totalNodes: 0 },
      },
      timings: { total: 0 },
    });

    const verifier = createPerMemberVerifier(
      blindCast<ExecuteDbVerifyOptions<string, string>, 'minimal verifySchema seam'>({
        skipSchema: false,
        familyInstance: { verifySchema },
        frameworkComponents: [],
      }),
    );

    verifier({}, member, 'strict');

    expect(verifySchema).toHaveBeenCalledOnce();
    const passedContract = verifySchema.mock.calls[0]![0].contract as Contract;
    expect(typeof passedContract).toBe('object');
    expect(passedContract).toBe(contract);
    expect(typeof (member as { contract: unknown }).contract).toBe('function');
    expect(passedContract).not.toBe(member.contract);
  });
});
