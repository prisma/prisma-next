# Brief — reword the unrecognized-namespace diagnostic

When a PSL file uses a namespaced attribute (e.g. `@pgvector.vector`) but that namespace is not available in the project config, the interpreter emits a diagnostic. A user reported that the current message — "namespace not composed" — is confusing: it doesn't name the offending namespace and doesn't tell them what to do.

Please improve the diagnostic so it:

1. Names the namespace explicitly (the one the user referenced).
2. Tells the user how to fix it — add the corresponding extension pack to `extensionPacks` in `prisma-next.config.ts`.
3. Avoids the phrase "namespace not composed"; prefer clear wording such as "unrecognized namespace" / "namespace is not available".

This is a copy change to an existing diagnostic plus its test. No behaviour change beyond the message text.
