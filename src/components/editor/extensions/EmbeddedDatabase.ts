import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import fs from '../../../services/fileSystem';

/**
 * TipTap node extension for inline-embedded databases.
 * Renders a live preview of the database table inside the document.
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
      wrapper.className = 'embedded-database-wrapper my-4 rounded-lg border border-border/30 overflow-hidden';
      wrapper.setAttribute('data-type', 'embedded-database');
      wrapper.contentEditable = 'false';

      const src = node.attrs.src as string;
      const fileName = src?.split('/').pop() || 'database';
      const displayName = fileName.replace('.quipudb.jsonl', '');

      // Header bar (clickable to open)
      const header = document.createElement('div');
      header.className = 'flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-page-text/[0.03] transition-colors';
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

      // Table container
      const tableContainer = document.createElement('div');
      tableContainer.className = 'px-0 pb-2 overflow-x-auto';
      tableContainer.style.maxHeight = '320px';
      tableContainer.style.overflowY = 'auto';
      wrapper.appendChild(tableContainer);

      // Load the database file and render inline
      loadDatabase(src, tableContainer, displayName);

      return { dom: wrapper, contentDOM: undefined };
    };
  },
});

/**
 * Load a .quipudb.jsonl file and render a simple HTML table preview.
 */
async function loadDatabase(src: string, container: HTMLElement, displayName: string) {
  // Resolve relative path using workspace path
  const workspacePath = (document.querySelector('[data-workspace-path]') as HTMLElement)?.dataset.workspacePath;
  const fullPath = workspacePath && !src.startsWith('/') ? `${workspacePath}/${src}` : src;

  try {
    const content = await fs.readFile(fullPath);
    const lines = content.split('\n').filter((l: string) => l.trim());
    if (lines.length === 0) {
      container.innerHTML = '<div style="padding:16px;text-align:center;opacity:0.4;font-size:13px">Empty database</div>';
      return;
    }

    const schemaLine = JSON.parse(lines[0]);
    const schema = schemaLine._schema;
    if (!schema) {
      container.innerHTML = '<div style="padding:16px;text-align:center;opacity:0.4;font-size:13px">Invalid database format</div>';
      return;
    }

    const columns = schema.columns || [];
    const rows = lines.slice(1).map((l: string) => JSON.parse(l));

    if (columns.length === 0) {
      container.innerHTML = '<div style="padding:16px;text-align:center;opacity:0.4;font-size:13px">No columns defined — click to open and configure</div>';
      return;
    }

    // Build HTML table
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const col of columns) {
      const th = document.createElement('th');
      th.style.cssText = 'text-align:left;padding:6px 12px;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;opacity:0.5;border-bottom:1px solid rgba(128,128,128,0.15)';
      th.textContent = col.name;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body (limit to 20 rows for preview)
    const tbody = document.createElement('tbody');
    const displayRows = rows.slice(0, 20);
    for (const row of displayRows) {
      const tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom:1px solid rgba(128,128,128,0.08)';
      for (const col of columns) {
        const td = document.createElement('td');
        td.style.cssText = 'padding:6px 12px;opacity:0.8';
        const val = row[col.id];
        td.innerHTML = formatCellPreview(val, col);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);

    // Show row count if truncated
    if (rows.length > 20) {
      const more = document.createElement('div');
      more.style.cssText = 'padding:8px 12px;font-size:11px;opacity:0.35;text-align:center';
      more.textContent = `${rows.length - 20} more rows — click header to open full view`;
      container.appendChild(more);
    }
  } catch {
    container.innerHTML = `<div style="padding:16px;text-align:center;opacity:0.4;font-size:13px">Could not load ${displayName}</div>`;
  }
}

function formatCellPreview(value: unknown, col: { type: string; options?: Array<{ value: string; color: string }> }): string {
  if (value == null) return '';

  switch (col.type) {
    case 'checkbox':
      return value ? '&#10003;' : '';
    case 'select': {
      const opt = col.options?.find(o => o.value === value);
      const color = opt?.color || '#6b7280';
      return `<span style="display:inline-block;padding:1px 8px;border-radius:99px;font-size:11px;font-weight:500;color:white;background:${color}">${String(value)}</span>`;
    }
    case 'multi-select': {
      if (!Array.isArray(value)) return String(value);
      return value.map(v => {
        const opt = col.options?.find(o => o.value === v);
        const color = opt?.color || '#6b7280';
        return `<span style="display:inline-block;padding:1px 8px;border-radius:99px;font-size:11px;font-weight:500;color:white;background:${color};margin-right:4px">${v}</span>`;
      }).join('');
    }
    case 'date':
      try { return new Date(String(value)).toLocaleDateString(); } catch { return String(value); }
    case 'number':
      return `<span style="font-variant-numeric:tabular-nums">${Number(value).toLocaleString()}</span>`;
    default:
      return String(value);
  }
}
