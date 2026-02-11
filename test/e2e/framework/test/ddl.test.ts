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

        CREATE TABLE "public"."param_types" (
          "bits" bit varying(12),
          "code" character(16),
          "created_at" timestamptz(3),
          "duration" interval(6),
          "flags" bit(8),
          "id" SERIAL NOT NULL,
          "name" character varying(255),
          "price" numeric(10,2),
          "starts_at" time(2),
          "starts_at_tz" timetz(2),
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
          "email" character varying(255) NOT NULL,
          "id" SERIAL NOT NULL,
          "update_at" timestamptz,
          PRIMARY KEY ("id")
        )"
      `);
    });
  });
});
