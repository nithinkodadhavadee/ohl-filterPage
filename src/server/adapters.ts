import { EnrichmentAdapterRegistry } from './enrichment.js';
import { OpenLibraryAdapter } from './openlibrary.js';

export function createAdapterRegistry(): EnrichmentAdapterRegistry {
  return new EnrichmentAdapterRegistry([new OpenLibraryAdapter()]);
}
