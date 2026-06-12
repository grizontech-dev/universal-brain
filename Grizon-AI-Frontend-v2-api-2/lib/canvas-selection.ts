/** Identifies an item opened in the Canvas file viewer. */
export type CanvasItemKind = 'file' | 'artifact';

export interface CanvasSelectedItem {
  kind: CanvasItemKind;
  id: string;
  label: string;
  mimeType?: string;
  /** DB artifact `type` when kind === 'artifact'. */
  artifactType?: string;
  sizeBytes?: number;
}

export function canvasItemKey(item: CanvasSelectedItem): string {
  return `${item.kind}:${item.id}`;
}
