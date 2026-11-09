import {
  fetchBookDetail,
  type LibibDetail,
} from './libib-detail.js';
import {
  fetchCatalogueIndex,
  type LibibIndexItem,
} from './libib-index.js';

export interface LibibAdapter {
  fetchIndex(): Promise<LibibIndexItem[]>;
  fetchDetail(joinId: string): Promise<LibibDetail | null>;
}

export interface LibibAdapterOptions {
  baseUrl?: string;
  libraryId?: string;
  indexDelayMs?: number;
}

export function createLibibAdapter(
  options: LibibAdapterOptions = {},
): LibibAdapter {
  return {
    fetchIndex: () =>
      fetchCatalogueIndex({
        baseUrl: options.baseUrl,
        libraryId: options.libraryId,
        delayMs: options.indexDelayMs,
      }),
    fetchDetail: (joinId) =>
      fetchBookDetail(joinId, { baseUrl: options.baseUrl }),
  };
}
