import { createHash } from 'node:crypto';

function inline(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(inline).join('');
  }
  if (!value || typeof value !== 'object') {
    return '';
  }
  const node = value as Record<string, unknown>;
  if (typeof node.text === 'string') {
    return node.text;
  }
  if (Array.isArray(node.rows)) {
    return node.rows
      .map((row) => {
        const cells = (row as { cells?: unknown[] })?.cells;
        return cells?.map(inline).join('\t') ?? '';
      })
      .join('\n');
  }
  return inline(node.content);
}

export function blockNoteText(value: unknown): string {
  if (!Array.isArray(value)) {
    return '';
  }
  return value
    .map((block) => {
      if (!block || typeof block !== 'object') {
        return '';
      }
      const node = block as Record<string, unknown>;
      return [inline(node.content), blockNoteText(node.children)].filter(Boolean).join('\n');
    })
    .filter(Boolean)
    .join('\n');
}

export function taskEmbeddingDocument(task: {
  id: string;
  title: string;
  brief: string | null;
  firstStep: string | null;
  tags: string[];
  content: unknown;
  updatedAt: Date;
}) {
  const text = [
    `Title: ${task.title.trim()}`,
    task.brief?.trim() && `Description: ${task.brief.trim()}`,
    task.firstStep?.trim() && `First step: ${task.firstStep.trim()}`,
    task.tags.length && `Tags: ${[...task.tags].sort().join(', ')}`,
    blockNoteText(task.content),
  ]
    .filter(Boolean)
    .join('\n');
  return {
    id: task.id,
    text,
    sourceHash: createHash('sha256').update(text).digest('hex'),
    updatedAt: task.updatedAt,
  };
}
