import { describe, expect, it } from 'vitest';
import type { LibibIndexItem } from '../src/server/libib-index.js';
import {
  isFromAOnward,
  selectSample,
  titleSortKey,
} from '../src/server/sample.js';

function item(title: string, joinId = title): LibibIndexItem {
  return { joinId, title, author: null, coverUrl: null };
}

describe('titleSortKey', () => {
  it('ignores leading articles and decodes entities', () => {
    expect(titleSortKey('The Absent Color: Poems')).toBe('absent color: poems');
    expect(titleSortKey('A Brief History')).toBe('brief history');
    expect(titleSortKey('An Introduction')).toBe('introduction');
    expect(titleSortKey('Anne of Green Gables')).toBe('anne of green gables');
    expect(titleSortKey('Kavalier &amp; Clay')).toBe('kavalier & clay');
  });
});

describe('isFromAOnward', () => {
  it('excludes digits and symbols but keeps articles that sort at A', () => {
    expect(isFromAOnward('1984')).toBe(false);
    expect(isFromAOnward('#hashtag')).toBe(false);
    expect(isFromAOnward('&symbols')).toBe(false);
    expect(isFromAOnward('The Absent Color: Poems')).toBe(true);
    expect(isFromAOnward('A Brief History')).toBe(true);
    expect(isFromAOnward('An Introduction')).toBe(true);
  });
});

describe('selectSample', () => {
  it('skips titles that sort before A and keeps returned order', () => {
    const sample = selectSample([
      item('1984'),
      item('#hashtag'),
      item('The Absent Color: Poems'),
      item('Abundance'),
      item('&symbols'),
      item('Beloved'),
    ]);

    expect(sample.map((entry) => entry.title)).toEqual([
      'The Absent Color: Poems',
      'Abundance',
      'Beloved',
    ]);
  });

  it('caps the sample at 50 even when more titles are available', () => {
    const index = Array.from({ length: 60 }, (_, number) =>
      item(`Alpha ${String(number + 1).padStart(2, '0')}`),
    );

    const sample = selectSample(index);

    expect(sample).toHaveLength(50);
    expect(sample[0].title).toBe('Alpha 01');
    expect(sample[49].title).toBe('Alpha 50');
  });

  it('continues past J when fewer than 50 titles sort up to J', () => {
    const beforeJ = Array.from({ length: 30 }, (_, number) =>
      item(`Alpha ${String(number + 1).padStart(2, '0')}`),
    );
    const afterJ = Array.from({ length: 30 }, (_, number) =>
      item(`Kappa ${String(number + 1).padStart(2, '0')}`),
    );

    const sample = selectSample([...beforeJ, ...afterJ]);

    expect(sample).toHaveLength(50);
    expect(sample.slice(0, 30).map((entry) => entry.title)).toEqual(
      beforeJ.map((entry) => entry.title),
    );
    expect(sample.slice(30).every((entry) => entry.title.startsWith('Kappa'))).toBe(
      true,
    );
  });

  it('returns the whole index when the size is zero or negative', () => {
    const index = [item('1984'), item('#hashtag'), item('Abundance')];

    expect(selectSample(index, 0).map((entry) => entry.title)).toEqual([
      '1984',
      '#hashtag',
      'Abundance',
    ]);
    expect(selectSample(index, -1)).toHaveLength(3);
  });

  it('returns everything from A onward when fewer than 50 are available', () => {
    const index = [
      item('1984'),
      ...Array.from({ length: 10 }, (_, number) =>
        item(`Alpha ${String(number + 1).padStart(2, '0')}`),
      ),
    ];

    const sample = selectSample(index);

    expect(sample).toHaveLength(10);
    expect(sample[0].title).toBe('Alpha 01');
  });
});
