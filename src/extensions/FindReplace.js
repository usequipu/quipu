import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const FindReplaceKey = new PluginKey('findReplace');

function getMatchPositions(doc, term) {
  if (!term) return [];
  const matches = [];
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedTerm, 'gi');

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    let match;
    while ((match = regex.exec(node.text)) !== null) {
      matches.push({ from: pos + match.index, to: pos + match.index + match[0].length });
    }
  });
  return matches;
}

function buildDecorations(doc, matches, currentIndex) {
  if (!matches.length) return DecorationSet.empty;
  const decorations = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === currentIndex ? 'find-highlight-current' : 'find-highlight',
    })
  );
  return DecorationSet.create(doc, decorations);
}

export const FindReplace = Extension.create({
  name: 'findReplace',

  addStorage() {
    return { term: '', totalMatches: 0, currentIndex: -1 };
  },

  addCommands() {
    return {
      setFindTerm: (term) => ({ state, dispatch, editor }) => {
        const matches = getMatchPositions(state.doc, term);
        editor.storage.findReplace.term = term;
        editor.storage.findReplace.totalMatches = matches.length;
        editor.storage.findReplace.currentIndex = matches.length > 0 ? 0 : -1;
        const { tr } = state;
        tr.setMeta(FindReplaceKey, { term, matches, currentIndex: matches.length > 0 ? 0 : -1 });
        if (dispatch) dispatch(tr);
        // Scroll to first match
        if (matches.length > 0) {
          const { from } = matches[0];
          editor.commands.setTextSelection({ from, to: from });
        }
        return true;
      },

      findNext: () => ({ state, dispatch, editor }) => {
        const pluginState = FindReplaceKey.getState(state);
        if (!pluginState || !pluginState.matches.length) return false;
        const nextIndex = (pluginState.currentIndex + 1) % pluginState.matches.length;
        editor.storage.findReplace.currentIndex = nextIndex;
        const { tr } = state;
        tr.setMeta(FindReplaceKey, { ...pluginState, currentIndex: nextIndex });
        if (dispatch) dispatch(tr);
        const { from } = pluginState.matches[nextIndex];
        editor.commands.setTextSelection({ from, to: from });
        return true;
      },

      findPrev: () => ({ state, dispatch, editor }) => {
        const pluginState = FindReplaceKey.getState(state);
        if (!pluginState || !pluginState.matches.length) return false;
        const prevIndex = (pluginState.currentIndex - 1 + pluginState.matches.length) % pluginState.matches.length;
        editor.storage.findReplace.currentIndex = prevIndex;
        const { tr } = state;
        tr.setMeta(FindReplaceKey, { ...pluginState, currentIndex: prevIndex });
        if (dispatch) dispatch(tr);
        const { from } = pluginState.matches[prevIndex];
        editor.commands.setTextSelection({ from, to: from });
        return true;
      },

      clearFind: () => ({ state, dispatch, editor }) => {
        editor.storage.findReplace.term = '';
        editor.storage.findReplace.totalMatches = 0;
        editor.storage.findReplace.currentIndex = -1;
        const { tr } = state;
        tr.setMeta(FindReplaceKey, { term: '', matches: [], currentIndex: -1 });
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: FindReplaceKey,
        state: {
          init() {
            return { term: '', matches: [], currentIndex: -1, decorations: DecorationSet.empty };
          },
          apply(tr, pluginState) {
            const meta = tr.getMeta(FindReplaceKey);
            if (meta !== undefined) {
              const { term, matches, currentIndex } = meta;
              return {
                term: term || '',
                matches: matches || [],
                currentIndex: currentIndex ?? -1,
                decorations: buildDecorations(tr.doc, matches || [], currentIndex ?? -1),
              };
            }
            if (tr.docChanged) {
              // Re-run search when doc changes to keep matches fresh
              const matches = getMatchPositions(tr.doc, pluginState.term);
              const currentIndex = Math.min(pluginState.currentIndex, matches.length - 1);
              return {
                ...pluginState,
                matches,
                currentIndex,
                decorations: buildDecorations(tr.doc, matches, currentIndex),
              };
            }
            return pluginState;
          },
        },
        props: {
          decorations(state) {
            return FindReplaceKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
