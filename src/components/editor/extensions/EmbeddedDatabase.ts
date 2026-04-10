import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import React from 'react';
import fs from '../../../services/fileSystem';

/**
 * TipTap node extension for inline-embedded databases.
 * Renders a live interactive DatabaseViewer inside the document.
 * Serializes to markdown as: ![[path/to/file.quipudb.jsonl]]
 */
export const EmbeddedDatabase = Node.create({
  name: 'embeddedDatabase',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-src'),
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-src': attributes.src,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="embedded-database"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'embedded-database',
      'class': 'embedded-database-node',
    }), 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: ProseMirrorNode) {
          const src = node.attrs.src || '';
          state.write(`![[${src}]]\n\n`);
        },
        parse: {},
      },
    };
  },

  addNodeView() {
    return ({ node }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'embedded-database-wrapper my-4 border-y border-border/30 overflow-hidden';
      wrapper.setAttribute('data-type', 'embedded-database');
      wrapper.contentEditable = 'false';

      const src = node.attrs.src as string;
      const fileName = src?.split('/').pop() || 'database';
      const displayName = fileName.replace('.quipudb.jsonl', '');

      // Header bar (clickable to open standalone view)
      const header = document.createElement('div');
      header.className = 'flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-page-text/[0.03] transition-colors border-b border-border/20';
      header.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" style="opacity:0.4;flex-shrink:0">
          <path d="M224,48H32A8,8,0,0,0,24,56V200a8,8,0,0,0,8,8H224a8,8,0,0,0,8-8V56A8,8,0,0,0,224,48Zm-8,16V96H40V64ZM40,112H88v32H40Zm0,48H88v32H40Zm176,32H104V112H216Zm0-80H104V80H216Z"/>
        </svg>
        <span style="font-weight:500;opacity:0.7">${displayName}</span>
        <span style="font-size:11px;opacity:0.3;margin-left:auto">${src}</span>
      `;
      header.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('quipu:open-embedded-database', { detail: { src } }));
      });
      wrapper.appendChild(header);

      // React container for DatabaseViewer
      const reactContainer = document.createElement('div');
      wrapper.appendChild(reactContainer);

      // Full-bleed: expand to fill the editor panel width (not just the 816px document column)
      let resizeObserver: ResizeObserver | null = null;

      const updateFullBleed = () => {
        const scrollContainer = wrapper.closest('[class*="overflow-y-auto"]') as HTMLElement | null;
        if (!scrollContainer) return;
        const containerLeft = scrollContainer.getBoundingClientRect().left;
        const wrapperLeft = wrapper.getBoundingClientRect().left;
        const offsetLeft = wrapperLeft - containerLeft;
        wrapper.style.width = `${scrollContainer.clientWidth}px`;
        wrapper.style.marginLeft = `-${offsetLeft}px`;
      };

      requestAnimationFrame(() => {
        updateFullBleed();
        const scrollContainer = wrapper.closest('[class*="overflow-y-auto"]') as HTMLElement | null;
        if (scrollContainer) {
          resizeObserver = new ResizeObserver(updateFullBleed);
          resizeObserver.observe(scrollContainer);
        }
      });

      // Mount DatabaseViewer
      let root: Root | null = null;
      mountDatabaseViewer(src, reactContainer).then(mountedRoot => {
        root = mountedRoot;
      });

      return {
        dom: wrapper,
        contentDOM: undefined,
        destroy() {
          resizeObserver?.disconnect();
          root?.unmount();
        },
      };
    };
  },
});

async function mountDatabaseViewer(src: string, container: HTMLElement): Promise<Root | null> {
  const workspaceEl = document.querySelector('[data-workspace-path]') as HTMLElement | null;
  const workspacePath = workspaceEl?.dataset.workspacePath;
  const fullPath = workspacePath && !src.startsWith('/') ? `${workspacePath}/${src}` : src;

  let content: string;
  try {
    content = await fs.readFile(fullPath);
  } catch {
    container.innerHTML = `<div style="padding:16px;text-align:center;opacity:0.4;font-size:13px">Could not load database</div>`;
    return null;
  }

  const { default: DatabaseViewer } = await import('@/extensions/database-viewer/DatabaseViewer');

  const onContentChange = async (newContent: string) => {
    try {
      await fs.writeFile(fullPath, newContent);
    } catch {
      // silently fail — inline edits are best-effort
    }
  };

  const root = createRoot(container);
  root.render(
    React.createElement(DatabaseViewer, {
      content,
      onContentChange,
      mode: 'inline',
    }),
  );
  return root;
}
