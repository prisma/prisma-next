import { describe, expect, it } from 'vitest';
import { assertRuntimeContractRequirementsSatisfied } from '../src/framework-components';
import type {
  RuntimeAdapterDescriptor,
  RuntimeExtensionDescriptor,
  RuntimeTargetDescriptor,
} from '../src/types';

describe('assertRuntimeContractRequirementsSatisfied', () => {
  it('does nothing when requirements are satisfied', () => {
    const target: RuntimeTargetDescriptor<'sql', 'postgres'> = {
      kind: 'target',
      id: 'postgres',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    };
    const adapter: RuntimeAdapterDescriptor<'sql', 'postgres'> = {
      kind: 'adapter',
      id: 'postgres-adapter',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    };
    const extensions: RuntimeExtensionDescriptor<'sql', 'postgres'>[] = [
      {
        kind: 'extension',
        id: 'pgvector',
        familyId: 'sql',
        targetId: 'postgres',
        version: '1.0.0',
        create: () => ({ familyId: 'sql', targetId: 'postgres' }),
      },
    ];

    expect(() =>
      assertRuntimeContractRequirementsSatisfied({
        contract: { target: 'postgres', extensionPacks: { pgvector: {} } },
        target,
        adapter,
        extensions,
      }),
    ).not.toThrow();
  });

  it('throws when contract target mismatches runtime target descriptor', () => {
    const target: RuntimeTargetDescriptor<'sql', 'postgres'> = {
      kind: 'target',
      id: 'postgres',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    };
    const adapter: RuntimeAdapterDescriptor<'sql', 'postgres'> = {
      kind: 'adapter',
      id: 'postgres-adapter',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    };

    expect(() =>
      assertRuntimeContractRequirementsSatisfied({
        contract: { target: 'mysql' },
        target,
        adapter,
        extensions: [],
      }),
    ).toThrow(`Contract target 'mysql' does not match runtime target descriptor 'postgres'.`);
  });

  it('throws when required extension pack is missing', () => {
    const target: RuntimeTargetDescriptor<'sql', 'postgres'> = {
      kind: 'target',
      id: 'postgres',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    };
    const adapter: RuntimeAdapterDescriptor<'sql', 'postgres'> = {
      kind: 'adapter',
      id: 'postgres-adapter',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    };

    expect(() =>
      assertRuntimeContractRequirementsSatisfied({
        contract: { target: 'postgres', extensionPacks: { pgvector: {} } },
        target,
        adapter,
        extensions: [],
      }),
    ).toThrow(
      `Contract requires extension pack 'pgvector', but runtime descriptors do not provide a matching component.`,
    );
  });

  it('skips extension pack requirement when runtime extensions are provided', () => {
    const target: RuntimeTargetDescriptor<'sql', 'postgres'> = {
      kind: 'target',
      id: 'postgres',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    };
    const adapter: RuntimeAdapterDescriptor<'sql', 'postgres'> = {
      kind: 'adapter',
      id: 'postgres-adapter',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    };

    expect(() =>
      assertRuntimeContractRequirementsSatisfied({
        contract: { target: 'postgres', extensionPacks: { pgvector: {} } },
        target,
        adapter,
        extensions: [],
        runtimeExtensionPacksProvided: true,
      }),
    ).not.toThrow();
  });
});
