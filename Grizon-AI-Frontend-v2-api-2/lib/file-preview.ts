/**
 * Lightweight client-side previews for Office Open XML (DOCX / XLSX) using JSZip.
 */

import JSZip from 'jszip';

const MAX_DOCX_PARAGRAPHS = 500;
const MAX_SPREADSHEET_ROWS = 200;
const MAX_SPREADSHEET_COLS = 50;

export type SpreadsheetPreview = {
  rows: string[][];
  truncated: boolean;
  totalRows?: number;
  totalCols?: number;
};

export type OfficePreviewResult =
  | { kind: 'docx'; paragraphs: string[]; truncated: boolean }
  | { kind: 'spreadsheet'; table: SpreadsheetPreview };

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Strip XML tags and collapse whitespace from a fragment. */
function stripXmlTags(xml: string): string {
  return decodeXmlEntities(xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

async function readZipEntry(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  return entry.async('string');
}

/** Extract paragraph text from word/document.xml. */
function parseDocxDocumentXml(xml: string): string[] {
  const paragraphs: string[] = [];
  const pRegex = /<w:p[\s>][\s\S]*?<\/w:p>/gi;
  let match: RegExpExecArray | null;
  while ((match = pRegex.exec(xml)) !== null) {
    const pXml = match[0];
    const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/gi;
    const parts: string[] = [];
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(pXml)) !== null) {
      const raw = tMatch[1] ?? '';
      if (raw) parts.push(decodeXmlEntities(raw));
    }
    const line = parts.join('').trim();
    if (line) paragraphs.push(line);
    if (paragraphs.length >= MAX_DOCX_PARAGRAPHS) break;
  }
  if (paragraphs.length === 0) {
    const fallback = stripXmlTags(xml);
    if (fallback) paragraphs.push(fallback.slice(0, 8000));
  }
  return paragraphs;
}

export async function previewDocxFromBlob(blob: Blob): Promise<OfficePreviewResult> {
  const buf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const docXml = await readZipEntry(zip, 'word/document.xml');
  if (!docXml) {
    throw new Error('Invalid DOCX: missing word/document.xml');
  }
  const paragraphs = parseDocxDocumentXml(docXml);
  const truncated = /<w:p[\s>]/gi.test(docXml) && paragraphs.length >= MAX_DOCX_PARAGRAPHS;
  return {
    kind: 'docx',
    paragraphs: paragraphs.length ? paragraphs : ['(Empty document)'],
    truncated,
  };
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siRegex = /<si[\s>][\s\S]*?<\/si>/gi;
  let match: RegExpExecArray | null;
  while ((match = siRegex.exec(xml)) !== null) {
    const si = match[0];
    const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/gi;
    const parts: string[] = [];
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(si)) !== null) {
      parts.push(decodeXmlEntities(tMatch[1] ?? ''));
    }
    strings.push(parts.join('') || stripXmlTags(si));
  }
  return strings;
}

/** Column index from cell ref like "B3" -> 1 (0-based). */
function colIndexFromRef(ref: string): number {
  const letters = ref.replace(/[0-9]/g, '').toUpperCase();
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, n - 1);
}

function rowIndexFromRef(ref: string): number {
  const digits = ref.replace(/[^0-9]/g, '');
  return Math.max(0, parseInt(digits, 10) - 1);
}

function parseSheetXml(
  sheetXml: string,
  sharedStrings: string[],
): { rows: string[][]; maxRow: number; maxCol: number } {
  const sparse = new Map<string, string>();
  let maxRow = 0;
  let maxCol = 0;

  const rowRegex = /<row[^>]*\sr="(\d+)"[^>]*>([\s\S]*?)<\/row>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowNum = parseInt(rowMatch[1], 10);
    const rowContent = rowMatch[2];
    const cellRegex = /<c\s([^>]*)\/?>(?:<v>([\s\S]*?)<\/v>)?/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const attrs = cellMatch[1];
      const value = cellMatch[2] ?? '';
      const rMatch = /\sr="([^"]+)"/.exec(attrs);
      const ref = rMatch?.[1] ?? `A${rowNum}`;
      const tMatch = /\st="([^"]+)"/.exec(attrs);
      const cellType = tMatch?.[1];
      let text = value.trim();
      if (cellType === 's' && sharedStrings.length) {
        const idx = parseInt(text, 10);
        text = Number.isFinite(idx) ? (sharedStrings[idx] ?? '') : '';
      } else if (cellType === 'inlineStr') {
        const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cellMatch[0]);
        text = inline ? decodeXmlEntities(inline[1]) : stripXmlTags(cellMatch[0]);
      } else {
        text = decodeXmlEntities(text);
      }
      const r = rowNum - 1;
      const c = colIndexFromRef(ref);
      sparse.set(`${r},${c}`, text);
      maxRow = Math.max(maxRow, r);
      maxCol = Math.max(maxCol, c);
    }
  }

  if (sparse.size === 0) {
    const cellRegex = /<c\s([^>]*)\/?>(?:<v>([\s\S]*?)<\/v>)?/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(sheetXml)) !== null) {
      const attrs = cellMatch[1];
      const value = cellMatch[2] ?? '';
      const rMatch = /\sr="([^"]+)"/.exec(attrs);
      const ref = rMatch?.[1] ?? 'A1';
      const tMatch = /\st="([^"]+)"/.exec(attrs);
      const cellType = tMatch?.[1];
      let text = value.trim();
      if (cellType === 's' && sharedStrings.length) {
        const idx = parseInt(text, 10);
        text = Number.isFinite(idx) ? (sharedStrings[idx] ?? '') : '';
      } else {
        text = decodeXmlEntities(text);
      }
      const r = rowIndexFromRef(ref);
      const c = colIndexFromRef(ref);
      sparse.set(`${r},${c}`, text);
      maxRow = Math.max(maxRow, r);
      maxCol = Math.max(maxCol, c);
    }
  }

  const rowCount = Math.min(maxRow + 1, MAX_SPREADSHEET_ROWS);
  const colCount = Math.min(maxCol + 1, MAX_SPREADSHEET_COLS);
  const rows: string[][] = [];
  for (let r = 0; r < rowCount; r++) {
    const row: string[] = [];
    for (let c = 0; c < colCount; c++) {
      row.push(sparse.get(`${r},${c}`) ?? '');
    }
    rows.push(row);
  }

  return { rows, maxRow: maxRow + 1, maxCol: maxCol + 1 };
}

async function findFirstWorksheetPath(zip: JSZip): Promise<string | null> {
  const names = Object.keys(zip.files).filter(
    (n) => n.startsWith('xl/worksheets/sheet') && n.endsWith('.xml'),
  );
  names.sort();
  return names[0] ?? null;
}

export async function previewXlsxFromBlob(blob: Blob): Promise<OfficePreviewResult> {
  const buf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const sheetPath = await findFirstWorksheetPath(zip);
  if (!sheetPath) {
    throw new Error('Invalid XLSX: no worksheet found');
  }
  const sheetXml = await readZipEntry(zip, sheetPath);
  if (!sheetXml) {
    throw new Error('Invalid XLSX: could not read worksheet');
  }
  const sharedXml = await readZipEntry(zip, 'xl/sharedStrings.xml');
  const sharedStrings = sharedXml ? parseSharedStrings(sharedXml) : [];
  const { rows, maxRow, maxCol } = parseSheetXml(sheetXml, sharedStrings);
  const truncated = maxRow > MAX_SPREADSHEET_ROWS || maxCol > MAX_SPREADSHEET_COLS;
  return {
    kind: 'spreadsheet',
    table: {
      rows: rows.length ? rows : [['(Empty sheet)']],
      truncated,
      totalRows: maxRow,
      totalCols: maxCol,
    },
  };
}

function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

export async function previewCsvFromBlob(blob: Blob): Promise<OfficePreviewResult> {
  const text = await blob.text();
  const parsedRows = parseCsvText(text);
  const maxCols = parsedRows.reduce((max, r) => Math.max(max, r.length), 0);

  const cappedRowCount = Math.min(parsedRows.length, MAX_SPREADSHEET_ROWS);
  const cappedColCount = Math.min(maxCols, MAX_SPREADSHEET_COLS);

  const rows = Array.from({ length: cappedRowCount }, (_, rowIdx) => {
    const source = parsedRows[rowIdx] ?? [];
    return Array.from({ length: cappedColCount }, (_, colIdx) => source[colIdx] ?? '');
  });

  const truncated =
    parsedRows.length > MAX_SPREADSHEET_ROWS || maxCols > MAX_SPREADSHEET_COLS;

  return {
    kind: 'spreadsheet',
    table: {
      rows: rows.length ? rows : [['(Empty sheet)']],
      truncated,
      totalRows: parsedRows.length,
      totalCols: maxCols,
    },
  };
}

export async function previewOfficeBlob(
  blob: Blob,
  format: 'docx' | 'xlsx' | 'csv',
): Promise<OfficePreviewResult> {
  if (format === 'docx') return previewDocxFromBlob(blob);
  if (format === 'csv') return previewCsvFromBlob(blob);
  return previewXlsxFromBlob(blob);
}
