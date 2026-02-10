import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { withTestRuntime } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

describe('DDL E2E Tests', { timeout: 30000 }, () => {
  it('creates tables on db initialization', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ sql }) => {
      expect(sql).toMatchInlineSnapshot(`
        "CREATE EXTENSION IF NOT EXISTS vector;

        CREATE TABLE "public"."comment" (
          "content" text NOT NULL,
          "created_at" timestamptz DEFAULT now() NOT NULL,
          "id" SERIAL NOT NULL,
          "postId" int4 NOT NULL,
          "update_at" timestamptz,
          PRIMARY KEY ("id")
        );

        CREATE TABLE "public"."event" (
          "created_at" timestamptz DEFAULT now() NOT NULL,
          "id" text NOT NULL,
          "name" text NOT NULL,
          PRIMARY KEY ("id")
        );

        CREATE TABLE "public"."post" (
          "created_at" timestamptz DEFAULT now() NOT NULL,
          "id" SERIAL NOT NULL,
          "published" bool NOT NULL,
          "title" text NOT NULL,
          "update_at" timestamptz,
          "userId" int4 NOT NULL,
          PRIMARY KEY ("id")
        );

        CREATE TABLE "public"."user" (
          "created_at" timestamptz DEFAULT now() NOT NULL,
          "email" text NOT NULL,
          "id" SERIAL NOT NULL,
          "update_at" timestamptz,
          PRIMARY KEY ("id")
        )"
      `);
    });
  });
});
