---
from: "0.12"
to: "0.13"
changes: []
---

<!--
TML-2808: substrate change to the SQL/Mongo contract IR — storage
namespaces gained an `entries.<kind>` envelope and domain
cross-references (`base`, `relations.<R>.to`) lifted from bare model
strings to `{ namespace, model }` objects. Extension authors only feel
this if they hand-construct contract IR; the public framework
factories (`createNamespaceTable`, `crossRef`, etc.) and the
contract-builder produce the new shape directly. No codemod required.

TML-2817: internal refactor of @prisma-next/extension-mongo's
defineContract wrapper to eliminate bare casts via a shared bound
contract builder. No extension API or behaviour change; incidental
substrate diff only.
-->
