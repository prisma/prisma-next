# MongoDB-Prisma: User Journey and Feature Gaps

## Overview

This document, intended for sharing by MongoDB’s Node.js Driver team with the Prisma Engineering team, aims to provide essential context regarding the needs of MongoDB users concerning the Prisma ORM. This context will inform the design phase of the Prisma ORM re-architecting process. The document is structured in two sections:

* A **Feature Gap Analysis**, which catalogs the standard, expected MongoDB features across all Object-Document Mapper (ODM) integrations. It provides a prioritized list of features that are desirable for MongoDB users to access and how Prisma currently meets them.

* A **Sample User Journey**, designed to sensitize the engineering teams to the typical experiences and priorities of MongoDB users while using Prisma.

## Feature Gap Analysis

This spreadsheet serves as a priority guide for the engineering team by highlighting relevant MongoDB features that are currently absent in the Prisma ORM.

### [Prisma/MongoDB: Feature support priority list](https://docs.google.com/spreadsheets/d/1665ZGno989msR2Y_l_4AuZAErzHFWz7bmqKSpNYSmvc/edit?gid=988370597#gid=988370597)

## Sample User Journey

Lucas, a full-stack JavaScript developer happy with MongoDB, decided to try Prisma ORM, which was getting a lot of attention in the JS/TS community. He started a new movie recommendation web app and went straight to the Prisma website's [*Getting Started*](https://www.prisma.io/docs/getting-started/prisma-orm/quickstart/mongodb) guide for MongoDB, hoping his existing database knowledge would make the setup easy.

The initial setup was smooth. Lucas used npx create-next-app@latest for a Next.js project and installed the necessary Prisma dependencies. This quick project initialization and dependency management left him with a great first impression.

Next, he ran npx prisma db pull to introspect his MongoDB schema (think of it as very similar to the [mflix dataset](https://www.mongodb.com/docs/atlas/sample-data/sample-mflix/)). This is where he first hit a wall. Because his MongoDB collections were plural (e.g., movies, users), Prisma generated models with the same plural names. He had to manually rename them to singular (Movie, User) and use the @@map attribute to keep his API clean, a step he thought the tool would handle automatically.

Furthermore, polymorphic fields like `ratings` (whose structure changes depending on the rating engine) were simply typed as Json. Used to TypeScript Unions and complex schemas, he was forced to manually define Composite Types or specific type blocks to restore type safety for those embedded objects. Finally, since MongoDB doesn't have foreign keys, he had to manually define every single relationship in his schema.prisma file, as the introspection couldn't figure out the links.

Despite these configuration issues, once the Prisma client was set up, Lucas became very productive. Developing the application with the client SDK was super smooth. Performing common CRUD operations and using the robust, generated TypeScript types for his models were huge benefits.

His next task was to add a simple upvote/downvote count field to the existing Movie model. Lucas added the field to the schema and ran npx prisma db push. Since he wasn't adding an index or a required field, the command succeeded but didn't change the MongoDB backend. He smiled, remembering MongoDB's flexibility: the field only "exists" when a document is saved with it. However, the Prisma Client immediately recognized the field, giving him updated type checking and IntelliSense without a complicated migration.

As the development continued, Lucas needed to build a personalized recommendation engine, which required a big schema change: moving the user reaction data from an embedded field to a new, referenced model/collection. This shift from embedded to referenced data is a common NoSQL pattern, but it created a major hassle in the ORM workflow. Lucas had to manually write a migration script to move the old data into the new collection and then clean up the old embedded fields. The lack of an automated data migration feature for this common MongoDB evolution made him feel disappointed.

Finally, Lucas decided to use MongoDB's powerful vector search for his recommendations by creating embeddings for movie plots. He wrote a custom script for the embeddings and to set up the necessary indexes. When updating the Prisma schema for the new embedding field, he was limited to using the Byte type for binary data, which was an acceptable workaround. However, for the actual vector search operations, he was forced to use RawQuery. This meant he had to bypass the elegant ORM client and drop to raw queries for advanced, MongoDB-specific features.

With his prototype finished and ready for production, Lucas felt "guarded optimism." He realized he was only benefiting from the ORM client itself and not getting the full value from Prisma that his colleagues love. He intends to try *Prisma Accelerate* and *Optimize* at some point, but for now he remains skeptical about his non-relational workloads.

In the end, Lucas’s journey revealed a fundamental tension between the rigid structure of an ORM and the fluid nature of a document store. While the **Prisma Client** delivered an exceptional developer experience through type safety and IntelliSense, the **management of the schema** required a level of manual intervention that felt at odds with MongoDB’s flexible-schema promise. For Lucas, the takeaway was clear: Prisma is a powerful ally for standard operations, but it still struggles to fully bridge the gap when it comes to NoSQL-specific patterns like data migrations, polymorphic fields, and MongoDB’s advanced features.
