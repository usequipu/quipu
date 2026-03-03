import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const blockDragHandleKey = new PluginKey('blockDragHandle');

/**
 * Compute the range of an H1 section: the H1 node plus all subsequent nodes
 * until the next H1 or end of document.
 */
function getSectionRange(doc, nodeIndex) {
  let endIndex = nodeIndex + 1;
  for (let i = nodeIndex + 1; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (node.type.name === 'heading' && node.attrs.level === 1) break;
    endIndex = i + 1;
  }

  let from = 0;
  for (let i = 0; i < nodeIndex; i++) {
    from += doc.child(i).nodeSize;
  }

  let to = from;
  for (let i = nodeIndex; i < endIndex; i++) {
    to += doc.child(i).nodeSize;
  }

  return { from, to, startIndex: nodeIndex, endIndex };
}

/**
 * Get the range of a single top-level node by its index.
 */
function getNodeRange(doc, nodeIndex) {
  let from = 0;
  for (let i = 0; i < nodeIndex; i++) {
    from += doc.child(i).nodeSize;
  }
  const to = from + doc.child(nodeIndex).nodeSize;
  return { from, to, startIndex: nodeIndex, endIndex: nodeIndex + 1 };
}

/**
 * Get the drag range for a node. H1 headings drag their entire section.
 * All other top-level nodes drag only themselves.
 */
function getDragRange(doc, nodeIndex) {
  const node = doc.child(nodeIndex);
  if (node.type.name === 'heading' && node.attrs.level === 1) {
    return getSectionRange(doc, nodeIndex);
  }
  return getNodeRange(doc, nodeIndex);
}

/**
 * Find valid drop positions (between top-level blocks). Returns an array
 * of { pos, index } objects.
 */
function getDropPositions(doc) {
  const positions = [];
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    positions.push({ pos, index: i });
    pos += doc.child(i).nodeSize;
  }
  // After the last node
  positions.push({ pos, index: doc.childCount });
  return positions;
}

/**
 * Find the closest valid drop position to a given document position,
 * excluding positions within the source range.
 */
function findClosestDropTarget(doc, targetPos, sourceStartIndex, sourceEndIndex) {
  const positions = getDropPositions(doc);
  let closest = null;
  let closestDist = Infinity;

  for (const p of positions) {
    // Skip positions within the source block range
    if (p.index > sourceStartIndex && p.index < sourceEndIndex) continue;
    // Skip the position immediately before or after the source (no-op move)
    if (p.index === sourceStartIndex || p.index === sourceEndIndex) continue;

    const dist = Math.abs(p.pos - targetPos);
    if (dist < closestDist) {
      closestDist = dist;
      closest = p;
    }
  }

  return closest;
}

/**
 * Move a block range in a single ProseMirror transaction.
 */
function moveBlock(tr, from, to, targetPos) {
  const slice = tr.doc.slice(from, to);
  if (from < targetPos) {
    // Moving down: delete first, then insert at adjusted position
    tr.delete(from, to);
    const mappedTarget = targetPos - (to - from);
    tr.insert(mappedTarget, slice.content);
  } else {
    // Moving up: delete first, then insert at target
    tr.delete(from, to);
    tr.insert(targetPos, slice.content);
  }
  return tr;
}

/**
 * Check if a node should NOT show a drag handle:
 * - Empty paragraphs with placeholder
 */
function shouldShowHandle(node) {
  if (node.type.name === 'paragraph' && node.content.size === 0) {
    return false;
  }
  return true;
}

/**
 * BlockDragHandle - Notion-style block drag & drop for TipTap.
 *
 * Renders a drag handle (6-dot braille icon) at the left edge of each top-level
 * block. Dragging an H1 heading moves its entire section (all content until the
 * next H1). All other blocks move individually.
 */
export const BlockDragHandle = Extension.create({
  name: 'blockDragHandle',

  addProseMirrorPlugins() {
    let dragState = null; // { sourceRange, sourceStartIndex, sourceEndIndex }
    let hoveredNodeIndex = null;
    let dropTarget = null; // { pos, index }
    let isDragging = false;

    const plugin = new Plugin({
      key: blockDragHandleKey,

      state: {
        init() {
          return { hoveredNodeIndex: null, isDragging: false, dropTarget: null };
        },
        apply(tr, prev) {
          const meta = tr.getMeta(blockDragHandleKey);
          if (meta) return { ...prev, ...meta };
          return prev;
        },
      },

      props: {
        decorations(state) {
          const pluginState = blockDragHandleKey.getState(state);
          const decorations = [];
          const { doc } = state;

          // Don't show handles during text selection
          if (!state.selection.empty && !pluginState?.isDragging) {
            return DecorationSet.empty;
          }

          const hovered = pluginState?.hoveredNodeIndex;
          const dragging = pluginState?.isDragging;

          // Drag handle on hovered node
          if (hovered !== null && hovered !== undefined && hovered < doc.childCount) {
            const node = doc.child(hovered);
            if (shouldShowHandle(node)) {
              let pos = 0;
              for (let i = 0; i < hovered; i++) {
                pos += doc.child(i).nodeSize;
              }

              decorations.push(
                Decoration.widget(pos + 1, (view) => {
                  const handle = document.createElement('div');
                  handle.className = 'block-drag-handle';
                  handle.setAttribute('draggable', 'true');
                  handle.setAttribute('data-node-index', String(hovered));
                  handle.textContent = '\u2807'; // braille pattern ⠇ (vertical dots)
                  handle.contentEditable = 'false';

                  // Prevent ProseMirror from handling this click
                  handle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                  });

                  return handle;
                }, { side: -1, key: `drag-handle-${hovered}` })
              );
            }
          }

          // Drop indicator line
          if (dragging && pluginState?.dropTarget != null) {
            const targetPos = pluginState.dropTarget.pos;
            // Clamp to valid range
            const clampedPos = Math.min(targetPos, doc.content.size);

            decorations.push(
              Decoration.widget(clampedPos, () => {
                const line = document.createElement('div');
                line.className = 'block-drop-indicator';
                line.contentEditable = 'false';
                return line;
              }, { side: -1, key: 'drop-indicator' })
            );
          }

          // Dim source blocks while dragging
          if (dragging && dragState) {
            // Apply per-node decorations for each top-level node in the source range
            let pos = 0;
            for (let i = 0; i < doc.childCount; i++) {
              const nodeSize = doc.child(i).nodeSize;
              if (i >= dragState.sourceStartIndex && i < dragState.sourceEndIndex) {
                decorations.push(
                  Decoration.node(pos, pos + nodeSize, { class: 'block-drag-source' })
                );
              }
              pos += nodeSize;
            }
          }

          if (decorations.length === 0) return DecorationSet.empty;
          return DecorationSet.create(doc, decorations);
        },

        handleDOMEvents: {
          mousemove(view, event) {
            if (isDragging) return false;

            const editorRect = view.dom.getBoundingClientRect();
            const mouseX = event.clientX;
            const mouseY = event.clientY;

            // Check if mouse is within 48px of the left content edge
            const leftEdge = editorRect.left;
            const distFromLeft = mouseX - leftEdge;

            if (distFromLeft > 48 || distFromLeft < -48) {
              if (hoveredNodeIndex !== null) {
                hoveredNodeIndex = null;
                view.dispatch(
                  view.state.tr.setMeta(blockDragHandleKey, { hoveredNodeIndex: null })
                );
              }
              return false;
            }

            // Find which top-level block the mouse is over
            const pos = view.posAtCoords({ left: editorRect.left + 20, top: mouseY });
            if (!pos) {
              if (hoveredNodeIndex !== null) {
                hoveredNodeIndex = null;
                view.dispatch(
                  view.state.tr.setMeta(blockDragHandleKey, { hoveredNodeIndex: null })
                );
              }
              return false;
            }

            // Resolve to the top-level node index
            const resolved = view.state.doc.resolve(pos.pos);
            const depth = resolved.depth;

            // Walk up to depth 1 (direct child of doc)
            let topLevelIndex = null;
            if (depth >= 1) {
              topLevelIndex = resolved.index(0);
            } else if (depth === 0) {
              // Cursor is between blocks, find nearest
              topLevelIndex = resolved.index(0);
            }

            if (topLevelIndex !== hoveredNodeIndex) {
              hoveredNodeIndex = topLevelIndex;
              view.dispatch(
                view.state.tr.setMeta(blockDragHandleKey, { hoveredNodeIndex: topLevelIndex })
              );
            }

            return false;
          },

          mouseleave(view) {
            if (!isDragging && hoveredNodeIndex !== null) {
              hoveredNodeIndex = null;
              view.dispatch(
                view.state.tr.setMeta(blockDragHandleKey, { hoveredNodeIndex: null })
              );
            }
            return false;
          },

          dragstart(view, event) {
            const handle = event.target.closest?.('.block-drag-handle');
            if (!handle) return false;

            const nodeIndex = parseInt(handle.getAttribute('data-node-index'), 10);
            if (isNaN(nodeIndex)) return false;

            const { doc } = view.state;
            const range = getDragRange(doc, nodeIndex);

            dragState = {
              sourceRange: { from: range.from, to: range.to },
              sourceStartIndex: range.startIndex,
              sourceEndIndex: range.endIndex,
            };
            isDragging = true;
            dropTarget = null;

            // Set drag data
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', 'block-drag');

            // Set ghost drag image with opacity
            const slice = doc.slice(range.from, range.to);
            const tempDiv = document.createElement('div');
            tempDiv.style.position = 'absolute';
            tempDiv.style.top = '-9999px';
            tempDiv.style.opacity = '0.5';
            tempDiv.style.maxWidth = '600px';
            tempDiv.style.pointerEvents = 'none';

            // Render a simplified version of the dragged content
            const serializer = view.domSerializer || view.state.schema.domSerializer;
            if (serializer) {
              try {
                const fragment = serializer.serializeFragment(slice.content);
                tempDiv.appendChild(fragment);
              } catch {
                tempDiv.textContent = 'Dragging block...';
              }
            } else {
              tempDiv.textContent = 'Dragging block...';
            }

            document.body.appendChild(tempDiv);
            event.dataTransfer.setDragImage(tempDiv, 0, 0);

            // Clean up temp div after a tick
            requestAnimationFrame(() => {
              document.body.removeChild(tempDiv);
            });

            view.dispatch(
              view.state.tr.setMeta(blockDragHandleKey, {
                isDragging: true,
                dropTarget: null,
              })
            );

            return true;
          },

          dragover(view, event) {
            if (!isDragging || !dragState) return false;

            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';

            // Find the closest valid drop position
            const coords = { left: event.clientX, top: event.clientY };
            const pos = view.posAtCoords(coords);
            if (!pos) return false;

            const { doc } = view.state;
            const target = findClosestDropTarget(
              doc,
              pos.pos,
              dragState.sourceStartIndex,
              dragState.sourceEndIndex
            );

            if (target && (!dropTarget || target.pos !== dropTarget.pos)) {
              dropTarget = target;
              view.dispatch(
                view.state.tr.setMeta(blockDragHandleKey, {
                  isDragging: true,
                  dropTarget: target,
                })
              );
            }

            return true;
          },

          dragend(view) {
            isDragging = false;
            dragState = null;
            dropTarget = null;

            view.dispatch(
              view.state.tr.setMeta(blockDragHandleKey, {
                isDragging: false,
                dropTarget: null,
                hoveredNodeIndex: null,
              })
            );

            return false;
          },

          drop(view, event) {
            if (!isDragging || !dragState || !dropTarget) {
              return false;
            }

            event.preventDefault();

            const { from, to } = dragState.sourceRange;
            const targetPos = dropTarget.pos;

            // Perform the move as a single transaction
            const { tr } = view.state;
            moveBlock(tr, from, to, targetPos);
            view.dispatch(tr);

            // Reset state
            isDragging = false;
            dragState = null;
            dropTarget = null;
            hoveredNodeIndex = null;

            view.dispatch(
              view.state.tr.setMeta(blockDragHandleKey, {
                isDragging: false,
                dropTarget: null,
                hoveredNodeIndex: null,
              })
            );

            return true;
          },
        },
      },
    });

    return [plugin];
  },
});
