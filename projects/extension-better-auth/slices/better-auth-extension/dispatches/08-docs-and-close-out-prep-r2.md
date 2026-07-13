# Brief: D8 R2 (resumed) — F5

- **F5 (should-fix):** ADR 231 worked-example snippet shows `collection.create(decodeInput(fields, data))` — `decodeInput` does not exist; the as-built flow is `assertKnownFields(...)` then `collection.create(data)` (codecs cross inside the collection, per the ADR own obligation 2). Correct the snippet to the as-built shape.

Gates: none beyond a re-read; docs-only.
