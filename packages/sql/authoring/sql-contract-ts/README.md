# @prisma-next/sql-contract-ts

**Status:** Phase 1 - Relocated SQL contract authoring code

This package contains the SQL-specific TypeScript contract authoring surface for Prisma Next.

## Overview

This package is part of the SQL family namespace and provides:
- SQL contract builder (`defineContract`)
- SQL contract validation (`validateContract`)
- SQL contract JSON schema

## Package Status

This package was created in Phase 1 of the contract authoring extraction. It contains the relocated SQL-specific authoring code from `@prisma-next/sql-query`. Phase 2 will extract the target-agnostic core into `@prisma-next/contract-authoring`.

## Exports

- `./contract-builder` - Contract builder API (`defineContract`, `ColumnBuilder`)
- `./contract` - Contract validation (`validateContract`, `computeMappings`)
- `./schema-sql` - SQL contract JSON schema

