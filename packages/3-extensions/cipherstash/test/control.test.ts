import { describe, expect, it } from 'vitest';
import { EQL_INSTALL_SQL, EQL_INSTALL_VERSION } from '../src/core/eql-bundle';
import { cipherstashControlDescriptor } from '../src/exports/control';

describe('cipherstash control descriptor — AC-INSTALL1 (databaseDependencies.init)', () => {
  it('declares one init entry installing the EQL extension', () => {
    const init = cipherstashControlDescriptor.databaseDependencies?.init;
    expect(init).toBeDefined();
    expect(init).toHaveLength(1);
    expect(init?.[0]?.id).toBe('postgres.extension.eql');
  });

  it('init entry has a single install operation targeting postgres', () => {
    const installs = cipherstashControlDescriptor.databaseDependencies?.init?.[0]?.install;
    expect(installs).toHaveLength(1);
    const install = installs?.[0];
    expect(install?.id).toBe('extension.eql.install');
    expect(install?.operationClass).toBe('additive');
    expect(install?.target.id).toBe('postgres');
  });

  it('install has precheck/execute/postcheck step shapes per the spec', () => {
    const install = cipherstashControlDescriptor.databaseDependencies?.init?.[0]?.install?.[0];
    expect(install?.precheck).toHaveLength(1);
    expect(install?.precheck[0]?.sql).toContain('eql_v2_configuration');
    expect(install?.execute).toHaveLength(1);
    expect(install?.execute[0]?.sql).toBeDefined();
    expect(install?.postcheck).toHaveLength(1);
    expect(install?.postcheck[0]?.sql).toContain('eql_v2');
  });

  it('execute step carries the vendored EQL install SQL bundle', () => {
    const sql =
      cipherstashControlDescriptor.databaseDependencies?.init?.[0]?.install?.[0]?.execute[0]?.sql;
    expect(sql).toBe(EQL_INSTALL_SQL);
    expect(EQL_INSTALL_SQL).toContain('CREATE SCHEMA eql_v2');
    expect(EQL_INSTALL_SQL).toContain('eql_v2_configuration');
    expect(EQL_INSTALL_VERSION).toMatch(/^eql-/);
  });

  it('descriptor is shaped as a sql-family postgres control extension', () => {
    expect(cipherstashControlDescriptor.familyId).toBe('sql');
    expect(cipherstashControlDescriptor.targetId).toBe('postgres');
  });
});
