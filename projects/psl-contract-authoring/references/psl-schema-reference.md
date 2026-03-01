# Schema API (/docs/orm/reference/prisma-schema-reference)



datasource [#datasource]

Defines a [data source](/orm/prisma-schema/overview/data-sources) in the Prisma schema.

Fields [#fields]

A `datasource` block accepts the following fields:

| Name           | Required | Type                                                                            | Description                                                                                                                           |
| -------------- | -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`     | **Yes**  | String (`postgresql`, `mysql`, `sqlite`, `sqlserver`, `mongodb`, `cockroachdb`) | Specifies the database connector to use.                                                                                              |
| `relationMode` | No       | String (`foreignKeys`, `prisma`)                                                | Sets whether [referential integrity](/orm/prisma-schema/data-model/relations/relation-mode) is enforced by foreign keys or by Prisma. |
| `schemas`      | No       | Array of strings                                                                | List of database schemas to include ([multi-schema](/orm/prisma-schema/data-model/multi-schema) support, PostgreSQL and SQL Server).  |
| `extensions`   | No       | Array of extension names                                                        | [PostgreSQL extensions](/orm/prisma-schema/postgresql-extensions) to enable.                                                          |

Connection URLs (`url`, `directUrl`, `shadowDatabaseUrl`) are configured in [`prisma.config.ts`](/orm/reference/prisma-config-reference#datasourceurl), not in the schema file.

The following providers are available:

* [`sqlite`](/orm/core-concepts/supported-databases/sqlite)
* [`postgresql`](/orm/core-concepts/supported-databases/postgresql)
* [`mysql`](/orm/core-concepts/supported-databases/mysql)
* [`sqlserver`](/orm/core-concepts/supported-databases/sql-server)
* [`mongodb`](/orm/core-concepts/supported-databases/mongodb)
* [`cockroachdb`](/orm/core-concepts/supported-databases/postgresql#cockroachdb)

Remarks [#remarks]

* You can only have **one** `datasource` block in a schema.
* `datasource db` is convention - however, you can give your data source any name - for example, `datasource mysql` or `datasource data`.

Examples [#examples]

PostgreSQL datasource [#postgresql-datasource]

```prisma
datasource db {
  provider = "postgresql"
}
```

Configure the connection URL in `prisma.config.ts`:

```ts
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

Learn more about PostgreSQL connection strings [here](/orm/core-concepts/supported-databases/postgresql).

Specify a PostgreSQL data source via an environment variable [#specify-a-postgresql-data-source-via-an-environment-variable]

In this example, the target database is available with the following credentials:

* User: `johndoe`
* Password: `mypassword`
* Host: `localhost`
* Port: `5432`
* Database name: `mydb`
* Schema name: `public`

```prisma
datasource db {
  provider = "postgresql"
}
```

When running a Prisma CLI command that needs the database connection URL (e.g. `prisma generate`), you need to make sure that the `DATABASE_URL` environment variable is set.

One way to do so is by creating a [`.env`](https://github.com/motdotla/dotenv) file with the following contents. Note that the file must be in the same directory as your `schema.prisma` file to automatically picked up the Prisma CLI.

```
DATABASE_URL=postgresql://johndoe:mypassword@localhost:5432/mydb?schema=public
```

MySQL datasource [#mysql-datasource]

```prisma
datasource db {
  provider = "mysql"
}
```

Learn more about [MySQL connection URLs](/orm/core-concepts/supported-databases/mysql).

MongoDB datasource [#mongodb-datasource]

```prisma
datasource db {
  provider = "mongodb"
}
```

Learn more about [MongoDB connection URLs](/orm/core-concepts/supported-databases/mongodb).

SQLite datasource [#sqlite-datasource]

```prisma
datasource db {
  provider = "sqlite"
}
```

Learn more about [SQLite connection URLs](/orm/core-concepts/supported-databases/sqlite).

CockroachDB datasource [#cockroachdb-datasource]

```prisma
datasource db {
  provider = "cockroachdb"
}
```

CockroachDB uses the same connection URL format as PostgreSQL. Learn more about [PostgreSQL connection URLs](/orm/core-concepts/supported-databases/postgresql).

Multi-schema datasource (PostgreSQL) [#multi-schema-datasource-postgresql]

```prisma
datasource db {
  provider = "postgresql"
  schemas  = ["public", "analytics"]
}
```

generator [#generator]

Defines a [generator](/orm/prisma-schema/overview/generators) in the Prisma schema.

Fields for prisma-client-js provider [#fields-for-prisma-client-js-provider]

This is the default generator for Prisma ORM 6.x and earlier versions. Learn more about [generators](/orm/prisma-schema/overview/generators#prisma-client-js-deprecated).

A `generator` block accepts the following fields:

| Name              | Required | Type                         | Description                                                                                                                                                                          |
| :---------------- | :------- | :--------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`        | **Yes**  | `prisma-client-js`           | Describes which [generator](/orm/prisma-schema/overview/generators) to use. This can point to a file that implements a generator or specify a built-in generator directly.           |
| `output`          | No       | String (file path)           | Determines the location for the generated client, [learn more](/orm/reference/prisma-schema-reference#fields-for-prisma-client-provider). **Default**: `node_modules/.prisma/client` |
| `previewFeatures` | No       | List of Enums                | Use intellisense to see list of currently available Preview features (`Ctrl+Space` in Visual Studio Code) **Default**: none                                                          |
| `engineType`      | No       | Enum (`library` or `binary`) | Defines the query engine type to download and use. **Default**: `library`                                                                                                            |
| `binaryTargets`   | No       | List of Enums (see below)    | Specify the OS on which the Prisma Client will run to ensure compatibility of the query engine. **Default**: `native`                                                                |
| `moduleFormat`    | No       | Enum (`cjs` or `esm`)        | Defines the module format of the generated Prisma Client. This field is available only with `prisma-client` generator.                                                               |

<CalloutContainer type="info">
  <CalloutTitle>
    important
  </CalloutTitle>

  <CalloutDescription>
    We recommend defining a custom output path, adding the path to `.gitignore`, and then making sure to run `prisma generate` via a custom build script or postinstall hook.
  </CalloutDescription>
</CalloutContainer>

Fields for prisma-client provider [#fields-for-prisma-client-provider]

The ESM-first client generator that offers greater control and flexibility across different JavaScript environments. It generates plain TypeScript code into a custom directory, providing full visibility over the generated code. Learn more about the new [`prisma-client`](/orm/prisma-schema/overview/generators#prisma-client) generator.

<CalloutContainer type="info">
  <CalloutDescription>
    The `prisma-client` generator is the default generator in Prisma ORM 7.
  </CalloutDescription>
</CalloutContainer>

A `generator` block accepts the following fields:

| Name                     | Required | Type                                                                                                               | Description                                                                                                                                                                                                                               |
| :----------------------- | :------- | :----------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`               | **Yes**  | `prisma-client`                                                                                                    | Describes which [generator](/orm/prisma-schema/overview/generators) to use. This can point to a file that implements a generator or specify a built-in generator directly.                                                                |
| `output`                 | **Yes**  | String (file path)                                                                                                 | Determines the location for the generated client, [learn more](/orm/reference/prisma-schema-reference#fields-for-prisma-client-provider).                                                                                                 |
| `previewFeatures`        | No       | List of Enums                                                                                                      | Use intellisense to see list of currently available Preview features (`Ctrl+Space` in Visual Studio Code) **Default**: none                                                                                                               |
| `runtime`                | No       | Enum (`nodejs`, `deno`, `bun`, `workerd` (alias `cloudflare`), `vercel-edge` (alias `edge-light`), `react-native`) | Target runtime environment. **Default**: `nodejs`                                                                                                                                                                                         |
| `moduleFormat`           | No       | Enum (`esm` or `cjs`)                                                                                              | Determines whether the generated code supports ESM (uses `import`) or CommonJS (uses `require(...)`) modules. We always recommend `esm` unless you have a good reason to use `cjs`. **Default**: Inferred from environment.               |
| `generatedFileExtension` | No       | Enum (`ts` or `mts` or `cts`)                                                                                      | File extension for generated TypeScript files. **Default**: `ts`                                                                                                                                                                          |
| `importFileExtension`    | No       | Enum (`ts`,`mts`,`cts`,`js`,`mjs`,`cjs`, empty (for bare imports))                                                 | File extension used in import statements **Default**: Inferred from environment.                                                                                                                                                          |
| `compilerBuild`          | No       | String (`fast`, `small`)                                                                                           | Defines what build of the query compiler to use for the generated client. `fast`, the default, gives you fast query compilation, but with an increase in size. `small` gives you the smallest size, but with a slightly slower execution. |

binaryTargets options [#binarytargets-options]

The following tables list all supported operating systems with the name of platform to specify in `binaryTargets`.

Unless specified otherwise, the default supported CPU architecture is x86\_64.

macOS [#macos]

| Build OS            | Prisma engine build name |
| :------------------ | :----------------------- |
| macOS Intel x86\_64 | `darwin`                 |
| macOS ARM64         | `darwin-arm64`           |

Windows [#windows]

| Build OS | Prisma engine build name |
| :------- | :----------------------- |
| Windows  | `windows`                |

Linux (Alpine on x86_64 architectures) [#linux-alpine-on-x86_64-architectures]

| Build OS                | Prisma engine build name   | OpenSSL |
| :---------------------- | :------------------------- | :-----: |
| Alpine (3.17 and newer) | `linux-musl-openssl-3.0.x` |  3.0.x  |
| Alpine (3.16 and older) | `linux-musl`               |  1.1.x  |

Linux (Alpine on ARM64 architectures) [#linux-alpine-on-arm64-architectures]

| Build OS                | Prisma engine build name         | OpenSSL |
| :---------------------- | :------------------------------- | :-----: |
| Alpine (3.17 and newer) | `linux-musl-arm64-openssl-3.0.x` |  3.0.x  |
| Alpine (3.16 and older) | `linux-musl-arm64-openssl-1.1.x` |  1.1.x  |

Linux (Debian), x86_64 [#linux-debian-x86_64]

| Build OS             | Prisma engine build name | OpenSSL |
| :------------------- | :----------------------- | :-----: |
| Debian 8 (Jessie)    | `debian-openssl-1.0.x`   |  1.0.x  |
| Debian 9 (Stretch)   | `debian-openssl-1.1.x`   |  1.1.x  |
| Debian 10 (Buster)   | `debian-openssl-1.1.x`   |  1.1.x  |
| Debian 11 (Bullseye) | `debian-openssl-1.1.x`   |  1.1.x  |
| Debian 12 (Bookworm) | `debian-openssl-3.0.x`   |  3.0.x  |

Linux (Ubuntu), x86_64 [#linux-ubuntu-x86_64]

| Build OS               | Prisma engine build name | OpenSSL |
| :--------------------- | :----------------------- | :-----: |
| Ubuntu 14.04 (trusty)  | `debian-openssl-1.0.x`   |  1.0.x  |
| Ubuntu 16.04 (xenial)  | `debian-openssl-1.0.x`   |  1.0.x  |
| Ubuntu 18.04 (bionic)  | `debian-openssl-1.1.x`   |  1.1.x  |
| Ubuntu 19.04 (disco)   | `debian-openssl-1.1.x`   |  1.1.x  |
| Ubuntu 20.04 (focal)   | `debian-openssl-1.1.x`   |  1.1.x  |
| Ubuntu 21.04 (hirsute) | `debian-openssl-1.1.x`   |  1.1.x  |
| Ubuntu 22.04 (jammy)   | `debian-openssl-3.0.x`   |  3.0.x  |
| Ubuntu 23.04 (lunar)   | `debian-openssl-3.0.x`   |  3.0.x  |

Linux (CentOS), x86_64 [#linux-centos-x86_64]

| Build OS | Prisma engine build name | OpenSSL |
| :------- | :----------------------- | :-----: |
| CentOS 7 | `rhel-openssl-1.0.x`     |  1.0.x  |
| CentOS 8 | `rhel-openssl-1.1.x`     |  1.1.x  |

Linux (Fedora), x86_64 [#linux-fedora-x86_64]

| Build OS  | Prisma engine build name | OpenSSL |
| :-------- | :----------------------- | :-----: |
| Fedora 28 | `rhel-openssl-1.1.x`     |  1.1.x  |
| Fedora 29 | `rhel-openssl-1.1.x`     |  1.1.x  |
| Fedora 30 | `rhel-openssl-1.1.x`     |  1.1.x  |
| Fedora 36 | `rhel-openssl-3.0.x`     |  3.0.x  |
| Fedora 37 | `rhel-openssl-3.0.x`     |  3.0.x  |
| Fedora 38 | `rhel-openssl-3.0.x`     |  3.0.x  |

Linux (Linux Mint), x86_64 [#linux-linux-mint-x86_64]

| Build OS      | Prisma engine build name | OpenSSL |
| :------------ | :----------------------- | :-----: |
| Linux Mint 18 | `debian-openssl-1.0.x`   |  1.0.x  |
| Linux Mint 19 | `debian-openssl-1.1.x`   |  1.1.x  |
| Linux Mint 20 | `debian-openssl-1.1.x`   |  1.1.x  |
| Linux Mint 21 | `debian-openssl-3.0.x`   |  3.0.x  |

Linux (Arch Linux), x86_64 [#linux-arch-linux-x86_64]

| Build OS              | Prisma engine build name | OpenSSL |
| :-------------------- | :----------------------- | :-----: |
| Arch Linux 2019.09.01 | `debian-openssl-1.1.x`   |  1.1.x  |
| Arch Linux 2023.04.23 | `debian-openssl-3.0.x`   |  3.0.x  |

Linux ARM64 (all major distros but Alpine) [#linux-arm64-all-major-distros-but-alpine]

| Build OS                       | Prisma engine build name    | OpenSSL |
| :----------------------------- | :-------------------------- | :-----: |
| Linux ARM64 glibc-based distro | `linux-arm64-openssl-1.0.x` |  1.0.x  |
| Linux ARM64 glibc-based distro | `linux-arm64-openssl-1.1.x` |  1.1.x  |
| Linux ARM64 glibc-based distro | `linux-arm64-openssl-3.0.x` |  3.0.x  |

Examples [#examples-1]

Specify the prisma-client-js generator with the default output, previewFeatures, engineType and binaryTargets [#specify-the-prisma-client-js-generator-with-the-default-output-previewfeatures-enginetype-and-binarytargets]

```prisma
generator client {
  provider = "prisma-client-js"
}
```

Note that the above `generator` definition is **equivalent** to the following because it uses the default values for `output`, `engineType` and `binaryTargets` (and implicitly `previewFeatures`):

```prisma
generator client {
  provider      = "prisma-client-js"
  output        = "node_modules/.prisma/client"
  engineType    = "library"
  binaryTargets = ["native"]
}
```

Specify a custom output location for Prisma Client [#specify-a-custom-output-location-for-prisma-client]

This example shows how to define a custom `output` location of the generated asset to override the default one.

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/client"
}
```

Specify custom binaryTargets to ensure compatibility with the OS [#specify-custom-binarytargets-to-ensure-compatibility-with-the-os]

This example shows how to configure Prisma Client to run on `Ubuntu 19.04 (disco)` based on the table [above](#linux-ubuntu-x86_64).

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["debian-openssl-1.1.x"]
}
```

Specify a provider pointing to some custom generator implementation [#specify-a-provider-pointing-to-some-custom-generator-implementation]

This example shows how to use a custom generator that's located in a directory called `my-generator`.

```prisma
generator client {
  provider = "./my-generator"
}
```

model [#model]

Defines a Prisma [model](/orm/prisma-schema/data-model/models#defining-models) .

Remarks [#remarks-1]

* Every record of a model must be *uniquely* identifiable. You must define *at least* one of the following attributes per model:
  * [`@unique`](#unique)
  * [`@@unique`](#unique-1)
  * [`@id`](#id)
  * [`@@id`](#id-1)

Naming conventions [#naming-conventions]

* Model names must adhere to the following regular expression: `[A-Za-z][A-Za-z0-9_]*`
* Model names must start with a letter and are typically spelled in [PascalCase](https://wiki.c2.com/?PascalCase)
* Model names should use the singular form (for example, `User` instead of `user`, `users` or `Users`)
* Prisma ORM has a number of **reserved words** that are being used by Prisma ORM internally and therefore cannot be used as a model name. You can find the reserved words [here](https://github.com/prisma/prisma/blob/6.5.0/packages/client/src/generation/generateClient.ts#L556-L605) and [here](https://github.com/prisma/prisma-engines/blob/main/psl/parser-database/src/names/reserved_model_names.rs#L44).

> **Note**: You can use the [`@@map` attribute](#map-1) to map a model (for example, `User`) to a table with a different name that does not match model naming conventions (for example, `users`).

Order of fields [#order-of-fields]

* Introspection lists model fields in the same order as the corresponding columns in the database. Relation fields are listed after scalar fields.

Examples [#examples-2]

A model named User with two scalar fields [#a-model-named-user-with-two-scalar-fields]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      email String  @unique // `email` can not be optional because it's the only unique field on the model
      name  String?
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id    String  @default(auto()) @map("_id") @db.ObjectId
      email String  @unique
      name  String?
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

model fields [#model-fields]

[Fields](/orm/prisma-schema/data-model/models#defining-fields) are properties of models.

Remarks [#remarks-2]

Naming conventions [#naming-conventions-1]

* Must start with a letter
* Typically spelled in camelCase
* Must adhere to the following regular expression: `[A-Za-z][A-Za-z0-9_]*`

> **Note**: You can use the [`@map` attribute](#map) to [map a field name to a column](/orm/prisma-client/setup-and-configuration/custom-model-and-field-names) with a different name that does not match field naming conventions: e.g. `myField @map("my_field")`.

model field scalar types [#model-field-scalar-types]

The *data source connector* determines what *native database type* each of Prisma ORM scalar type maps to. Similarly, the *generator* determines what *type in the target programming language* each of these types map to.

Prisma models also have [model field types](/orm/prisma-schema/data-model/relations) that define relations between models.

String [#string]

Variable length text.

Default type mappings [#default-type-mappings]

| Connector   | Default mapping  |
| ----------- | ---------------- |
| PostgreSQL  | `text`           |
| SQL Server  | `nvarchar(1000)` |
| MySQL       | `varchar(191)`   |
| MongoDB     | `String`         |
| SQLite      | `TEXT`           |
| CockroachDB | `STRING`         |

PostgreSQL [#postgresql]

| Native database type | Native database type attribute | Notes                                                                                                                                                                    |
| :------------------- | :----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `text`               | `@db.Text`                     |                                                                                                                                                                          |
| `char(x)`            | `@db.Char(x)`                  |                                                                                                                                                                          |
| `varchar(x)`         | `@db.VarChar(x)`               |                                                                                                                                                                          |
| `bit(x)`             | `@db.Bit(x)`                   |                                                                                                                                                                          |
| `varbit`             | `@db.VarBit`                   |                                                                                                                                                                          |
| `uuid`               | `@db.Uuid`                     |                                                                                                                                                                          |
| `xml`                | `@db.Xml`                      |                                                                                                                                                                          |
| `inet`               | `@db.Inet`                     |                                                                                                                                                                          |
| `citext`             | `@db.Citext`                   | Only available if [Citext extension is enabled](/orm/prisma-schema/data-model/unsupported-database-features#enable-postgresql-extensions-for-native-database-functions). |

MySQL [#mysql]

| Native database type | Native database type attribute |
| :------------------- | :----------------------------- |
| `VARCHAR(x)`         | `@db.VarChar(x)`               |
| `TEXT`               | `@db.Text`                     |
| `CHAR(x)`            | `@db.Char(x)`                  |
| `TINYTEXT`           | `@db.TinyText`                 |
| `MEDIUMTEXT`         | `@db.MediumText`               |
| `LONGTEXT`           | `@db.LongText`                 |

You can use Prisma Migrate to map `@db.Bit(1)` to `String`:

```prisma
model Model {
  /* ... */
  myField String @db.Bit(1)
}
```

MongoDB [#mongodb]

`String`

| Native database type attribute | Notes                                                                             |
| :----------------------------- | :-------------------------------------------------------------------------------- |
| `@db.String`                   |                                                                                   |
| `@db.ObjectId`                 | Required if the underlying BSON type is `OBJECT_ID` (ID fields, relation scalars) |

Microsoft SQL Server [#microsoft-sql-server]

| Native database type | Native database type attribute |
| :------------------- | :----------------------------- |
| `char(x)`            | `@db.Char(x)`                  |
| `nchar(x)`           | `@db.NChar(x)`                 |
| `varchar(x)`         | `@db.VarChar(x)`               |
| `nvarchar(x)`        | `@db.NVarChar(x)`              |
| `text`               | `@db.Text`                     |
| `ntext`              | `@db.NText`                    |
| `xml`                | `@db.Xml`                      |
| `uniqueidentifier`   | `@db.UniqueIdentifier`         |

SQLite [#sqlite]

`TEXT`

CockroachDB [#cockroachdb]

| Native database type                     | Native database type attribute | Notes |
| :--------------------------------------- | :----------------------------- | ----- |
| `STRING(x)` \| `TEXT(x)` \| `VARCHAR(x)` | `@db.String(x)`                |       |
| `CHAR(x)`                                | `@db.Char(x)`                  |       |
| `"char"`                                 | `@db.CatalogSingleChar`        |       |
| `BIT(x)`                                 | `@db.Bit(x)`                   |       |
| `VARBIT`                                 | `@db.VarBit`                   |       |
| `UUID`                                   | `@db.Uuid`                     |       |
| `INET`                                   | `@db.Inet`                     |       |

Note that the `xml` and `citext` types supported in PostgreSQL are not currently supported in CockroachDB.

Clients [#clients]

| Prisma Client JS |
| ---------------- |
| `string`         |

Boolean [#boolean]

True or false value.

Default type mappings [#default-type-mappings-1]

| Connector   | Default mapping |
| ----------- | --------------- |
| PostgreSQL  | `boolean`       |
| SQL Server  | `bit`           |
| MySQL       | `TINYINT(1)`    |
| MongoDB     | `Bool`          |
| SQLite      | `INTEGER`       |
| CockroachDB | `BOOL`          |

PostgreSQL [#postgresql-1]

| Native database types | Native database type attribute | Notes |
| :-------------------- | :----------------------------- | ----- |
| `boolean`             | `@db.Boolean`                  |       |

MySQL [#mysql-1]

| Native database types | Native database type attribute | Notes                                                                                                                                                     |
| --------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TINYINT(1)`          | `@db.TinyInt(1)`               | `TINYINT` maps to `Int` if the max length is greater than 1 (for example, `TINYINT(2)`) *or* the default value is anything other than `1`, `0`, or `NULL` |
| `BIT(1)`              | `@db.Bit`                      |                                                                                                                                                           |

MongoDB [#mongodb-1]

`Bool`

Microsoft SQL Server [#microsoft-sql-server-1]

| Native database types | Native database type attribute | Notes |
| :-------------------- | :----------------------------- | ----- |
| `bit`                 | `@db.Bit`                      |       |

SQLite [#sqlite-1]

`INTEGER`

CockroachDB [#cockroachdb-1]

| Native database types | Native database type attribute | Notes |
| :-------------------- | :----------------------------- | ----- |
| `BOOL`                | `@db.Bool`                     |       |

Clients [#clients-1]

| Prisma Client JS |
| ---------------- |
| `boolean`        |

Int [#int]

Default type mappings [#default-type-mappings-2]

| Connector   | Default mapping |
| ----------- | --------------- |
| PostgreSQL  | `integer`       |
| SQL Server  | `int`           |
| MySQL       | `INT`           |
| MongoDB     | `Int`           |
| SQLite      | `INTEGER`       |
| CockroachDB | `INT`           |

PostgreSQL [#postgresql-2]

| Native database types      | Native database type attribute           | Notes |
| -------------------------- | ---------------------------------------- | ----- |
| `integer` \| `int`, `int4` | `@db.Integer`                            |       |
| `smallint` \| `int2`       | `@db.SmallInt`                           |       |
| `smallserial` \| `serial2` | `@db.SmallInt @default(autoincrement())` |       |
| `serial` \| `serial4`      | `@db.Int @default(autoincrement())`      |       |
| `oid`                      | `@db.Oid`                                |       |

MySQL [#mysql-2]

| Native database types | Native database type attribute | Notes                                                                                                                                                                                      |
| :-------------------- | :----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INT`                 | `@db.Int`                      |                                                                                                                                                                                            |
| `INT UNSIGNED`        | `@db.UnsignedInt`              |                                                                                                                                                                                            |
| `SMALLINT`            | `@db.SmallInt`                 |                                                                                                                                                                                            |
| `SMALLINT UNSIGNED`   | `@db.UnsignedSmallInt`         |                                                                                                                                                                                            |
| `MEDIUMINT`           | `@db.MediumInt`                |                                                                                                                                                                                            |
| `MEDIUMINT UNSIGNED`  | `@db.UnsignedMediumInt`        |                                                                                                                                                                                            |
| `TINYINT`             | `@db.TinyInt`                  | `TINYINT` maps to `Int` if the max length is greater than 1 (for example, `TINYINT(2)`) *or* the default value is anything other than `1`, `0`, or `NULL`. `TINYINT(1)` maps to `Boolean`. |
| `TINYINT UNSIGNED`    | `@db.UnsignedTinyInt`          | `TINYINT(1) UNSIGNED` maps to `Int`, not `Boolean`                                                                                                                                         |
| `YEAR`                | `@db.Year`                     |                                                                                                                                                                                            |

MongoDB [#mongodb-2]

`Int`

| Native database type attribute | Notes |
| :----------------------------- | :---- |
| `@db.Int`                      |       |
| `@db.Long`                     |       |

Microsoft SQL Server [#microsoft-sql-server-2]

| Native database types | Native database type attribute | Notes |
| --------------------- | ------------------------------ | ----- |
| `int`                 | `@db.Int`                      |       |
| `smallint`            | `@db.SmallInt`                 |       |
| `tinyint`             | `@db.TinyInt`                  |       |
| `bit`                 | `@db.Bit`                      |       |

SQLite [#sqlite-2]

`INTEGER`

CockroachDB [#cockroachdb-2]

| Native database types        | Native database type attribute       | Notes                                                                                                             |
| ---------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `INTEGER` \| `INT` \| `INT8` | `@db.Int8`                           | Note that this differs from PostgreSQL, where `integer` and `int` are aliases for `int4` and map to `@db.Integer` |
| `INT4`                       | `@db.Int4`                           |                                                                                                                   |
| `INT2` \| `SMALLINT`         | `@db.Int2`                           |                                                                                                                   |
| `SMALLSERIAL` \| `SERIAL2`   | `@db.Int2 @default(autoincrement())` |                                                                                                                   |
| `SERIAL` \| `SERIAL4`        | `@db.Int4 @default(autoincrement())` |                                                                                                                   |
| `SERIAL8` \| `BIGSERIAL`     | `@db.Int8 @default(autoincrement())` |                                                                                                                   |

Clients [#clients-2]

| Prisma Client JS |
| ---------------- |
| `number`         |

BigInt [#bigint]

Default type mappings [#default-type-mappings-3]

| Connector   | Default mapping |
| ----------- | --------------- |
| PostgreSQL  | `bigint`        |
| SQL Server  | `int`           |
| MySQL       | `BIGINT`        |
| MongoDB     | `Long`          |
| SQLite      | `INTEGER`       |
| CockroachDB | `INTEGER`       |

PostgreSQL [#postgresql-3]

| Native database types    | Native database type attribute         | Notes |
| ------------------------ | -------------------------------------- | ----- |
| `bigint` \| `int8`       | `@db.BigInt`                           |       |
| `bigserial` \| `serial8` | `@db.BigInt @default(autoincrement())` |       |

MySQL [#mysql-3]

| Native database types | Native database type attribute                 | Notes |
| --------------------- | ---------------------------------------------- | ----- |
| `BIGINT`              | `@db.BigInt`                                   |       |
| `SERIAL`              | `@db.UnsignedBigInt @default(autoincrement())` |       |

MongoDB [#mongodb-3]

`Long`

Microsoft SQL Server [#microsoft-sql-server-3]

| Native database types | Native database type attribute | Notes |
| --------------------- | ------------------------------ | ----- |
| `bigint`              | `@db.BigInt`                   |       |

SQLite [#sqlite-3]

`INTEGER`

CockroachDB [#cockroachdb-3]

| Native database types       | Native database type attribute       | Notes                                                                      |
| --------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `BIGINT` \| `INT` \| `INT8` | `@db.Int8`                           | Note that this differs from PostgreSQL, where `int` is an alias for `int4` |
| `bigserial` \| `serial8`    | `@db.Int8 @default(autoincrement())` |                                                                            |

Clients [#clients-3]

| Client           | Type                                                                                                | Description                                                                                              |
| :--------------- | :-------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| Prisma Client JS | [`BigInt`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) | See [examples of working with `BigInt`](/orm/prisma-client/special-fields-and-types#working-with-bigint) |

Float [#float]

Floating point number.

Default type mappings [#default-type-mappings-4]

| Connector   | Default mapping    |
| ----------- | ------------------ |
| PostgreSQL  | `double precision` |
| SQL Server  | `float(53)`        |
| MySQL       | `DOUBLE`           |
| MongoDB     | `Double`           |
| SQLite      | `REAL`             |
| CockroachDB | `DOUBLE PRECISION` |

PostgreSQL [#postgresql-4]

| Native database types | Native database type attribute | Notes |
| --------------------- | ------------------------------ | ----- |
| `double precision`    | `@db.DoublePrecision`          |       |
| `real`                | `@db.Real`                     |       |

MySQL [#mysql-4]

| Native database types | Native database type attribute | Notes |
| --------------------- | ------------------------------ | ----- |
| `FLOAT`               | `@db.Float`                    |       |
| `DOUBLE`              | `@db.Double`                   |       |

MongoDB [#mongodb-4]

`Double`

Microsoft SQL Server [#microsoft-sql-server-4]

| Native database types | Native database type attribute |
| --------------------- | ------------------------------ |
| `float`               | `@db.Float`                    |
| `money`               | `@db.Money`                    |
| `smallmoney`          | `@db.SmallMoney`               |
| `real`                | `@db.Real`                     |

SQLite connector [#sqlite-connector]

`REAL`

CockroachDB [#cockroachdb-4]

| Native database types          | Native database type attribute | Notes |
| ------------------------------ | ------------------------------ | ----- |
| `DOUBLE PRECISION` \| `FLOAT8` | `@db.Float8`                   |       |
| `REAL` \| `FLOAT4` \| `FLOAT`  | `@db.Float4`                   |       |

Clients [#clients-4]

| Prisma Client JS |
| ---------------- |
| `number`         |

Decimal [#decimal]

Default type mappings [#default-type-mappings-5]

| Connector   | Default mapping                                                |
| ----------- | -------------------------------------------------------------- |
| PostgreSQL  | `decimal(65,30)`                                               |
| SQL Server  | `decimal(32,16)`                                               |
| MySQL       | `DECIMAL(65,30)`                                               |
| MongoDB     | [Not supported](https://github.com/prisma/prisma/issues/12637) |
| SQLite      | `DECIMAL`                                                      |
| CockroachDB | `DECIMAL`                                                      |

PostgreSQL [#postgresql-5]

| Native database types  | Native database type attribute | Notes |
| ---------------------- | ------------------------------ | ----- |
| `decimal` \| `numeric` | `@db.Decimal(p, s)`†           |       |
| `money`                | `@db.Money`                    |       |

* † `p` (precision), the maximum total number of decimal digits to be stored. `s` (scale), the number of decimal digits that are stored to the right of the decimal point.

MySQL [#mysql-5]

| Native database types  | Native database type attribute | Notes |
| ---------------------- | ------------------------------ | ----- |
| `DECIMAL` \| `NUMERIC` | `@db.Decimal(p, s)`†           |       |

* † `p` (precision), the maximum total number of decimal digits to be stored. `s` (scale), the number of decimal digits that are stored to the right of the decimal point.

MongoDB [#mongodb-5]

[Not supported](https://github.com/prisma/prisma/issues/12637).

Microsoft SQL Server [#microsoft-sql-server-5]

| Native database types  | Native database type attribute | Notes |
| ---------------------- | ------------------------------ | ----- |
| `decimal` \| `numeric` | `@db.Decimal(p, s)`†           |       |

* † `p` (precision), the maximum total number of decimal digits to be stored. `s` (scale), the number of decimal digits that are stored to the right of the decimal point.

SQLite [#sqlite-4]

`DECIMAL` (changed from `REAL` in 2.17.0)

CockroachDB [#cockroachdb-5]

| Native database types           | Native database type attribute | Notes                                                         |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| `DECIMAL` \| `DEC` \| `NUMERIC` | `@db.Decimal(p, s)`†           |                                                               |
| `money`                         | Not yet                        | PostgreSQL's `money` type is not yet supported by CockroachDB |

* † `p` (precision), the maximum total number of decimal digits to be stored. `s` (scale), the number of decimal digits that are stored to the right of the decimal point.

Clients [#clients-5]

| Client           | Type                                               | Description                                                                                                |
| :--------------- | :------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| Prisma Client JS | [`Decimal`](https://mikemcl.github.io/decimal.js/) | See [examples of working with `Decimal`](/orm/prisma-client/special-fields-and-types#working-with-decimal) |

DateTime [#datetime]

Remarks [#remarks-3]

* Prisma Client returns all `DateTime` as native [`Date`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date) objects.
* Currently, Prisma ORM [does not support](https://github.com/prisma/prisma/issues/5006) [zero dates](https://dev.mysql.com/doc/refman/8.3/en/date-and-time-types.html#:~\:text=The%20following%20table%20shows%20the%20format%20of%20the%20%E2%80%9Czero%E2%80%9D%20value%20for%20each%20type) (`0000-00-00 00:00:00`, `0000-00-00`, `00:00:00`) in MySQL.
* There currently is a [bug](https://github.com/prisma/prisma/issues/9516) that doesn't allow you to pass in `DateTime` values as strings and produces a runtime error when you do. `DateTime` values need to be passed as [`Date`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date) objects (i.e. `new Date('2024-12-04')` instead of `'2024-12-04'`).

You can find more info and examples in this section: [Working with `DateTime`](/orm/prisma-client/special-fields-and-types#working-with-datetime).

Default type mappings [#default-type-mappings-6]

| Connector   | Default mapping |
| ----------- | --------------- |
| PostgreSQL  | `timestamp(3)`  |
| SQL Server  | `datetime2`     |
| MySQL       | `DATETIME(3)`   |
| MongoDB     | `Timestamp`     |
| SQLite      | `NUMERIC`       |
| CockroachDB | `TIMESTAMP`     |

PostgreSQL [#postgresql-6]

| Native database types | Native database type attribute | Notes |
| --------------------- | ------------------------------ | ----- |
| `timestamp(x)`        | `@db.Timestamp(x)`             |       |
| `timestamptz(x)`      | `@db.Timestamptz(x)`           |       |
| `date`                | `@db.Date`                     |       |
| `time(x)`             | `@db.Time(x)`                  |       |
| `timetz(x)`           | `@db.Timetz(x)`                |       |

MySQL [#mysql-6]

| Native database types | Native database type attribute | Notes |
| --------------------- | ------------------------------ | ----- |
| `DATETIME(x)`         | `@db.DateTime(x)`              |       |
| `DATE(x)`             | `@db.Date(x)`                  |       |
| `TIME(x)`             | `@db.Time(x)`                  |       |
| `TIMESTAMP(x)`        | `@db.Timestamp(x)`             |       |

You can also use MySQL's `YEAR` type with `Int`:

```prisma
yearField     Int    @db.Year
```

MongoDB [#mongodb-6]

`Timestamp`

Microsoft SQL Server [#microsoft-sql-server-6]

| Native database types | Native database type attribute | Notes |
| --------------------- | ------------------------------ | ----- |
| `date`                | `@db.Date`                     |       |
| `time`                | `@db.Time`                     |       |
| `datetime`            | `@db.DateTime`                 |       |
| `datetime2`           | `@db.DateTime2`                |       |
| `smalldatetime`       | `@db.SmallDateTime`            |       |
| `datetimeoffset`      | `@db.DateTimeOffset`           |       |

SQLite [#sqlite-5]

`NUMERIC` or `STRING`. If the underlying data type is `STRING`, you must use one of the following formats:

* [RFC 3339](https://www.ietf.org/rfc/rfc3339.txt) (`1996-12-19T16:39:57-08:00`)
* [RFC 2822](https://datatracker.ietf.org/doc/html/rfc2822#section-3.3) (`Tue, 1 Jul 2003 10:52:37 +0200`)

CockroachDB [#cockroachdb-6]

| Native database types | Native database type attribute | Notes |
| --------------------- | ------------------------------ | ----- |
| `TIMESTAMP(x)`        | `@db.Timestamp(x)`             |       |
| `TIMESTAMPTZ(x)`      | `@db.Timestamptz(x)`           |       |
| `DATE`                | `@db.Date`                     |       |
| `TIME(x)`             | `@db.Time(x)`                  |       |
| `TIMETZ(x)`           | `@db.Timetz(x)`                |       |

Clients [#clients-6]

| Prisma Client JS |
| ---------------- |
| `Date`           |

Json [#json]

A JSON object.

Default type mappings [#default-type-mappings-7]

| Connector   | Default mapping                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| PostgreSQL  | `jsonb`                                                                                                      |
| SQL Server  | [Not supported](https://github.com/prisma/prisma/issues/7417)                                                |
| MySQL       | `JSON`                                                                                                       |
| MongoDB     | [A valid `BSON` object (Relaxed mode)](https://www.mongodb.com/docs/manual/reference/mongodb-extended-json/) |
| SQLite      | `JSONB`                                                                                                      |
| CockroachDB | `JSONB`                                                                                                      |

PostgreSQL [#postgresql-7]

| Native database types | Native database type attribute | Notes |
| --------------------- | ------------------------------ | ----- |
| `json`                | `@db.Json`                     |       |
| `jsonb`               | `@db.JsonB`                    |       |

MySQL [#mysql-7]

| Native database types | Native database type attribute | Notes |
| --------------------- | ------------------------------ | ----- |
| `JSON`                | `@db.Json`                     |       |

MongoDB [#mongodb-7]

[A valid `BSON` object (Relaxed mode)](https://www.mongodb.com/docs/manual/reference/mongodb-extended-json/)

Microsoft SQL Server [#microsoft-sql-server-7]

Microsoft SQL Server does not have a specific data type for JSON. However, there are a number of [built-in functions for reading and modifying JSON](https://learn.microsoft.com/en-us/sql/relational-databases/json/json-data-sql-server?view=sql-server-ver15#extract-values-from-json-text-and-use-them-in-queries).

SQLite [#sqlite-6]

Not supported

CockroachDB [#cockroachdb-7]

| Native database types | Native database type attribute | Notes |
| --------------------- | ------------------------------ | ----- |
| `JSON` \| `JSONB`     | `@db.JsonB`                    |       |

Clients [#clients-7]

| Prisma Client JS |
| ---------------- |
| `object`         |

Bytes [#bytes]

Default type mappings [#default-type-mappings-8]

| Connector   | Default mapping |
| ----------- | --------------- |
| PostgreSQL  | `bytea`         |
| SQL Server  | `varbinary`     |
| MySQL       | `LONGBLOB`      |
| MongoDB     | `BinData`       |
| SQLite      | `BLOB`          |
| CockroachDB | `BYTES`         |

PostgreSQL [#postgresql-8]

| Native database types | Native database type attribute |
| --------------------- | ------------------------------ |
| `bytea`               | `@db.ByteA`                    |

MySQL [#mysql-8]

| Native database types | Native database type attribute | Notes |
| --------------------- | ------------------------------ | ----- |
| `LONGBLOB`            | `@db.LongBlob`                 |       |
| `BINARY`              | `@db.Binary`                   |       |
| `VARBINARY`           | `@db.VarBinary`                |       |
| `TINYBLOB`            | `@db.TinyBlob`                 |       |
| `BLOB`                | `@db.Blob`                     |       |
| `MEDIUMBLOB`          | `@db.MediumBlob`               |       |
| `BIT`                 | `@db.Bit`                      |       |

MongoDB [#mongodb-8]

`BinData`

| Native database type attribute | Notes                                                                             |
| :----------------------------- | :-------------------------------------------------------------------------------- |
| `@db.ObjectId`                 | Required if the underlying BSON type is `OBJECT_ID` (ID fields, relation scalars) |
| `@db.BinData`                  |                                                                                   |

Microsoft SQL Server [#microsoft-sql-server-8]

| Native database types | Native database type attribute | Notes |
| --------------------- | ------------------------------ | ----- |
| `binary`              | `@db.Binary`                   |       |
| `varbinary`           | `@db.VarBinary`                |       |
| `image`               | `@db.Image`                    |       |

SQLite [#sqlite-7]

`BLOB`

CockroachDB [#cockroachdb-8]

| Native database types        | Native database type attribute |
| ---------------------------- | ------------------------------ |
| `BYTES` \| `BYTEA` \| `BLOB` | `@db.Bytes`                    |

Clients [#clients-8]

| Client                                                        | Type                                                                                                        | Description                                                                                            |
| :------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| Prisma Client JS                                              | [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) | See [examples of working with `Bytes`](/orm/prisma-client/special-fields-and-types#working-with-bytes) |
| Prisma Client JS ([before v6](/guides/upgrade-prisma-orm/v6)) | [`Buffer`](https://nodejs.org/api/buffer.html)                                                              | See [examples of working with `Bytes`](/orm/prisma-client/special-fields-and-types#working-with-bytes) |

Unsupported [#unsupported]

<CalloutContainer type="warning">
  <CalloutDescription>
    **Not supported by MongoDB** <br />
    The [MongoDB connector](/orm/core-concepts/supported-databases/mongodb) does not support the `Unsupported` type.
  </CalloutDescription>
</CalloutContainer>

The `Unsupported` type was introduced in [2.17.0](https://github.com/prisma/prisma/releases/tag/2.17.0) and allows you to represent data types in the Prisma schema that are not supported by Prisma Client. Fields of type `Unsupported` can be created during Introspection with `prisma db pull` or written by hand, and created in the database with Prisma Migrate or `db push`.

Remarks [#remarks-4]

* Fields with `Unsupported` types are not available in the generated client.
* If a model contains a **required** `Unsupported` type, `prisma.model.create(..)`, `prisma.model.update(...)` and `prisma.model.upsert(...)` are not available in Prisma Client.
* When you introspect a database that contains unsupported types, Prisma ORM will provide the following warning:

  ```
  *** WARNING ***

  These fields are not supported by Prisma Client, because Prisma does not currently support their types.
  * Model "Post", field: "circle", original data type: "circle"
  ```

Examples [#examples-3]

```prisma
model Star {
  id       Int                    @id @default(autoincrement())
  position Unsupported("circle")?
  example1 Unsupported("circle")
  circle   Unsupported("circle")? @default(dbgenerated("'<(10,4),11>'::circle"))
}
```

model field type modifiers [#model-field-type-modifiers]

[] modifier [#-modifier]

Makes a field a list.

Remarks [#remarks-5]

* Cannot be optional (for example `Post[]?`).

Relational databases [#relational-databases]

* Scalar lists (arrays) are only supported in the data model if your database natively supports them. Currently, scalar lists are therefore only supported when using PostgreSQL or CockroachDB (since MySQL and SQLite don't natively support scalar lists).

MongoDB [#mongodb-9]

* Scalar lists are supported

Examples [#examples-4]

Define a scalar list [#define-a-scalar-list]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma highlight=3;normal
    model User {
      id             Int      @id @default(autoincrement())
      favoriteColors String[] // [!code highlight]
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma highlight=3;normal
    model User {
      id             String   @id @default(auto()) @map("_id") @db.ObjectId
      favoriteColors String[] // [!code highlight]
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Define a scalar list with a default value [#define-a-scalar-list-with-a-default-value]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma highlight=3;normal
    model User {
      id             Int      @id @default(autoincrement())
      favoriteColors String[] @default(["red", "blue", "green"]) // [!code highlight]
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma highlight=3;normal
    model User {
      id             String   @id @default(auto()) @map("_id") @db.ObjectId
      favoriteColors String[] @default(["red", "blue", "green"]) // [!code highlight]
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

? modifier [#-modifier-1]

Makes a field optional.

Remarks [#remarks-6]

* Cannot be used with a list field (for example, `Posts[]`)

Examples [#examples-5]

Optional name field [#optional-name-field]

```prisma highlight=3;normal
model User {
  id   Int     @id @default(autoincrement())
  name String? // [!code highlight]
}
```

Attributes [#attributes]

Attributes modify the behavior of a [field](#model-fields) or block (e.g. [models](#model)). There are two ways to add attributes to your data model:

* *Field* attributes are prefixed with `@`
* *Block* attributes are prefixed with `@@`

Some attributes take arguments. Arguments in attributes are always named, but in most cases the argument *name* can be omitted.

> **Note**: The leading underscore in a signature means the *argument name* can be omitted.

@id [#id]

Defines a single-field ID on the model.

Remarks [#remarks-7]

General [#general]

* Cannot be defined on a relation field
* Cannot be optional

Relational databases [#relational-databases-1]

* Corresponding database construct: `PRIMARY KEY`

* Can be annotated with a [`@default`](#default) attribute that uses [functions](#attribute-functions) to auto-generate an ID:
  * [`autoincrement()`](#autoincrement)
  * [`cuid()`](#cuid)
  * [`uuid()`](#uuid)
  * [`ulid()`](#ulid)

* Can be defined on any scalar field (`String`, `Int`, `enum`)

MongoDB [#mongodb-10]

* Corresponding database construct: [Any valid BSON type, except arrays](https://www.mongodb.com/docs/manual/core/document/#the-_id-field)

* Every model must define an `@id` field

* The [underlying ID field name is always `_id`](https://www.mongodb.com/docs/manual/core/document/#the-_id-field), and must be mapped with `@map("_id")`

* Can be defined on any scalar field (`String`, `Int`, `enum`) unless you want to use `ObjectId` in your database

* To use an [`ObjectId`](https://www.mongodb.com/docs/manual/reference/method/ObjectId/) as your ID, you must:
  * Use the `String` or `Bytes` field type

  * Annotate your field with `@db.ObjectId`:

    ```prisma
    id   String  @db.ObjectId  @map("_id")
    ```

  * Optionally, annotate your field with a [`@default`](#default) attribute that uses [the `auto()` function](#auto) to auto-generate an `ObjectId`

    ```prisma
    id   String  @db.ObjectId  @map("_id") @default(auto())
    ```

* [`cuid()`](#cuid), [`uuid()`](#uuid) and [`ulid()`](#ulid) are supported but do not generate a valid `ObjectId` - use `auto()` instead for `@id`

* `autoincrement()` is **not supported**

Arguments [#arguments]

| Name        | Required | Type      | Description                                                                                                                                                   |
| ----------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `map`       | **No**   | `String`  | The name of the underlying primary key constraint in the database.<br /><br /> Not supported for MySQL or MongoDB.                                            |
| `length`    | **No**   | `number`  | Allows you to specify a maximum length for the subpart of the value to be indexed.<br /><br />MySQL only.                                                     |
| `sort`      | **No**   | `String`  | Allows you to specify in what order the entries of the ID are stored in the database. The available options are `Asc` and `Desc`.<br /><br />SQL Server only. |
| `clustered` | **No**   | `Boolean` | Defines whether the ID is clustered or non-clustered. Defaults to `true`. <br /><br />SQL Server only.                                                        |

Signature [#signature]

```prisma no-lines
@id(map: String?, length: number?, sort: String?, clustered: Boolean?)
```

Examples [#examples-6]

In most cases, you want your database to create the ID. To do this, annotate the ID field with the `@default` attribute and initialize the field with a [function](#attribute-functions).

Generate autoincrementing integers as IDs (Relational databases only) [#generate-autoincrementing-integers-as-ids-relational-databases-only]

```prisma
model User {
  id   Int    @id @default(autoincrement())
  name String
}
```

Generate ObjectId as IDs (MongoDB only) [#generate-objectid-as-ids-mongodb-only]

```prisma
model User {
  id   String @id @default(auto()) @map("_id") @db.ObjectId
  name String
}
```

Generate cuid() values as IDs [#generate-cuid-values-as-ids]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id   String @id @default(cuid())
      name String
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id   String @id @default(cuid()) @map("_id")
      name String
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

<CalloutContainer type="warning">
  <CalloutDescription>
    You cannot use `cuid()` to generate a default value if your `id` field is of type `ObjectId`. Use the following syntax to generate a valid `ObjectId`:

    ```prisma
    id    String  @id @default(auto()) @db.ObjectId @map("_id")
    ```
  </CalloutDescription>
</CalloutContainer>

Generate uuid() values as IDs [#generate-uuid-values-as-ids]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id   String @id @default(uuid())
      name String
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id   String @id @default(uuid()) @map("_id")
      name String
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

<CalloutContainer type="warning">
  <CalloutDescription>
    You cannot use `uuid()` to generate a default value if your `id` field is of type `ObjectId`. Use the following syntax to generate a valid `ObjectId`:

    ```prisma
    id    String  @id @default(auto()) @db.ObjectId @map("_id")
    ```
  </CalloutDescription>
</CalloutContainer>

Generate ulid() values as IDs [#generate-ulid-values-as-ids]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id   String @id @default(ulid())
      name String
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id   String @id @default(ulid()) @map("_id")
      name String
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

<CalloutContainer type="warning">
  <CalloutDescription>
    You cannot use `ulid()` to generate a default value if your `id` field is of type `ObjectId`. Use the following syntax to generate a valid `ObjectId`:

    ```prisma
    id    String  @id @default(auto()) @db.ObjectId @map("_id")
    ```
  </CalloutDescription>
</CalloutContainer>

Single-field IDs without default values [#single-field-ids-without-default-values]

In the following example, `id` does not have a default value:

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id   String @id
      name String
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
    id    String   @id  @map("_id") @db.ObjectId
    name  String
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

```prisma
model User {
id    String   @id  @map("_id")
name  String
}
```

Note that in the above case, you *must* provide your own ID values when creating new records for the `User` model using Prisma Client, e.g.:

```ts
const newUser = await prisma.user.create({
  data: {
    id: 1,
    name: "Alice",
  },
});
```

Specify an ID on relation scalar field without a default value [#specify-an-id-on-relation-scalar-field-without-a-default-value]

In the following example, `authorId` is a both a relation scalar and the ID of `Profile`:

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model Profile {
      authorId Int    @id
      author   User   @relation(fields: [authorId], references: [id])
      bio      String
    }

    model User {
      id      Int      @id
      email   String   @unique
      name    String?
      profile Profile?
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model Profile {
      authorId String @id @map("_id") @db.ObjectId
      author   User   @relation(fields: [authorId], references: [id])
      bio      String
    }

    model User {
      id      String   @id @map("_id") @db.ObjectId
      email   String   @unique
      name    String?
      profile Profile?
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

In this scenario, you cannot create a `Profile` only - you must use Prisma Client's [nested writes](/orm/prisma-client/queries/relation-queries#nested-writes) create a `User` **or** connect the profile to an existing user.

The following example creates a user and a profile:

```ts
const userWithProfile = await prisma.user.create({
  data: {
    id: 3,
    email: "bob@prisma.io",
    name: "Bob Prismo",
    profile: {
      create: {
        bio: "Hello, I'm Bob Prismo and I love apples, blue nail varnish, and the sound of buzzing mosquitoes.",
      },
    },
  },
});
```

The following example connects a new profile to a user:

```ts
const profileWithUser = await prisma.profile.create({
  data: {
    bio: "Hello, I'm Bob and I like nothing at all. Just nothing.",
    author: {
      connect: {
        id: 22,
      },
    },
  },
});
```

@@id [#id-1]

<CalloutContainer type="warning">
  <CalloutDescription>
    **Not supported by MongoDB** <br />
    The [MongoDB connector](/orm/core-concepts/supported-databases/mongodb) does not support composite IDs.
  </CalloutDescription>
</CalloutContainer>

Defines a multi-field ID (composite ID) on the model.

Remarks [#remarks-8]

* Corresponding database type: `PRIMARY KEY`
* Can be annotated with a [`@default`](#default) attribute that uses [functions](#attribute-functions) to auto-generate an ID
* Cannot be optional
* Can be defined on any scalar field (`String`, `Int`, `enum`)
* Cannot be defined on a relation field
* The name of the composite ID field in Prisma Client has the following pattern: `field1_field2_field3`

Arguments [#arguments-1]

| Name        | Required | Type               | Description                                                                                                                                                   |
| ----------- | -------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields`    | **Yes**  | `FieldReference[]` | A list of field names - for example, `["firstname", "lastname"]`                                                                                              |
| `name`      | **No**   | `String`           | The name that Prisma Client will expose for the argument covering all fields, e.g. `fullName` in `fullName: { firstName: "First", lastName: "Last"}`          |
| `map`       | **No**   | `String`           | The name of the underlying primary key constraint in the database.<br /><br />Not supported for MySQL.                                                        |
| `length`    | **No**   | `number`           | Allows you to specify a maximum length for the subpart of the value to be indexed.<br /><br />MySQL only.                                                     |
| `sort`      | **No**   | `String`           | Allows you to specify in what order the entries of the ID are stored in the database. The available options are `Asc` and `Desc`.<br /><br />SQL Server only. |
| `clustered` | **No**   | `Boolean`          | Defines whether the ID is clustered or non-clustered. Defaults to `true`.<br /><br />SQL Server only.                                                         |

The name of the `fields` argument on the `@@id` attribute can be omitted:

```prisma no-lines
@@id(fields: [title, author])
@@id([title, author])
```

Signature [#signature-1]

```prisma no-lines
@@id(_ fields: FieldReference[], name: String?, map: String?)
```

Examples [#examples-7]

Specify a multi-field ID on two String fields (Relational databases only) [#specify-a-multi-field-id-on-two-string-fields-relational-databases-only]

```prisma
model User {
  firstName String
  lastName  String
  email     String  @unique
  isAdmin   Boolean @default(false)

  @@id([firstName, lastName])
}
```

When you create a user, you must provide a unique combination of `firstName` and `lastName`:

```ts
const user = await prisma.user.create({
  data: {
    firstName: "Alice",
    lastName: "Smith",
  },
});
```

To retrieve a user, use the generated composite ID field (`firstName_lastName`):

```ts
const user = await prisma.user.findUnique({
  where: {
    firstName_lastName: {
      firstName: "Alice",
      lastName: "Smith",
    },
  },
});
```

Specify a multi-field ID on two String fields and one Boolean field (Relational databases only) [#specify-a-multi-field-id-on-two-string-fields-and-one-boolean-field-relational-databases-only]

```prisma
model User {
  firstName String
  lastName  String
  email     String  @unique
  isAdmin   Boolean @default(false)

  @@id([firstName, lastName, isAdmin])
}
```

When creating new `User` records, you now must provide a unique combination of values for `firstName`, `lastName` and `isAdmin`:

```ts
const user = await prisma.user.create({
  data: {
    firstName: "Alice",
    lastName: "Smith",
    isAdmin: true,
  },
});
```

Specify a multi-field ID that includes a relation field (Relational databases only) [#specify-a-multi-field-id-that-includes-a-relation-field-relational-databases-only]

```prisma
model Post {
  title     String
  published Boolean @default(false)
  author    User    @relation(fields: [authorId], references: [id])
  authorId  Int

  @@id([authorId, title])
}

model User {
  id    Int     @default(autoincrement())
  email String  @unique
  name  String?
  posts Post[]
}
```

When creating new `Post` records, you now must provide a unique combination of values for `authorId` (foreign key) and `title`:

```ts
const post = await prisma.post.create({
  data: {
    title: "Hello World",
    author: {
      connect: {
        email: "alice@prisma.io",
      },
    },
  },
});
```

@default [#default]

Defines a [default value for a field](/orm/prisma-schema/data-model/models#defining-a-default-value).

Remarks [#remarks-9]

* Default values that cannot yet be represented in the Prisma schema are represented by the [`dbgenerated()` function](#dbgenerated) when you use [introspection](/orm/prisma-schema/introspection).
* Default values are not allowed on relation fields in the Prisma schema. Note however that you can still define default values on the fields backing a relation (the ones listed in the `fields` argument in the `@relation` attribute). A default value on the field backing a relation will mean that relation is populated automatically for you.
* Default values can be used with [scalar lists](/orm/prisma-client/special-fields-and-types/working-with-scalar-lists-arrays) in databases that natively support them.

Relational databases [#relational-databases-2]

* Corresponding database construct: `DEFAULT`
* Default values can be a static value (`4`, `"hello"`) or one of the following [functions](#attribute-functions):
  * [`autoincrement()`](#autoincrement)
  * [`sequence()`](#sequence) (CockroachDB only)
  * [`dbgenerated(...)`](#dbgenerated)
  * [`cuid()`](#cuid)
  * [`cuid(2)`](#cuid)
  * [`uuid()`](#uuid)
  * [`uuid(4)`](#uuid)
  * [`uuid(7)`](#uuid)
  * [`ulid()`](#ulid)
  * [`nanoid()`](#nanoid)
  * [`now()`](#now)
* Default values that cannot yet be represented in the Prisma schema are represented by the [`dbgenerated(...)` function](#dbgenerated) when you use [introspection](/orm/prisma-schema/introspection).
* Default values are not allowed on relation fields in the Prisma schema. Note however that you can still define default values on the fields backing a relation (the ones listed in the `fields` argument in the `@relation` attribute). A default value on the field backing a relation will mean that relation is populated automatically for you.
* Default values can be used with [scalar lists](/orm/prisma-client/special-fields-and-types/working-with-scalar-lists-arrays) in databases that natively support them.
* JSON data. Note that JSON needs to be enclosed with double-quotes inside the `@default` attribute, e.g.: `@default("[]")`. If you want to provide a JSON object, you need to enclose it with double-quotes and then escape any internal double quotes using a backslash, e.g.: `@default("{ \"hello\": \"world\" }")`.

MongoDB [#mongodb-11]

* Default values can be a static value (`4`, `"hello"`) or one of the following [functions](#attribute-functions):
  * [`auto()`](#auto) (can only be used with `@db.ObjectId` to generate an `ObjectId` in MongoDB)
  * [`cuid()`](#cuid)
  * [`uuid()`](#uuid)
  * [`ulid()`](#ulid)
  * [`now()`](#now)

Arguments [#arguments-2]

| Name    | Required | Type                                      | Description          |
| ------- | -------- | ----------------------------------------- | -------------------- |
| `value` | **Yes**  | An expression (e.g. `5`, `true`, `now()`) |                      |
| `map`   | **No**   | String                                    | **SQL Server only.** |

The name of the `value` argument on the `@default` attribute can be omitted:

```prisma no-lines
id Int @id @default(value: autoincrement())
id Int @id @default(autoincrement())
```

Signature [#signature-2]

```prisma no-lines
@default(_ value: Expression, map: String?)
```

Examples [#examples-8]

Default value for an Int [#default-value-for-an-int]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      email        String @unique
      profileViews Int    @default(0)
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id           String @default(auto()) @map("_id") @db.ObjectId
      profileViews Int    @default(0)
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Default value for a Float [#default-value-for-a-float]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      email  String @unique
      number Float  @default(1.1)
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id     String @default(auto()) @map("_id") @db.ObjectId
      number Float  @default(1.1)
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Default value for Decimal [#default-value-for-decimal]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      email  String  @unique
      number Decimal @default(22.99)
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```text
    [Not supported](https://github.com/prisma/prisma/issues/12637).
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Default value for BigInt [#default-value-for-bigint]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      email  String @unique
      number BigInt @default(34534535435353)
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id     String @default(auto()) @map("_id") @db.ObjectId
      number BigInt @default(34534535435353)
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Default value for a String [#default-value-for-a-string]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      email String @unique
      name  String @default("")
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id   String @default(auto()) @map("_id") @db.ObjectId
      name String @default("")
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Default value for a Boolean [#default-value-for-a-boolean]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      email   String  @unique
      isAdmin Boolean @default(false)
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id      String  @default(auto()) @map("_id") @db.ObjectId
      isAdmin Boolean @default(false)
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Default value for a DateTime [#default-value-for-a-datetime]

Note that static default values for `DateTime` are based on the [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) standard.

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      email String   @unique
      data  DateTime @default("2020-03-19T14:21:00+02:00")
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id   String   @default(auto()) @map("_id") @db.ObjectId
      data DateTime @default("2020-03-19T14:21:00+02:00")
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Default value for a Bytes [#default-value-for-a-bytes]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      email  String @unique
      secret Bytes  @default("SGVsbG8gd29ybGQ=")
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id     String @default(auto()) @map("_id") @db.ObjectId
      secret Bytes  @default("SGVsbG8gd29ybGQ=")
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Default value for an enum [#default-value-for-an-enum]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    enum Role {
      USER
      ADMIN
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

```prisma highlight=5;normal
model User {
  id      Int      @id @default(autoincrement())
  email   String   @unique
  name    String?
  role    Role     @default(USER) // [!code highlight]
  posts   Post[]
  profile Profile?
}
```

<CodeBlockTabs defaultValue="MongoDB">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="MongoDB">
    ```prisma
    enum Role {
      USER
      ADMIN
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

```prisma highlight=5;normal
model User {
  id      String   @id @default(auto()) @map("_id") @db.ObjectId
  email   String   @unique
  name    String?
  role    Role     @default(USER) // [!code highlight]
  posts   Post[]
  profile Profile?
}
```

Default values for scalar lists [#default-values-for-scalar-lists]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma highlight=4;normal
    model User {
      id             Int      @id @default(autoincrement())
      posts          Post[]
      favoriteColors String[] @default(["red", "yellow", "purple"]) // [!code highlight]
      roles          Role[]   @default([USER, DEVELOPER])
    }

    enum Role {
      USER
      DEVELOPER
      ADMIN
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma highlight=4;normal
    model User {
      id             String   @id @default(auto()) @map("_id") @db.ObjectId
      posts          Post[]
      favoriteColors String[] @default(["red", "yellow", "purple"]) // [!code highlight]
      roles          Role[]   @default([USER, DEVELOPER])
    }

    enum Role {
      USER
      DEVELOPER
      ADMIN
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

@unique [#unique]

Defines a unique constraint for this field.

Remarks [#remarks-10]

General [#general-1]

* A field annotated with `@unique` can be optional or required
* A field annotated with `@unique` *must* be required if it represents the only unique constraint on a model without an `@id` / `@@id`
* A model can have any number of unique constraints
* Can be defined on any scalar field
* **Cannot** be defined on a relation field

Relational databases [#relational-databases-3]

* Corresponding database construct: `UNIQUE`
* `NULL` values are considered to be distinct (multiple rows with `NULL` values in the same column are allowed)
* Adding a unique constraint automatically adds a corresponding *unique index* to the specified column(s).

MongoDB [#mongodb-12]

* Enforced by a [unique index in MongoDB](https://www.mongodb.com/docs/manual/core/index-unique/)

Arguments [#arguments-3]

| Name        | Required | Type                   | Description                                                                                                                                                                                                                                                                                                                                                |
| ----------- | -------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `map`       | **No**   | `String`               |                                                                                                                                                                                                                                                                                                                                                            |
| `length`    | **No**   | `number`               | Allows you to specify a maximum length for the subpart of the value to be indexed.<br /><br />MySQL only.                                                                                                                                                                                                                                                  |
| `sort`      | **No**   | `String`               | Allows you to specify in what order the entries of the constraint are stored in the database. The available options are `Asc` and `Desc`.                                                                                                                                                                                                                  |
| `clustered` | **No**   | `Boolean`              | Defines whether the constraint is clustered or non-clustered. Defaults to `false`.<br /><br />SQL Server only.                                                                                                                                                                                                                                             |
| `where`     | **No**   | `function` or `object` | Defines a [partial index](/orm/prisma-schema/data-model/indexes#configuring-partial-indexes-with-where) that only includes rows matching the specified condition. Accepts `raw("SQL expression")` or an object literal like `{ field: value }`.<br /><br />PostgreSQL, SQLite, SQL Server, and CockroachDB. Requires the `partialIndexes` Preview feature. |

* ¹ Can be required by some of the index and field types.

Signature [#signature-3]

```prisma no-lines
@unique(map: String?, length: number?, sort: String?, clustered: Boolean?, where: raw(String) | { field: value }?)
```

> **Note**: The `where` argument accepts either `raw("SQL expression")` for raw SQL predicates or an object literal like `{ field: value }` for type-safe conditions. See [Configuring partial indexes](/orm/prisma-schema/data-model/indexes#configuring-partial-indexes-with-where) for details.

> **Note**: Before the `partialIndexes` Preview feature, the signature was:
>
> ```prisma no-lines
> @unique(map: String?, length: number?, sort: String?, clustered: Boolean?)
> ```

Examples [#examples-9]

Specify a unique attribute on a required String field [#specify-a-unique-attribute-on-a-required-string-field]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      email String @unique
      name  String
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id   String @default(auto()) @map("_id") @db.ObjectId
      name String
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Specify a unique attribute on an optional String field [#specify-a-unique-attribute-on-an-optional-string-field]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id    Int     @id @default(autoincrement())
      email String? @unique
      name  String
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id    String  @id @default(auto()) @map("_id") @db.ObjectId
      email String? @unique
      name  String
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Specify a unique attribute on relation scalar field authorId [#specify-a-unique-attribute-on-relation-scalar-field-authorid]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model Post {
      author    User    @relation(fields: [authorId], references: [id])
      authorId  Int     @unique
      title     String
      published Boolean @default(false)
    }

    model User {
      id    Int     @id @default(autoincrement())
      email String? @unique
      name  String
      Post  Post[]
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model Post {
      author    User    @relation(fields: [authorId], references: [id])
      authorId  String  @unique @db.ObjectId
      title     String
      published Boolean @default(false)
    }

    model User {
      id    String  @id @default(auto()) @map("_id") @db.ObjectId
      email String? @unique
      name  String
      Post  Post[]
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Specify a unique attribute with cuid() values as default values [#specify-a-unique-attribute-with-cuid-values-as-default-values]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      token String @unique @default(cuid())
      name  String
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id    String @id @default(auto()) @map("_id") @db.ObjectId
      token String @unique @default(cuid())
      name  String
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

@@unique [#unique-1]

Defines a compound [unique constraint](/orm/prisma-schema/data-model/models#defining-a-unique-field) for the specified fields.

Remarks [#remarks-11]

General [#general-2]

* All fields that make up the unique constraint **must** be mandatory fields. The following model is **not** valid because `id` could be `null`:

  ```prisma
  model User {
    firstname Int
    lastname  Int
    id        Int?

    @@unique([firstname, lastname, id])
  }
  ```

  The reason for this behavior is that all connectors consider `null` values to be distinct, which means that two rows that *look* identical are considered unique:

  ```
   firstname  | lastname | id
   -----------+----------+------
   John       | Smith    | null
   John       | Smith    | null
  ```

* A model can have any number of `@@unique` blocks

Relational databases [#relational-databases-4]

* Corresponding database construct: `UNIQUE`
* A `@@unique` block is required if it represents the only unique constraint on a model without an `@id` / `@@id`
* Adding a unique constraint automatically adds a corresponding *unique index* to the specified column(s)

MongoDB [#mongodb-13]

* Enforced by a [compound index in MongoDB](https://www.mongodb.com/docs/manual/core/index-compound/)
* A `@@unique` block cannot be used as the only unique identifier for a model - MongoDB requires an `@id` field

Arguments [#arguments-4]

| Name        | Required | Type                   | Description                                                                                                                                                                                                                                                                                                                                                |
| ----------- | -------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields`    | **Yes**  | `FieldReference[]`     | A list of field names - for example, `["firstname", "lastname"]`. Fields must be mandatory - see remarks.                                                                                                                                                                                                                                                  |
| `name`      | **No**   | `String`               | The name of the unique combination of fields - defaults to `fieldName1_fieldName2_fieldName3`                                                                                                                                                                                                                                                              |
| `map`       | **No**   | `String`               |                                                                                                                                                                                                                                                                                                                                                            |
| `length`    | **No**   | `number`               | Allows you to specify a maximum length for the subpart of the value to be indexed.<br /><br />MySQL only.                                                                                                                                                                                                                                                  |
| `sort`      | **No**   | `String`               | Allows you to specify in what order the entries of the constraint are stored in the database. The available options are `Asc` and `Desc`.                                                                                                                                                                                                                  |
| `clustered` | **No**   | `Boolean`              | Defines whether the constraint is clustered or non-clustered. Defaults to `false`.<br /><br />SQL Server only.                                                                                                                                                                                                                                             |
| `where`     | **No**   | `function` or `object` | Defines a [partial index](/orm/prisma-schema/data-model/indexes#configuring-partial-indexes-with-where) that only includes rows matching the specified condition. Accepts `raw("SQL expression")` or an object literal like `{ field: value }`.<br /><br />PostgreSQL, SQLite, SQL Server, and CockroachDB. Requires the `partialIndexes` Preview feature. |

The name of the `fields` argument on the `@@unique` attribute can be omitted:

```prisma no-lines
@@unique(fields: [title, author])
@@unique([title, author])
@@unique(fields: [title, author], name: "titleAuthor")
```

The `length` and `sort` arguments are added to the relevant field names:

```prisma no-lines
@@unique(fields: [title(length:10), author])
@@unique([title(sort: Desc), author(sort: Asc)])
```

Signature [#signature-4]

> ```prisma no-lines
> @@unique(_ fields: FieldReference[], name: String?, map: String?, where: raw(String) | { field: value }?)
> ```

> **Note**: The `where` argument accepts either `raw("SQL expression")` for raw SQL predicates or an object literal like `{ field: value }` for type-safe conditions. See [Configuring partial indexes](/orm/prisma-schema/data-model/indexes#configuring-partial-indexes-with-where) for details.

> **Note**: Before the `partialIndexes` Preview feature (and before version 4.0.0 / 3.5.0 with the `extendedIndexes` Preview feature), the signature was:
>
> ```prisma no-lines
> @@unique(_ fields: FieldReference[], name: String?, map: String?)
> ```

Examples [#examples-10]

Specify a multi-field unique attribute on two String fields [#specify-a-multi-field-unique-attribute-on-two-string-fields]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id        Int     @default(autoincrement())
      firstName String
      lastName  String
      isAdmin   Boolean @default(false)

      @@unique([firstName, lastName])
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id        String  @id @default(auto()) @map("_id") @db.ObjectId
      firstName String
      lastName  String
      isAdmin   Boolean @default(false)

      @@unique([firstName, lastName])
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

To retrieve a user, use the generated field name (`firstname_lastname`):

```ts highlight=3;normal
const user = await prisma.user.findUnique({
  where: {
    firstName_lastName: {
      firstName: "Alice",
      lastName: "Smith",
      isAdmin: true,
    },
  },
});
```

Specify a multi-field unique attribute on two String fields and one Boolean field [#specify-a-multi-field-unique-attribute-on-two-string-fields-and-one-boolean-field]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id        Int     @default(autoincrement())
      firstName String
      lastName  String
      isAdmin   Boolean @default(false)

      @@unique([firstName, lastName, isAdmin])
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id        String  @id @default(auto()) @map("_id") @db.ObjectId
      firstName String
      lastName  String
      isAdmin   Boolean @default(false)

      @@unique([firstName, lastName, isAdmin])
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Specify a multi-field unique attribute that includes a relation field [#specify-a-multi-field-unique-attribute-that-includes-a-relation-field]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model Post {
      id        Int     @default(autoincrement())
      author    User    @relation(fields: [authorId], references: [id])
      authorId  Int
      title     String
      published Boolean @default(false)

      @@unique([authorId, title])
    }

    model User {
      id    Int    @id @default(autoincrement())
      email String @unique
      posts Post[]
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model Post {
      id        String  @id @default(auto()) @map("_id") @db.ObjectId
      author    User    @relation(fields: [authorId], references: [id])
      authorId  String  @db.ObjectId
      title     String
      published Boolean @default(false)

      @@unique([authorId, title])
    }

    model User {
      id    String @id @default(auto()) @map("_id") @db.ObjectId
      email String @unique
      posts Post[]
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Specify a custom name for a multi-field unique attribute [#specify-a-custom-name-for-a-multi-field-unique-attribute]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id        Int     @default(autoincrement())
      firstName String
      lastName  String
      isAdmin   Boolean @default(false)

      @@unique(fields: [firstName, lastName, isAdmin], name: "admin_identifier")
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id        String  @id @default(auto()) @map("_id") @db.ObjectId
      firstName String
      lastName  String
      isAdmin   Boolean @default(false)

      @@unique(fields: [firstName, lastName, isAdmin], name: "admin_identifier")
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

To retrieve a user, use the custom field name (`admin_identifier`):

```ts highlight=3;normal
const user = await prisma.user.findUnique({
  where: {
    admin_identifier: {
      firstName: "Alice",
      lastName: "Smith",
      isAdmin: true,
    },
  },
});
```

@@index [#index]

Defines an index in the database.

Remarks [#remarks-12]

Relational databases [#relational-databases-5]

* Corresponding database construct: `INDEX`
* There are some additional index configuration options that cannot be provided via the Prisma schema yet. These include:
  * PostgreSQL and CockroachDB:
    * Define index fields as expressions (e.g. `CREATE INDEX title ON public."Post"((lower(title)) text_ops);`)
    * Create indexes concurrently with `CONCURRENTLY`

<CalloutContainer type="info">
  <CalloutDescription>
    While you cannot configure these option in your Prisma schema, you can still configure them on the database-level directly.
  </CalloutDescription>
</CalloutContainer>

MongoDB [#mongodb-14]

Arguments [#arguments-5]

| Name        | Required | Type                         | Description                                                                                                                                                                                                                                                                                                                                                |
| ----------- | -------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields`    | **Yes**  | `FieldReference[]`           | A list of field names - for example, `["firstname", "lastname"]`                                                                                                                                                                                                                                                                                           |
| `name`      | **No**   | `String`                     | The name that Prisma Client will expose for the argument covering all fields, e.g. `fullName` in `fullName: { firstName: "First", lastName: "Last"}`                                                                                                                                                                                                       |
| `map`       | **No**   | `map`                        | The name of the index in the underlying database (Prisma generates an index name that respects identifier length limits if you do not specify a name. Prisma uses the following naming convention: `tablename.field1_field2_field3_unique`)                                                                                                                |
| `length`    | **No**   | `number`                     | Allows you to specify a maximum length for the subpart of the value to be indexed.<br /><br />MySQL only.                                                                                                                                                                                                                                                  |
| `sort`      | **No**   | `String`                     | Allows you to specify in what order the entries of the index or constraint are stored in the database. The available options are `asc` and `desc`.                                                                                                                                                                                                         |
| `clustered` | **No**   | `Boolean`                    | Defines whether the index is clustered or non-clustered. Defaults to `false`.<br /><br />SQL Server only.                                                                                                                                                                                                                                                  |
| `type`      | **No**   | `identifier`                 | Allows you to specify an index access method. Defaults to `BTree`.<br /><br />PostgreSQL and CockroachDB only.                                                                                                                                                                                                                                             |
| `ops`       | **No**   | `identifier` or a `function` | Allows you to define the index operators for certain index types.<br /><br />PostgreSQL only.                                                                                                                                                                                                                                                              |
| `where`     | **No**   | `function` or `object`       | Defines a [partial index](/orm/prisma-schema/data-model/indexes#configuring-partial-indexes-with-where) that only includes rows matching the specified condition. Accepts `raw("SQL expression")` or an object literal like `{ field: value }`.<br /><br />PostgreSQL, SQLite, SQL Server, and CockroachDB. Requires the `partialIndexes` Preview feature. |

The *name* of the `fields` argument on the `@@index` attribute can be omitted:

```prisma no-lines
@@index(fields: [title, author])
@@index([title, author])
```

The `length` and `sort` arguments are added to the relevant field names:

```prisma no-lines
@@index(fields: [title(length:10), author])
@@index([title(sort: Asc), author(sort: Desc)])
```

Signature [#signature-5]

```prisma no-lines
@@index(_ fields: FieldReference[], map: String?, where: raw(String) | { field: value }?)
```

> **Note**: The `where` argument accepts either `raw("SQL expression")` for raw SQL predicates or an object literal like `{ field: value }` for type-safe conditions. See [Configuring partial indexes](/orm/prisma-schema/data-model/indexes#configuring-partial-indexes-with-where) for details.

> **Note**: With the `partialIndexes` Preview feature, the `where` argument is available. Before this Preview feature, the signature was:
>
> ```prisma no-lines
> @@index(_ fields: FieldReference[], map: String?)
> ```

Examples [#examples-11]

Assume you want to add an index for the `title` field of the `Post` model

Define a single-column index (Relational databases only) [#define-a-single-column-index-relational-databases-only]

```prisma
model Post {
  id      Int     @id @default(autoincrement())
  title   String
  content String?

  @@index([title])
}
```

Define a multi-column index (Relational databases only) [#define-a-multi-column-index-relational-databases-only]

```prisma
model Post {
  id      Int     @id @default(autoincrement())
  title   String
  content String?

  @@index([title, content])
}
```

Define an index with a name (Relational databases only) [#define-an-index-with-a-name-relational-databases-only]

```prisma
model Post {
  id      Int     @id @default(autoincrement())
  title   String
  content String?

  @@index(fields: [title, content], name: "main_index")
}
```

Define an index on a composite type field (Relational databases only) [#define-an-index-on-a-composite-type-field-relational-databases-only]

```prisma
type Address {
  street String
  number Int
}

model User {
  id      Int     @id
  email   String
  address Address

  @@index([address.number])
}
```

@relation [#relation]

Defines meta information about the relation. [Learn more](/orm/prisma-schema/data-model/relations#the-relation-attribute).

Remarks [#remarks-13]

Relational databases [#relational-databases-6]

* Corresponding database constructs: `FOREIGN KEY` / `REFERENCES`

MongoDB [#mongodb-15]

* If your model's primary key is of type `ObjectId` in the underlying database, both the primary key *and* the foreign key must have the `@db.ObjectId` attribute

Arguments [#arguments-6]

| Name         | Type                                                                                                                                           | Required                                                                                | Description                                                                                                                                                                | Example                                               |
| :----------- | :--------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------- |
| `name`       | `String`                                                                                                                                       | Sometimes (e.g. to disambiguate a relation)                                             | Defines the name of the relationship. In an m-n-relation, it also determines the name of the underlying relation table.                                                    | `"CategoryOnPost"`, `"MyRelation"`                    |
| `fields`     | `FieldReference[]`                                                                                                                             | On [annotated](/orm/prisma-schema/data-model/relations#relation-fields) relation fields | A list of [fields](/orm/prisma-schema/data-model/models#defining-fields) of the *current* model                                                                            | `["authorId"]`, `["authorFirstName, authorLastName"]` |
| `references` | `FieldReference[]`                                                                                                                             | On [annotated](/orm/prisma-schema/data-model/relations#relation-fields) relation fields | A list of [fields](/orm/prisma-schema/data-model/models#defining-fields) of the model on *the other side of the relation*                                                  | `["id"]`, `["firstName, lastName"]`                   |
| `map`        | `String`                                                                                                                                       | No                                                                                      | Defines a [custom name](/orm/prisma-schema/data-model/database-mapping#constraint-and-index-names) for the foreign key in the database.                                    | `["id"]`, `["firstName, lastName"]`                   |
| `onUpdate`   | Enum. See [Types of referential actions](/orm/prisma-schema/data-model/relations/referential-actions#types-of-referential-actions) for values. | No                                                                                      | Defines the [referential action](/orm/prisma-schema/data-model/relations/referential-actions) to perform when a referenced entry in the referenced model is being updated. | `Cascade`, `NoAction`                                 |
| `onDelete`   | Enum. See [Types of referential actions](/orm/prisma-schema/data-model/relations/referential-actions#types-of-referential-actions) for values. | No                                                                                      | Defines the [referential action](/orm/prisma-schema/data-model/relations/referential-actions) to perform when a referenced entry in the referenced model is being deleted. | `Cascade`, `NoAction`                                 |

The name of the `name` argument on the `@relation` attribute can be omitted (`references` is required):

```prisma
@relation(name: "UserOnPost", references: [id])
@relation("UserOnPost", references: [id])

// or

@relation(name: "UserOnPost")
@relation("UserOnPost")
```

Signature [#signature-6]

```prisma no-lines
@relation(_ name: String?, fields: FieldReference[]?, references: FieldReference[]?, onDelete: ReferentialAction?, onUpdate: ReferentialAction?, map: String?)
```

With SQLite, the signature changes to:

```prisma no-lines
@relation(_ name: String?, fields: FieldReference[]?, references: FieldReference[]?, onDelete: ReferentialAction?, onUpdate: ReferentialAction?)
```

Examples [#examples-12]

See: [The `@relation` attribute](/orm/prisma-schema/data-model/relations#the-relation-attribute).

@map [#map]

Maps a field name or enum value from the Prisma schema to a column or document field with a different name in the database. If you do not use `@map`, the Prisma field name matches the column name or document field name exactly.

> See [Using custom model and field names](/orm/prisma-client/setup-and-configuration/custom-model-and-field-names) to see how `@map` and `@@map` changes the generated Prisma Client.

Remarks [#remarks-14]

General [#general-3]

* `@map` **does not** rename the columns / fields in the database
* `@map` **does** [change the field names in the generated client](#map-the-firstname-field-to-a-column-called-first_name)

MongoDB [#mongodb-16]

Your `@id` field must include `@map("_id")`. For example:

```prisma
model User {
  id String @default(auto()) @map("_id") @db.ObjectId
}
```

Arguments [#arguments-7]

| Name   | Type     | Required | Description                                                                  | Example                         |
| :----- | :------- | :------- | :--------------------------------------------------------------------------- | :------------------------------ |
| `name` | `String` | **Yes**  | The database column (relational databases) or document field (MongoDB) name. | `"comments"`, `"someFieldName"` |

The name of the `name` argument on the `@map` attribute can be omitted:

```prisma
@map(name: "is_admin")
@map("users")
```

Signature [#signature-7]

```prisma no-lines
@map(_ name: String)
```

Examples [#examples-13]

Map the firstName field to a column called first_name [#map-the-firstname-field-to-a-column-called-first_name]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id        Int    @id @default(autoincrement())
      firstName String @map("first_name")
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id        String @id @default(auto()) @map("_id") @db.ObjectId
      firstName String @map("first_name")
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

The generated client:

```ts highlight=3;normal
await prisma.user.create({
  data: {
    firstName: "Yewande", // first_name */} firstName
  },
});
```

Map an enum named ADMIN to a database enum named admin [#map-an-enum-named-admin-to-a-database-enum-named-admin]

```prisma
enum Role {
  ADMIN    @map("admin")
  CUSTOMER
}
```

In Prisma ORM v7 and later, the generated TypeScript enum uses the mapped values:

```ts
export const Role = {
  ADMIN: "admin",
  CUSTOMER: "CUSTOMER",
} as const;
```

This means `Role.ADMIN` evaluates to `"admin"`, not `"ADMIN"`.

@@map [#map-1]

Maps the Prisma schema model name to a table (relational databases) or collection (MongoDB) with a different name, or an enum name to a different underlying enum in the database. If you do not use `@@map`, the model name matches the table (relational databases) or collection (MongoDB) name exactly.

> See [Using custom model and field names](/orm/prisma-client/setup-and-configuration/custom-model-and-field-names) to see how `@map` and `@@map` changes the generated Prisma Client.

Arguments [#arguments-8]

| Name   | Type     | Required | Description                                                             | Example                                     |
| :----- | :------- | :------- | :---------------------------------------------------------------------- | :------------------------------------------ |
| `name` | `String` | **Yes**  | The database table (relational databases) or collection (MongoDB) name. | `"comments"`, `"someTableOrCollectionName"` |

The name of the `name` argument on the `@@map` attribute can be omitted

```prisma
@@map(name: "users")
@@map("users")
```

Signature [#signature-8]

```prisma no-lines
@@map(_ name: String)
```

Examples [#examples-14]

Map the User model to a database table/collection named users [#map-the-user-model-to-a-database-tablecollection-named-users]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id   Int    @id @default(autoincrement())
      name String

      @@map("users")
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id   String @id @default(auto()) @map("_id") @db.ObjectId
      name String

      @@map("users")
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

The generated client:

```ts highlight=1;normal
await prisma.user.create({
  // users */} user
  data: {
    name: "Yewande",
  },
});
```

Map the Role enum to a native enum in the database named _Role its values to lowercase values in the database [#map-the-role-enum-to-a-native-enum-in-the-database-named-_role-its-values-to-lowercase-values-in-the-database]

```prisma
enum Role {
  ADMIN    @map("admin")
  CUSTOMER @map("customer")

  @@map("_Role")
}
```

@updatedAt [#updatedat]

Automatically stores the time when a record was last updated. If you do not supply a time yourself, Prisma Client will automatically set the value for fields with this attribute.

Remarks [#remarks-15]

* Compatible with [`DateTime`](#datetime) fields
* Implemented at Prisma ORM level

<CalloutContainer type="warning">
  <CalloutDescription>
    In versions before [4.4.0](https://github.com/prisma/prisma/releases/tag/4.4.0), if you're also using [`now()`](/orm/reference/prisma-schema-reference#now), the time might differ from the `@updatedAt` values if your database and app have different time zones. This happens because `@updatedAt` operates at the Prisma ORM level, while `now()` operates at the database level.
  </CalloutDescription>
</CalloutContainer>

<CalloutContainer type="info">
  <CalloutDescription>
    If you pass an empty update clause, the @updatedAt value will remain unchanged. For example:

    ```ts
    await prisma.user.update({
      where: {
        id: 1,
      },
      data: {}, //<- Empty update clause
    });
    ```
  </CalloutDescription>
</CalloutContainer>

Arguments [#arguments-9]

N/A

Signature [#signature-9]

```prisma no-lines
@updatedAt
```

Examples [#examples-15]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma line-number
    model Post {
      id        String   @id
      updatedAt DateTime @updatedAt
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma line-number
    model Post {
      id        String   @id @map("_id") @db.ObjectId
      updatedAt DateTime @updatedAt
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

@ignore [#ignore]

Add `@ignore` to a field that you want to exclude from Prisma Client (for example, a field that you do not want Prisma Client users to update). Ignored fields are excluded from the generated Prisma Client. The model's `create` method is disabled when doing this for *required* fields with no `@default` (because the database cannot create an entry without that data).

Remarks [#remarks-16]

* Prisma ORM automatically adds `@ignore` to fields that *refer to* invalid models when you introspect.

Examples [#examples-16]

The following example demonstrates manually adding `@ignore` to exclude the `email` field from Prisma Client:

```prisma title="schema.prisma" highlight=4;normal
model User {
  id    Int    @id
  name  String
  email String @ignore // this field will be excluded // [!code highlight]
}
```

@@ignore [#ignore-1]

Add `@@ignore` to a model that you want to exclude from Prisma Client (for example, a model that you do not want Prisma users to update). Ignored models are excluded from the generated Prisma Client.

Remarks [#remarks-17]

* Prisma ORM adds `@@ignore` to an invalid model during introspection. (It also adds [`@ignore`](#ignore) to relations pointing to such a model)

Examples [#examples-17]

In the following example, the `Post` model is invalid because it does not have a unique identifier. Use `@@ignore` to exclude it from the generated Prisma Client API:

```prisma title="schema.prisma" highlight=7;normal
/// The underlying table does not contain a valid unique identifier and can therefore currently not be handled by Prisma Client.
model Post {
  id       Int  @default(autoincrement()) // no unique identifier
  author   User @relation(fields: [authorId], references: [id])
  authorId Int

  @@ignore // [!code highlight]
}
```

In the following example, the `Post` model is invalid because it does not have a unique identifier, and the `posts` relation field on `User` is invalid because it refers to the invalid `Post` model. Use `@@ignore` on the `Post` model and `@ignore` on the `posts` relation field in `User` to exclude both the model and the relation field from the generated Prisma Client API:

```prisma title="schema.prisma" highlight=7,13;normal
/// The underlying table does not contain a valid unique identifier and can therefore currently not be handled by Prisma Client.
model Post {
  id       Int  @default(autoincrement()) // no unique identifier
  author   User @relation(fields: [authorId], references: [id])
  authorId Int

  @@ignore // [!code highlight]
}

model User {
  id    Int     @id @default(autoincrement())
  name  String?
  posts Post[]  @ignore // [!code highlight]
}
```

@@schema [#schema]

Add `@@schema` to a model to specify which schema in your database should contain the table associated with that model. Learn more about [adding multiple schema's here](/orm/prisma-schema/data-model/multi-schema).

<CalloutContainer type="info">
  <CalloutDescription>
    [Multiple database schema](/orm/prisma-schema/data-model/multi-schema) support is only available with the PostgreSQL, CockroachDB, and SQL Server connectors.
  </CalloutDescription>
</CalloutContainer>

Arguments [#arguments-10]

| Name   | Type     | Required | Description                      | Example            |
| :----- | :------- | :------- | :------------------------------- | :----------------- |
| `name` | `String` | **Yes**  | The name of the database schema. | `"base"`, `"auth"` |

The name of the `name` argument on the `@@schema` attribute can be omitted

```prisma
@@schema(name: "auth")
@@schema("auth")
```

Signature [#signature-10]

```prisma no-lines
@@schema(_ name: String)
```

Examples [#examples-18]

Map the User model to a database schema named auth [#map-the-user-model-to-a-database-schema-named-auth]

```prisma highlight=3,9,16;normal
generator client {
  provider        = "prisma-client"
  output          = "./generated"
}

datasource db {
  provider = "postgresql"
  schemas  = ["auth"] // [!code highlight]
}

model User {
  id   Int    @id @default(autoincrement())
  name String

  @@schema("auth") // [!code highlight]
}
```

<CalloutContainer type="info">
  <CalloutDescription>
    For more information about using the `multiSchema` feature, refer to [this guide](/orm/prisma-schema/data-model/multi-schema).
  </CalloutDescription>
</CalloutContainer>

@shardKey [#shardkey]

<CalloutContainer type="info">
  <CalloutDescription>
    This feature requires the `shardKeys` Preview feature flag on your `generator`:

    ```prisma
    generator client {
      provider = "prisma-client"
      output = "../generated/prisma"
      previewFeatures = ["shardKeys"]
    }
    ```
  </CalloutDescription>
</CalloutContainer>

The `@shardKey` attribute is only compatible with [PlanetScale](http://planetscale.com/) databases. It enables you define a [shard key](https://planetscale.com/docs/vitess/sharding) on a field of your model:

```prisma
model User {
  id     String @default(uuid())
  region String @shardKey
}
```

@@shardKey [#shardkey-1]

<CalloutContainer type="info">
  <CalloutDescription>
    This feature requires the `shardKeys` Preview feature flag on your `generator`:

    ```prisma
    generator client {
      provider = "prisma-client"
      output = "../generated/prisma"
      previewFeatures = ["shardKeys"]
    }
    ```
  </CalloutDescription>
</CalloutContainer>

The `@@shardKey` attribute is only compatible with [PlanetScale](http://planetscale.com/) databases. It enables you define a [shard key](https://planetscale.com/docs/vitess/sharding) on multiple fields of your model:

```prisma
model User {
  id         String @default(uuid())
  country    String
  customerId String
  @@shardKey([country, customerId])
}
```

Attribute functions [#attribute-functions]

auto() [#auto]

<CalloutContainer type="warning">
  <CalloutDescription>
    This function is available on MongoDB only.
  </CalloutDescription>
</CalloutContainer>

Represents **default values** that are automatically generated by the database.

Remarks [#remarks-18]

MongoDB [#mongodb-17]

Used to generate an `ObjectId` for `@id` fields:

```prisma
id  String  @map("_id") @db.ObjectId @default(auto())
```

Relational databases [#relational-databases-7]

The `auto()` function is not available on relational databases.

Example [#example]

Generate ObjectId (MongoDB only) [#generate-objectid-mongodb-only]

```prisma
model User {
  id   String  @id @default(auto()) @map("_id") @db.ObjectId
  name String?
}
```

autoincrement() [#autoincrement]

<CalloutContainer type="warning">
  <CalloutDescription>
    **Not supported by MongoDB** <br />
    The [MongoDB connector](/orm/core-concepts/supported-databases/mongodb) does not support the `autoincrement()` function.
  </CalloutDescription>
</CalloutContainer>

Create a sequence of integers in the underlying database and assign the incremented values to the ID values of the created records based on the sequence.

Remarks [#remarks-19]

* Compatible with `Int` on most databases (`BigInt` on CockroachDB)
* Implemented on the database-level, meaning that it manifests in the database schema and can be recognized through introspection. Database implementations:

  | Database    | Implementation                                                                                    |
  | ----------- | ------------------------------------------------------------------------------------------------- |
  | PostgreSQL  | [`SERIAL`](https://www.postgresql.org/docs/9.1/datatype-numeric.html#DATATYPE-SERIAL) type        |
  | MySQL       | [`AUTO_INCREMENT`](https://dev.mysql.com/doc/refman/8.0/en/example-auto-increment.html) attribute |
  | SQLite      | [`AUTOINCREMENT`](https://www.sqlite.org/autoinc.html) keyword                                    |
  | CockroachDB | [`SERIAL`](https://www.postgresql.org/docs/9.1/datatype-numeric.html#DATATYPE-SERIAL) type        |

Examples [#examples-19]

Generate autoincrementing integers as IDs (Relational databases only) [#generate-autoincrementing-integers-as-ids-relational-databases-only-1]

```prisma
model User {
  id   Int    @id @default(autoincrement())
  name String
}
```

sequence() [#sequence]

<CalloutContainer type="info">
  <CalloutDescription>
    **Only supported by CockroachDB** <br />
    The sequence function is only supported by [CockroachDB connector](/orm/core-concepts/supported-databases/postgresql#cockroachdb).
  </CalloutDescription>
</CalloutContainer>

Create a sequence of integers in the underlying database and assign the incremented values to the values of the created records based on the sequence.

Optional arguments [#optional-arguments]

| Argument    | Example                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `virtual`   | `@default(sequence(virtual))`<br />Virtual sequences are sequences that do not generate monotonically increasing values and instead produce values like those generated by the built-in function `unique_rowid()`. |
| `cache`     | `@default(sequence(cache: 20))`<br />The number of sequence values to cache in memory for reuse in the session. A cache size of `1` means that there is no cache, and cache sizes of less than `1` are not valid.  |
| `increment` | `@default(sequence(increment: 4))`<br />The new value by which the sequence is incremented. A negative number creates a descending sequence. A positive number creates an ascending sequence.                      |
| `minValue`  | `@default(sequence(minValue: 10))`<br />The new minimum value of the sequence.                                                                                                                                     |
| `maxValue`  | `@default(sequence(maxValue: 3030303))`<br />The new maximum value of the sequence.                                                                                                                                |
| `start`     | `@default(sequence(start: 2))`<br />The value the sequence starts at, if it's restarted or if the sequence hits the `maxValue`.                                                                                    |

Examples [#examples-20]

Generate sequencing integers as IDs [#generate-sequencing-integers-as-ids]

```prisma
model User {
  id   Int    @id @default(sequence(maxValue: 4294967295))
  name String
}
```

cuid() [#cuid]

Generate a globally unique identifier based on the [`cuid`](https://github.com/ericelliott/cuid) spec.

If you'd like to use [`cuid2`](https://github.com/paralleldrive/cuid2) values, you can pass `2` as an argument to the `cuid` function: `cuid(2)`.

Remarks [#remarks-20]

* Compatible with `String`.
* Implemented by Prisma ORM and therefore not "visible" in the underlying database schema. You can still use `cuid()` when using [introspection](/orm/prisma-schema/introspection) by [manually changing your Prisma schema](/orm/prisma-client/setup-and-configuration/custom-model-and-field-names) and generating Prisma Client, in that case the values will be generated by Prisma ORM.
* Since the length of `cuid()` output is undefined per the cuid creator, a safe field size is 30 characters, in order to allow for enough characters for very large values. If you set the field size as less than 30, and then a larger value is generated by `cuid()`, you might see Prisma Client errors such as `Error: The provided value for the column is too long for the column's type.`
* For **MongoDB**: `cuid()` does not generate a valid `ObjectId`. You can use [`@db.ObjectId` syntax](#generate-objectid-as-ids-mongodb-only) if you want to use `ObjectId` in the underlying database. However, you can still use `cuid()` if your `_id` field is not of type `ObjectId`.

Examples [#examples-21]

Generate cuid() values as IDs [#generate-cuid-values-as-ids-1]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id   String @id @default(cuid())
      name String
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id   String @id @default(cuid()) @map("_id")
      name String
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Generate cuid(2) values as IDs based on the cuid2 spec [#generate-cuid2-values-as-ids-based-on-the-cuid2-spec]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id   String @id @default(cuid(2))
      name String
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id   String @id @default(cuid(2)) @map("_id")
      name String
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

uuid() [#uuid]

Generate a globally unique identifier based on the [UUID](https://en.wikipedia.org/wiki/Universally_unique_identifier) spec. Prisma ORM supports versions 4 (default) and 7.

Remarks [#remarks-21]

* Compatible with `String`.
* Implemented by Prisma ORM and therefore not "visible" in the underlying database schema. You can still use `uuid()` when using [introspection](/orm/prisma-schema/introspection) by [manually changing your Prisma schema](/orm/prisma-client/setup-and-configuration/custom-model-and-field-names) and generating Prisma Client, in that case the values will be generated by Prisma ORM.
* For **relational databases**: If you do not want to use Prisma ORM's `uuid()` function, you can use [the native database function with `dbgenerated`](#override-default-value-behavior-for-supported-types).
* For **MongoDB**: `uuid()` does not generate a valid `ObjectId`. You can use [`@db.ObjectId` syntax](#generate-objectid-as-ids-mongodb-only) if you want to use `ObjectId` in the underlying database. However, you can still use `uuid()` if your `_id` field is not of type `ObjectId`.

Examples [#examples-22]

Generate uuid() values as IDs using UUID v4 [#generate-uuid-values-as-ids-using-uuid-v4]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id   String @id @default(uuid())
      name String
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id   String @id @default(uuid()) @map("_id")
      name String
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Generate uuid(7) values as IDs using UUID v7 [#generate-uuid7-values-as-ids-using-uuid-v7]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id   String @id @default(uuid(7))
      name String
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id   String @id @default(uuid(7)) @map("_id")
      name String
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

ulid() [#ulid]

Generate a universally unique lexicographically sortable identifier based on the [ULID](https://github.com/ulid/spec) spec.

Remarks [#remarks-22]

* `ulid()` will produce 128-bit random identifier represented as a 26-character long alphanumeric string, e.g.: `01ARZ3NDEKTSV4RRFFQ69G5FAV`

Examples [#examples-23]

Generate ulid() values as IDs [#generate-ulid-values-as-ids-1]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id   String @id @default(ulid())
      name String
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id   String @id @default(ulid()) @map("_id")
      name String
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

nanoid() [#nanoid]

Generated values based on the [Nano ID](https://github.com/ai/nanoid) spec. `nanoid()` accepts an integer value between 2 and 255 that specifies the *length* of the generate ID value, e.g. `nanoid(16)` will generated ID with 16 characters. If you don't provide a value to the nanoid() function, the default value is 21.

<CalloutContainer type="info">
  <CalloutDescription>
    Nano ID is quite comparable to UUID v4 (random-based). It has a similar number of random bits in the ID (126 in Nano ID and 122 in UUID), so it has a similar collision probability:

    For there to be a one in a billion chance of duplication, 103 trillion version 4 IDs must be generated.

    There are two main differences between Nano ID and UUID v4:

    * Nano ID uses a bigger alphabet, so a similar number of random bits are packed in just 21 symbols instead of 36.
    * Nano ID code is 4 times smaller than uuid/v4 package: 130 bytes instead of 423.
  </CalloutDescription>
</CalloutContainer>

Remarks [#remarks-23]

* Compatible with `String`.
* Implemented by Prisma ORM and therefore not "visible" in the underlying database schema. You can still use `uuid()` when using [introspection](/orm/prisma-schema/introspection) by [manually changing your Prisma schema](/orm/prisma-client/setup-and-configuration/custom-model-and-field-names) and [generating Prisma Client](/orm/reference/prisma-schema-reference#fields-for-prisma-client-provider), in that case the values will be generated by Prisma ORM.
* For **MongoDB**: `nanoid()` does not generate a valid `ObjectId`. You can use [`@db.ObjectId` syntax](#generate-objectid-as-ids-mongodb-only) if you want to use `ObjectId` in the underlying database. However, you can still use `nanoid()` if your `_id` field is not of type `ObjectId`.

Examples [#examples-24]

Generate nanoid() values with 21 characters as IDs [#generate-nanoid-values-with-21-characters-as-ids]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id   String @id @default(nanoid())
      name String
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id   String @id @default(nanoid()) @map("_id")
      name String
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Generate nanoid() values with 16 characters as IDs [#generate-nanoid-values-with-16-characters-as-ids]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id   String @id @default(nanoid(16))
      name String
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id   String @id @default(nanoid(16)) @map("_id")
      name String
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

now() [#now]

Set a timestamp of the time when a record is created.

Remarks [#remarks-24]

General [#general-4]

* Compatible with [`DateTime`](#datetime)

<CalloutContainer type="warning">
  <CalloutDescription>
    In versions before [4.4.0](https://github.com/prisma/prisma/releases/tag/4.4.0), if you're also using [`@updatedAt`](/orm/reference/prisma-schema-reference#updatedat), the time might differ from the `now()` values if your database and app have different time zones. This happens because `@updatedAt` operates at the Prisma ORM level, while `now()` operates at the database level.
  </CalloutDescription>
</CalloutContainer>

Relational databases [#relational-databases-8]

* Implemented on the database-level, meaning that it manifests in the database schema and can be recognized through introspection. Database implementations:

  | Database    | Implementation                                                                                                                                  |
  | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
  | PostgreSQL  | [`CURRENT_TIMESTAMP`](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT) and aliases like `now()`      |
  | MySQL       | [`CURRENT_TIMESTAMP`](https://dev.mysql.com/doc/refman/8.0/en/date-and-time-functions.html#function_current-timestamp) and aliases like `now()` |
  | SQLite      | `CURRENT_TIMESTAMP` and aliases like `date('now')`                                                                                              |
  | CockroachDB | [`CURRENT_TIMESTAMP`](https://www.cockroachlabs.com/docs/stable/functions-and-operators#special-syntax-forms) and aliases like `now()`          |

MongoDB [#mongodb-18]

* Implemented at Prisma ORM level

Examples [#examples-25]

Set current timestamp value when a record is created [#set-current-timestamp-value-when-a-record-is-created]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    model User {
      id        String   @id
      createdAt DateTime @default(now())
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    model User {
      id        String   @id @default(auto()) @map("_id") @db.ObjectId
      createdAt DateTime @default(now())
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

dbgenerated(...) [#dbgenerated]

Represents **default values** that cannot be expressed in the Prisma schema (such as `random()`).

Remarks [#remarks-25]

Relational databases [#relational-databases-9]

* Compatible with any scalar type

* Can not be an empty string `dbgenerated("")`

* Accepts a `String` value, which allows you to:
  * [Set default values for `Unsupported` types](#set-default-value-for-unsupported-type)
  * [Override default value behavior for supported types](#override-default-value-behavior-for-supported-types)

* String values in `dbgenerated(...)` might not match what the DB returns as the default value, because values such as strings may be explicitly cast (e.g. `'hello'::STRING`). When a mismatch is present, Prisma Migrate indicates a migration is still needed. You can use `prisma db pull` to infer the correct value to resolve the discrepancy. ([Related issue](https://github.com/prisma/prisma/issues/14917))

Examples [#examples-26]

Set default value for Unsupported type [#set-default-value-for-unsupported-type]

```prisma
circle     Unsupported("circle")?   @default(dbgenerated("'<(10,4),11>'::circle"))
```

Override default value behavior for supported types [#override-default-value-behavior-for-supported-types]

You can also use `dbgenerated(...)` to set the default value for supported types. For example, in PostgreSQL you can generate UUIDs at the database level rather than rely on Prisma ORM's `uuid()`:

```prisma highlight=2;add|3;delete
model User {
  id   String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid // [!code ++]
  id   String  @id @default(uuid()) @db.Uuid // [!code --]
  test String?
}
```

<CalloutContainer type="info">
  <CalloutDescription>
    [`gen_random_uuid()` is a PostgreSQL function](https://www.postgresql.org/docs/13/functions-uuid.html). To use it in PostgreSQL versions 12.13 and earlier, you must enable the `pgcrypto` extension. See [PostgreSQL extensions](/orm/prisma-schema/postgresql-extensions) for how to install extensions.
  </CalloutDescription>
</CalloutContainer>

Attribute argument types [#attribute-argument-types]

FieldReference[] [#fieldreference]

An array of [field](#model-fields) names: `[id]`, `[firstName, lastName]`

String [#string-1]

A variable length text in double quotes: `""`, `"Hello World"`, `"Alice"`

Expression [#expression]

An expression that can be evaluated by Prisma ORM: `42.0`, `""`, `Bob`, `now()`, `cuid()`

enum [#enum]

<CalloutContainer type="warning">
  <CalloutDescription>
    **Not supported Microsoft SQL Server** <br />
    The [Microsoft SQL Server connector](/orm/core-concepts/supported-databases/sql-server) does not support the `enum` type.
  </CalloutDescription>
</CalloutContainer>

Defines an [enum](/orm/prisma-schema/data-model/models#defining-enums) .

Remarks [#remarks-26]

* Enums are natively supported by [PostgreSQL](https://www.postgresql.org/docs/current/datatype-enum.html) and [MySQL](https://dev.mysql.com/doc/refman/8.0/en/enum.html)
* Enums are implemented and enforced at Prisma ORM level in SQLite and MongoDB

Naming conventions [#naming-conventions-2]

* Enum names must start with a letter (they are typically spelled in [PascalCase](http://wiki.c2.com/?PascalCase))
* Enums must use the singular form (e.g. `Role` instead of `role`, `roles` or `Roles`).
* Must adhere to the following regular expression: `[A-Za-z][A-Za-z0-9_]*`

Examples [#examples-27]

Specify an enum with two possible values [#specify-an-enum-with-two-possible-values]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    enum Role {
      USER
      ADMIN
    }

    model User {
      id   Int  @id @default(autoincrement())
      role Role
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    enum Role {
      USER
      ADMIN
    }

    model User {
      id   String @id @default(auto()) @map("_id") @db.ObjectId
      role Role
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Specify an enum with two possible values and set a default value [#specify-an-enum-with-two-possible-values-and-set-a-default-value]

<CodeBlockTabs defaultValue="Relational databases">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="Relational databases">
      Relational databases
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="MongoDB">
      MongoDB
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="Relational databases">
    ```prisma
    enum Role {
      USER
      ADMIN
    }

    model User {
      id   Int  @id @default(autoincrement())
      role Role @default(USER)
    }
    ```
  </CodeBlockTab>

  <CodeBlockTab value="MongoDB">
    ```prisma
    enum Role {
      USER
      ADMIN
    }

    model User {
      id   String @id @default(auto()) @map("_id") @db.ObjectId
      role Role   @default(USER)
    }
    ```
  </CodeBlockTab>
</CodeBlockTabs>

type [#type]

<CalloutContainer type="warning">
  <CalloutDescription>
    Composite types are available **for MongoDB only**.
  </CalloutDescription>
</CalloutContainer>

Defines a [composite type](/orm/prisma-schema/data-model/models#defining-composite-types-mongodb).

Naming conventions [#naming-conventions-3]

Type names must:

* start with a letter (they are typically spelled in [PascalCase](http://wiki.c2.com/?PascalCase))
* adhere to the following regular expression: `[A-Za-z][A-Za-z0-9_]*`

Examples [#examples-28]

Define a Product model with a list of Photo composite types [#define-a-product-model-with-a-list-of-photo-composite-types]

```prisma
model Product {
  id     String  @id @default(auto()) @map("_id") @db.ObjectId
  name   String
  photos Photo[]
}

type Photo {
  height Int
  width  Int
  url    String
}
```
