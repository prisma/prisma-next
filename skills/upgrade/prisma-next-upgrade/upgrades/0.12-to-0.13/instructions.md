---
from: "0.12"
to: "0.13"
changes: []
---

<!--
TML-2808: the SQL/Mongo contract storage IR moved to a namespace
envelope (`namespaces.<ns>.entries.<kind>`) and lifted cross-references
from bare strings to `{ namespace, model }` objects in `domain`.
Consumer impact is incidental: re-emitting `contract.json` /
`contract.d.ts` via the existing `prisma-next contract emit` produces
the new shape with no source change. No codemod is required.
-->
