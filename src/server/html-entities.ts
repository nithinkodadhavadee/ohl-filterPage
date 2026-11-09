const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '\u2026',
  ldquo: '\u201c',
  lsquo: '\u2018',
  lt: '<',
  mdash: '\u2014',
  nbsp: '\u00a0',
  ndash: '\u2013',
  quot: '"',
  rdquo: '\u201d',
  rsquo: '\u2019',
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g,
    (match, code: string) => {
      if (code.startsWith('#')) {
        const isHex = code[1]?.toLowerCase() === 'x';
        const numeric = Number.parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        return Number.isInteger(numeric) ? String.fromCodePoint(numeric) : match;
      }

      return NAMED_ENTITIES[code.toLowerCase()] ?? match;
    },
  );
}

export function decodeMaybe(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return decodeHtmlEntities(value);
}
