export interface CsvRow {
  line: number;
  fields: string[];
}

export function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  const pushRow = (): void => {
    const rowFields = [...fields, field];
    if (rowFields.some((value) => value.trim() !== '')) {
      rows.push({ line: rowStartLine, fields: rowFields });
    }
    fields = [];
    field = '';
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      fields.push(field);
      field = '';
      continue;
    }

    if (char === '\n') {
      pushRow();
      line += 1;
      rowStartLine = line;
      continue;
    }

    if (char === '\r') {
      continue;
    }

    field += char;
  }

  if (field !== '' || fields.length > 0) {
    pushRow();
  }

  return rows;
}

export function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function csvLine(values: readonly string[]): string {
  return values.map(csvEscape).join(',');
}
