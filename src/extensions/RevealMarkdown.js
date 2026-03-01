import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const revealMarkdownKey = new PluginKey('revealMarkdown');

// Map of mark types to their markdown syntax characters
const MARK_SYNTAX = {
  bold:   { open: '**', close: '**' },
  italic: { open: '*',  close: '*' },
  strike: { open: '~~', close: '~~' },
  code:   { open: '`',  close: '`' },
};

/**
 * Find the range of a mark around a resolved position.
 * Walks backward and forward through siblings to find the full extent.
 */
function getMarkRange($pos, markType) {
  const { parent } = $pos;
  const parentStart = $pos.start();

  // Find which child index the cursor is in
  let startIndex = null;
  let endIndex = null;
  let offset = 0;

  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childEnd = offset + child.nodeSize;

    if ($pos.parentOffset >= offset && $pos.parentOffset <= childEnd) {
      // Cursor is inside this child - check if it has the mark
      if (!markType.isInSet(child.marks)) return null;
      startIndex = i;
      endIndex = i;
      break;
    }
    offset = childEnd;
  }

  if (startIndex === null) return null;

  // Walk backward to find mark start
  while (startIndex > 0) {
    const prev = parent.child(startIndex - 1);
    if (!markType.isInSet(prev.marks)) break;
    startIndex--;
  }

  // Walk forward to find mark end
  while (endIndex < parent.childCount - 1) {
    const next = parent.child(endIndex + 1);
    if (!markType.isInSet(next.marks)) break;
    endIndex++;
  }

  // Calculate positions
  let from = parentStart;
  for (let i = 0; i < startIndex; i++) {
    from += parent.child(i).nodeSize;
  }

  let to = from;
  for (let i = startIndex; i <= endIndex; i++) {
    to += parent.child(i).nodeSize;
  }

  return from < to ? { from, to } : null;
}

/**
 * Create a widget decoration element with the given text and CSS class.
 */
function createSyntaxWidget(text, extraClass = '') {
  const span = document.createElement('span');
  span.className = `reveal-syntax${extraClass ? ' ' + extraClass : ''}`;
  span.textContent = text;
  span.contentEditable = 'false';
  return span;
}

export const RevealMarkdown = Extension.create({
  name: 'revealMarkdown',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: revealMarkdownKey,
        props: {
          decorations(state) {
            const { $from, empty } = state.selection;
            const decorations = [];

            // --- Block-level prefix (heading, blockquote, list) ---
            const parentNode = $from.parent;
            const parentTypeName = parentNode.type.name;

            if (parentTypeName === 'heading') {
              const level = parentNode.attrs.level || 1;
              const prefix = '#'.repeat(level) + ' ';
              const startPos = $from.before($from.depth);
              decorations.push(
                Decoration.widget(startPos + 1, () => createSyntaxWidget(prefix, 'reveal-prefix'), { side: -1 })
              );
            }

            if (parentTypeName === 'paragraph' && $from.depth >= 2) {
              const grandparent = $from.node($from.depth - 1);
              if (grandparent.type.name === 'blockquote') {
                const startPos = $from.before($from.depth);
                decorations.push(
                  Decoration.widget(startPos + 1, () => createSyntaxWidget('> ', 'reveal-prefix'), { side: -1 })
                );
              }
              if (grandparent.type.name === 'listItem') {
                const listNode = $from.depth >= 3 ? $from.node($from.depth - 2) : null;
                const prefix = listNode?.type.name === 'orderedList' ? '1. ' : '- ';
                const startPos = $from.before($from.depth);
                decorations.push(
                  Decoration.widget(startPos + 1, () => createSyntaxWidget(prefix, 'reveal-prefix'), { side: -1 })
                );
              }
            }

            // Horizontal rule — if selection is on an HR node
            if (parentTypeName === 'horizontalRule' || (
              !empty && state.selection.node?.type.name === 'horizontalRule'
            )) {
              // HR is a leaf node, decorations are tricky. Skip for now.
            }

            // Code block fences
            if (parentTypeName === 'codeBlock') {
              const lang = parentNode.attrs.language || '';
              const startPos = $from.before($from.depth);
              const endPos = $from.after($from.depth);

              decorations.push(
                Decoration.widget(startPos + 1, () => {
                  const el = document.createElement('div');
                  el.className = 'reveal-syntax reveal-fence';
                  el.textContent = '```' + lang;
                  el.contentEditable = 'false';
                  return el;
                }, { side: -1 }),
                Decoration.widget(endPos - 1, () => {
                  const el = document.createElement('div');
                  el.className = 'reveal-syntax reveal-fence';
                  el.textContent = '```';
                  el.contentEditable = 'false';
                  return el;
                }, { side: 1 })
              );
            }

            // --- Inline mark decorations ---
            const marks = $from.marks();

            for (const mark of marks) {
              const syntax = MARK_SYNTAX[mark.type.name];
              if (!syntax) continue;

              const markRange = getMarkRange($from, mark.type);
              if (!markRange) continue;

              decorations.push(
                Decoration.widget(markRange.from, () => createSyntaxWidget(syntax.open, 'reveal-open'), { side: -1 }),
                Decoration.widget(markRange.to, () => createSyntaxWidget(syntax.close, 'reveal-close'), { side: 1 })
              );
            }

            // Link syntax (special case — shows [text](url))
            const linkMark = marks.find(m => m.type.name === 'link');
            if (linkMark) {
              const markRange = getMarkRange($from, linkMark.type);
              if (markRange) {
                decorations.push(
                  Decoration.widget(markRange.from, () => createSyntaxWidget('[', 'reveal-open'), { side: -1 }),
                  Decoration.widget(markRange.to, () => createSyntaxWidget(`](${linkMark.attrs.href})`, 'reveal-close'), { side: 1 })
                );
              }
            }

            if (decorations.length === 0) return DecorationSet.empty;
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
