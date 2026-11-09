# Keep raw Open Library subjects and call them Subjects

Open Library returns subjects like "Fiction, psychological", "Textbooks for foreign speakers", or "nyt:hardcover-fiction=…" rather than a clean genre taxonomy. We expose them raw as filter vocabulary and label them Subjects, rather than curating a canonical genre list or commissioning classification. This accepts noisy, overlapping labels in exchange for zero curation effort and no loss of signal; a mapping layer can be added later without changing the stored data.

## Consequences

- The subject filter is a plain multi-select over a long, messy list rather than a dozen familiar genre chips.
- The interface must never call these filters "genres", or patrons will reasonably expect a proper taxonomy.
