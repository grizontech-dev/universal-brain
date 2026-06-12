export type FileGenKind = "excel" | "xlsx" | "docx" | "word" | "markdown" | "md" | "pdf" | "txt" | "csv";

export type CanonicalKind = "excel" | "docx" | "markdown" | "pdf" | "txt" | "csv";

export interface FileKindSpec {
  canonicalKind: CanonicalKind;
  artifactType: "spreadsheet" | "document" | "pdf" | "markdown" | "csv";
  extension: string;
  mimeType: string;
}

const SPECS: Record<CanonicalKind, FileKindSpec> = {
  excel: {
    canonicalKind: "excel",
    artifactType: "spreadsheet",
    extension: ".xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  docx: {
    canonicalKind: "docx",
    artifactType: "document",
    extension: ".docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  pdf: {
    canonicalKind: "pdf",
    artifactType: "pdf",
    extension: ".pdf",
    mimeType: "application/pdf",
  },
  markdown: {
    canonicalKind: "markdown",
    artifactType: "markdown",
    extension: ".md",
    mimeType: "text/markdown; charset=utf-8",
  },
  txt: {
    canonicalKind: "txt",
    artifactType: "markdown",
    extension: ".txt",
    mimeType: "text/plain; charset=utf-8",
  },
  csv: {
    canonicalKind: "csv",
    artifactType: "csv",
    extension: ".csv",
    mimeType: "text/csv; charset=utf-8",
  },
};

export function normalizeKind(raw: string): CanonicalKind | null {
  const k = raw.toLowerCase().trim();
  if (k === "excel" || k === "xlsx") return "excel";
  if (k === "docx" || k === "word") return "docx";
  if (k === "markdown" || k === "md") return "markdown";
  if (k === "pdf") return "pdf";
  if (k === "txt") return "txt";
  if (k === "csv") return "csv";
  return null;
}

export function specForKind(kind: CanonicalKind): FileKindSpec {
  return SPECS[kind];
}

/**
 * Map a stored artifact `type` (the DB column) back to a kind spec.
 * Used by the download handler, which only has access to the artifact row.
 */
export function specForArtifactType(artifactType: string): FileKindSpec | null {
  switch (artifactType) {
    case "spreadsheet": return SPECS.excel;
    case "document":    return SPECS.docx;
    case "pdf":         return SPECS.pdf;
    case "markdown":    return SPECS.markdown;
    case "csv":         return SPECS.csv;
    default:            return null;
  }
}

const KNOWN_EXTENSIONS = [
  ".xlsx", ".xls",
  ".docx", ".doc",
  ".pdf",
  ".md", ".markdown",
  ".txt",
  ".csv",
];

/** Strip a trailing known file extension from a user/LLM-supplied title. */
export function stripKnownExtension(title: string): string {
  const lower = title.toLowerCase();
  for (const ext of KNOWN_EXTENSIONS) {
    if (lower.endsWith(ext)) return title.slice(0, -ext.length);
  }
  return title;
}

/**
 * Sanitize a title to a safe basename (no extension).
 * Keeps alphanumerics, underscores, hyphens, dots, and spaces; replaces others with `_`.
 * Collapses repeated whitespace, trims, and caps length.
 */
export function sanitizeTitle(title: string, maxLength = 120): string {
  const cleaned = title
    .replace(/[^a-zA-Z0-9_\-. ]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLength);
}

/**
 * Build the user-facing filename from a (possibly already-sanitized) title and a kind spec.
 * Guards against double-extension if the title already ends with the kind's extension.
 */
export function buildFilename(title: string, spec: FileKindSpec): string {
  const ext = spec.extension;
  if (title.toLowerCase().endsWith(ext)) return title;
  return `${title}${ext}`;
}
