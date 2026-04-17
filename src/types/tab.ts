import type { JSONContent } from '@tiptap/react';

export interface Frontmatter {
  [key: string]: unknown;
}

export interface Tab {
  id: string;
  /** Virtual tab type — 'diff' for diff overlay tabs; undefined for file tabs */
  type?: string;
  path: string;
  name: string;
  content: string | JSONContent | null;
  tiptapJSON: JSONContent | null;
  isDirty: boolean;
  isQuipu: boolean;
  isMarkdown: boolean;
  isMedia?: boolean;
  isPdf?: boolean;
  isNotebook?: boolean;
  scrollPosition: number;
  frontmatter: Frontmatter | null;
  frontmatterRaw: string | null;
  diskContent: string | null;
  frontmatterCollapsed: boolean;
  hasConflict?: boolean;
  conflictDiskContent?: string | null;
  reloadKey?: number;
}

export interface ActiveFile {
  path: string;
  name: string;
  content: string | JSONContent | null;
  isQuipu: boolean;
}
