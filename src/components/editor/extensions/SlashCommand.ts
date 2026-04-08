import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import type { Editor, Range } from '@tiptap/core';

export interface SlashCommandItem {
  title: string;
  description: string;
  icon: string;
  category: string;
  command: (editor: Editor, range: Range) => void;
}

const SLASH_ITEMS: SlashCommandItem[] = [
  // Text blocks
  {
    title: 'Text',
    description: 'Plain paragraph text',
    icon: 'T',
    category: 'Basic',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setParagraph().run();
    },
  },
  {
    title: 'Heading 1',
    description: 'Large section heading',
    icon: 'H1',
    category: 'Basic',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run();
    },
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    icon: 'H2',
    category: 'Basic',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run();
    },
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    icon: 'H3',
    category: 'Basic',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run();
    },
  },
  // Lists
  {
    title: 'Bullet List',
    description: 'Unordered list with bullets',
    icon: '•',
    category: 'Lists',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: 'Numbered List',
    description: 'Ordered list with numbers',
    icon: '1.',
    category: 'Lists',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  // Blocks
  {
    title: 'Quote',
    description: 'Block quotation',
    icon: '"',
    category: 'Blocks',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setBlockquote().run();
    },
  },
  {
    title: 'Code Block',
    description: 'Fenced code with syntax highlighting',
    icon: '</>',
    category: 'Blocks',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setCodeBlock().run();
    },
  },
  {
    title: 'Horizontal Rule',
    description: 'Visual divider line',
    icon: '—',
    category: 'Blocks',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    title: 'Table',
    description: 'Insert a table',
    icon: '⊞',
    category: 'Blocks',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    },
  },
  // Media & Embeds
  {
    title: 'Image',
    description: 'Embed an image from URL',
    icon: '🖼',
    category: 'Media',
    command: (editor, range) => {
      const url = window.prompt('Image URL:');
      if (url) {
        editor.chain().focus().deleteRange(range).setImage({ src: url }).run();
      }
    },
  },
  // Database
  {
    title: 'Link Database',
    description: 'Embed an existing database file',
    icon: '⊞',
    category: 'Database',
    command: (editor, range) => {
      window.dispatchEvent(new CustomEvent('quipu:pick-database', {
        detail: {
          callback: (filePath: string) => {
            editor.chain().focus().deleteRange(range).insertContent({
              type: 'embeddedDatabase',
              attrs: { src: filePath },
            }).run();
          },
        },
      }));
    },
  },
  {
    title: 'Create Database',
    description: 'Create and embed a new database here',
    icon: '+⊞',
    category: 'Database',
    command: (editor, range) => {
      window.dispatchEvent(new CustomEvent('quipu:create-database', {
        detail: {
          callback: (filePath: string) => {
            editor.chain().focus().deleteRange(range).insertContent({
              type: 'embeddedDatabase',
              attrs: { src: filePath },
            }).run();
          },
        },
      }));
    },
  },
];

/**
 * TipTap extension that shows a slash command menu when the user types "/".
 * Pressing Escape inserts a literal "/" character.
 *
 * The popup rendering is handled externally via the `onRender` callbacks,
 * which the Editor component hooks into.
 */
export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions(): { suggestion: Record<string, any> } {
    return {
      suggestion: {
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }: { query: string }): SlashCommandItem[] => {
          const lower = query.toLowerCase();
          return SLASH_ITEMS.filter(item =>
            item.title.toLowerCase().includes(lower) ||
            item.description.toLowerCase().includes(lower) ||
            item.category.toLowerCase().includes(lower)
          );
        },
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashCommandItem }) => {
          props.command(editor, range);
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});

export { SLASH_ITEMS };
