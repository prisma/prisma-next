import { describe, expect, it } from 'vitest';
import {
  configFile,
  dbFile,
  starterSchema,
  targetPackageName,
} from '../../../src/commands/init/templates';

describe('templates', () => {
  describe('starterSchema', () => {
    it('contains User and Post models', () => {
      const schema = starterSchema();

      expect(schema).toContain('model User');
      expect(schema).toContain('model Post');
    });

    it('includes a relation between User and Post', () => {
      const schema = starterSchema();

      expect(schema).toContain('posts     Post[]');
      expect(schema).toContain('author    User');
    });
  });

  describe('configFile', () => {
    it('generates postgres config with single import from facade', () => {
      const config = configFile('postgres', './prisma/contract.prisma');

      expect(config).toContain("from '@prisma-next/postgres/config'");
      expect(config).toContain("contract: './prisma/contract.prisma'");
      const importLines = config.split('\n').filter((l) => l.includes("from '@prisma-next/"));
      expect(importLines).toHaveLength(1);
    });

    it('generates mongo config with single import from facade', () => {
      const config = configFile('mongo', './prisma/contract.prisma');

      expect(config).toContain("from '@prisma-next/mongo/config'");
      const importLines = config.split('\n').filter((l) => l.includes("from '@prisma-next/"));
      expect(importLines).toHaveLength(1);
    });
  });

  describe('dbFile', () => {
    it('generates postgres db.ts with single @prisma-next import', () => {
      const db = dbFile('postgres');

      expect(db).toContain("from '@prisma-next/postgres/runtime'");
      const prismaNextImports = db.split('\n').filter((l) => l.includes("from '@prisma-next/"));
      expect(prismaNextImports).toHaveLength(1);
    });

    it('generates mongo db.ts', () => {
      const db = dbFile('mongo');

      expect(db).toContain("from '@prisma-next/mongo/runtime'");
    });
  });

  describe('targetPackageName', () => {
    it('returns postgres package name', () => {
      expect(targetPackageName('postgres')).toBe('@prisma-next/postgres');
    });

    it('returns mongo package name', () => {
      expect(targetPackageName('mongo')).toBe('@prisma-next/mongo');
    });
  });
});
