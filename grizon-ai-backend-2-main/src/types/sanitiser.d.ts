export interface SanitiserPolicy {
  allowedFileTypes: Readonly<Record<string, readonly string[]>>;
  maxMessageLength: number;
  maxFileSize: number;
  injectionMode: "strip" | "reject";
}

export interface InjectionPattern {
  id: string;
  regex: RegExp;
  redaction: string;
}

export interface FilePartCheck {
  fieldName: string;
  fileName: string;
  mimeType: string;
  byteLength: number;
}

declare global {
  namespace Express {
    interface Request {
      files?: FilePartCheck[];
    }
    interface Locals {
      injectionMode?: "strip" | "reject";
    }
  }
}

export {};
