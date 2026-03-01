import React, { useState, useEffect, useRef } from 'react';
import { XIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { RevealMarkdown } from '../extensions/RevealMarkdown';
import FrontmatterProperties from './FrontmatterProperties';

const Editor = ({
    onEditorReady, onContentChange, activeFile, activeTabId, activeTab, snapshotTab,
    updateFrontmatter, addFrontmatterProperty, removeFrontmatterProperty,
    renameFrontmatterKey, toggleFrontmatterCollapsed,
}) => {
    const [commentText, setCommentText] = useState('');
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
    const [showMenu, setShowMenu] = useState(false);
    const [comments, setComments] = useState([]);
    const [showCommentInput, setShowCommentInput] = useState(false);
    const [commentInputTop, setCommentInputTop] = useState(0);
    const menuRef = useRef(null);
    const pageRef = useRef(null);
    const commentsRef = useRef({});
    const loadedTabRef = useRef(null);

    // New state for adjusted positions
    const [adjustedPositions, setAdjustedPositions] = useState({});

    const editor = useEditor({
        extensions: [
            StarterKit,
            Placeholder.configure({
                placeholder: 'Start writing...',
            }),
            Markdown.configure({
                html: false,
                tightLists: true,
                bulletListMarker: '-',
                transformPastedText: true,
                transformCopiedText: true,
            }),
            RevealMarkdown,
            Highlight.configure({
                multicolor: true,
            }).extend({
                name: 'comment',
                addStorage() {
                    return {
                        markdown: {
                            serialize: { open: '', close: '' },
                            parse: {}
                        }
                    };
                },
                addAttributes() {
                    return {
                        comment: {
                            default: null,
                            parseHTML: element => element.getAttribute('data-comment'),
                            renderHTML: attributes => {
                                if (!attributes.comment) {
                                    return {};
                                }
                                return {
                                    'data-comment': attributes.comment,
                                    'class': 'comment',
                                    'title': attributes.comment,
                                };
                            },
                        },
                        id: {
                            default: null,
                            parseHTML: element => element.getAttribute('data-id'),
                            renderHTML: attributes => {
                                if (!attributes.id) {
                                    return {};
                                }
                                return {
                                    'data-id': attributes.id,
                                };
                            }
                        }
                    };
                },
            }),
        ],
        content: '',
        onUpdate: ({ editor }) => {
            if (onContentChange) {
                onContentChange();
            }
            extractComments(editor);
        },
        onSelectionUpdate: ({ editor }) => {
            const { from, to, empty } = editor.state.selection;
            if (empty) {
                setShowMenu(false);
                return;
            }

            const { ranges } = editor.state.selection;
            const fromPos = ranges[0].$from.pos;
            const toPos = ranges[0].$to.pos;

            const start = editor.view.coordsAtPos(fromPos);
            const end = editor.view.coordsAtPos(toPos);

            const left = (start.left + end.left) / 2;
            const top = start.top - 40;

            setMenuPosition({ top, left });
            setShowMenu(true);
        },
    });

    // Notify parent when editor is ready
    useEffect(() => {
        if (editor && onEditorReady) {
            onEditorReady(editor);
        }
    }, [editor, onEditorReady]);

    // Load content when active tab changes
    useEffect(() => {
        if (!editor) return;
        if (!activeFile || !activeTabId) {
            loadedTabRef.current = null;
            editor.commands.setContent('', { emitUpdate: false });
            return;
        }
        if (loadedTabRef.current === activeTabId) return;

        // Snapshot previous tab before switching
        if (loadedTabRef.current && snapshotTab) {
            snapshotTab(loadedTabRef.current, editor.getJSON(), 0);
        }

        loadedTabRef.current = activeTabId;

        // If tab has a tiptapJSON snapshot, use it (returning to a previously viewed tab)
        if (activeTab && activeTab.tiptapJSON) {
            editor.commands.setContent(activeTab.tiptapJSON, { emitUpdate: false });
            extractComments(editor);
            return;
        }

        // Otherwise load from file content (first time opening this tab)
        if (activeFile.isQuipu && typeof activeFile.content === 'object') {
            // Quipu format - load TipTap JSON directly
            editor.commands.setContent(activeFile.content, { emitUpdate: false });
        } else {
            const text = typeof activeFile.content === 'string' ? activeFile.content : '';
            const isMarkdown = activeFile.name.endsWith('.md') || activeFile.name.endsWith('.markdown');

            if (isMarkdown) {
                // tiptap-markdown extension handles parsing raw markdown
                editor.commands.setContent(text, { emitUpdate: false });
            } else {
                // Plain text - convert to paragraphs
                const paragraphs = text.split('\n').map(line => ({
                    type: 'paragraph',
                    content: line ? [{ type: 'text', text: line }] : [],
                }));
                editor.commands.setContent({
                    type: 'doc',
                    content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }],
                }, { emitUpdate: false });
            }
        }
        extractComments(editor);
    }, [editor, activeFile, activeTabId, activeTab, snapshotTab]);

    // Effect to calculate positions preventing overlap
    useEffect(() => {
        const newPositions = {};
        let lastBottom = 0;
        const GAP = 16; // Gap between comments

        // Sort comments by their original top position to process them in order
        const sortedComments = [...comments].sort((a, b) => a.top - b.top);

        sortedComments.forEach((comment, index) => {
            const el = commentsRef.current[index];
            if (el) {
                const height = el.getBoundingClientRect().height;
                let top = comment.top;

                // If this comment would overlap with the previous one (plus gap), push it down
                if (top < lastBottom + GAP) {
                    top = lastBottom + GAP;
                }

                newPositions[index] = top;
                lastBottom = top + height;
            } else {
                // Fallback if ref not yet available (shouldn't happen often in effect)
                newPositions[index] = comment.top;
            }
        });

        setAdjustedPositions(newPositions);
    }, [comments]); // Re-run when comments change

    const extractComments = (editor) => {
        const commentsData = [];
        const pageRect = pageRef.current?.getBoundingClientRect();
        const pageTop = pageRect ? pageRect.top : 0;

        editor.state.doc.descendants((node, pos) => {
            if (node.marks) {
                const commentMark = node.marks.find(m => m.type.name === 'comment');
                if (commentMark) {
                    // Get coordinates
                    const coords = editor.view.coordsAtPos(pos);
                    const relativeTop = coords.top - pageTop;

                    commentsData.push({
                        text: node.text,
                        comment: commentMark.attrs.comment,
                        id: commentMark.attrs.id,
                        pos: pos,
                        top: relativeTop
                    });
                }
            }
        });

        // Group grouped comments by ID
        const groupedComments = [];
        const processedIds = new Set();

        commentsData.forEach((c) => {
            if (c.id && !processedIds.has(c.id)) {
                // Find all parts of this comment
                const parts = commentsData.filter(item => item.id === c.id);
                // Combine text for quota (simplified)
                const fullText = parts.map(p => p.text).join('');

                // Use the top position of the first occurrence
                const firstPart = parts[0];

                groupedComments.push({
                    ...firstPart,
                    text: fullText,
                });
                processedIds.add(c.id);
            } else if (!c.id) {
                // Handle legacy comments without ID if any
            }
        });

        // Sort by top position to ensure consistent order
        groupedComments.sort((a, b) => a.top - b.top);

        setComments(groupedComments);
    };

    const handleCommentClick = () => {
        // Calculate position for input box
        const { ranges } = editor.state.selection;
        const fromPos = ranges[0].$from.pos;
        const coords = editor.view.coordsAtPos(fromPos);
        const pageRect = pageRef.current?.getBoundingClientRect();
        const relativeTop = coords.top - (pageRect ? pageRect.top : 0);

        setCommentInputTop(relativeTop);
        setShowCommentInput(true);
        setShowMenu(false); // Hide bubble menu
    };

    const generatePrompt = (editorInstance) => {
        const json = editorInstance.getJSON();

        const serializeNode = (node) => {
            if (node.type === 'text') {
                const commentMark = node.marks?.find(m => m.type === 'comment');
                if (commentMark) {
                    return `<commented id="${commentMark.attrs.id}">${node.text}</commented><comment id="${commentMark.attrs.id}">${commentMark.attrs.comment}</comment>`;
                }
                return node.text;
            }

            if (node.content) {
                return node.content.map(serializeNode).join('');
            }

            if (node.type === 'paragraph') {
                return (node.content ? node.content.map(serializeNode).join('') : '') + '\n';
            }

            return '';
        };

        if (json.content) {
            return json.content.map(serializeNode).join('');
        }
        return '';
    };

    const addComment = () => {
        if (editor && commentText) {
            const commentId = crypto.randomUUID();
            editor.chain().focus().setMark('comment', { comment: commentText, id: commentId }).run();
            setCommentText('');
            setShowCommentInput(false);
            extractComments(editor);

            // Generate and log prompt
            const prompt = generatePrompt(editor);
            console.log("AI PROMPT:", prompt);
        }
    };

    const cancelComment = () => {
        setCommentText('');
        setShowCommentInput(false);
    };

    const resolveComment = (commentId) => {
        if (!editor || !commentId) return;

        // Create a transaction to remove the mark
        const { tr } = editor.state;

        editor.state.doc.descendants((node, pos) => {
            if (node.marks) {
                const commentMark = node.marks.find(m => m.type.name === 'comment' && m.attrs.id === commentId);
                if (commentMark) {
                    tr.removeMark(pos, pos + node.nodeSize, commentMark.type);
                }
            }
        });

        editor.view.dispatch(tr);
        extractComments(editor);
    };

    return (
        <div className="flex h-full w-full bg-bg-surface overflow-hidden">
            <div className={cn(
                "flex-1 flex justify-center items-start overflow-y-auto relative",
                "py-12 px-16",
                "max-[1400px]:justify-start max-[1400px]:pl-12",
                "max-[1200px]:overflow-x-auto max-[1200px]:p-8",
                "max-[1150px]:py-6 max-[1150px]:px-4",
            )}>
                <div
                    className={cn(
                        "w-[816px] min-h-[1056px] bg-white rounded border border-page-border",
                        "shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.06),0_12px_30px_rgba(0,0,0,0.05)]",
                        "p-16 relative shrink-0 transition-[width] duration-300",
                        "max-[1150px]:w-full max-[1150px]:max-w-[816px]",
                    )}
                    ref={pageRef}
                >
                    {activeTab && (activeTab.frontmatter || activeTab.frontmatterRaw) && (
                        <div className="-mx-16 -mt-16 mb-6 rounded-t border-b border-page-border">
                            <FrontmatterProperties
                                frontmatter={activeTab.frontmatter}
                                frontmatterRaw={activeTab.frontmatterRaw}
                                isCollapsed={activeTab.frontmatterCollapsed}
                                tabId={activeTab.id}
                                onUpdate={updateFrontmatter}
                                onAdd={addFrontmatterProperty}
                                onRemove={removeFrontmatterProperty}
                                onRenameKey={renameFrontmatterKey}
                                onToggleCollapse={toggleFrontmatterCollapsed}
                            />
                        </div>
                    )}
                    {showMenu && (
                        <div
                            className="flex bg-bg-overlay p-0.5 rounded-lg shadow-lg"
                            style={{
                                position: 'fixed',
                                top: menuPosition.top,
                                left: menuPosition.left,
                                transform: 'translateX(-50%)',
                                zIndex: 100
                            }}
                            ref={menuRef}
                            onMouseDown={(e) => e.preventDefault()}
                        >
                            <button
                                onClick={() => editor.chain().focus().toggleBold().run()}
                                className={cn(
                                    "border-none bg-transparent text-white text-sm font-medium py-1.5 px-2.5 cursor-pointer rounded-md",
                                    "hover:bg-white/15",
                                    editor.isActive('bold') && "bg-white/20",
                                )}
                            >
                                Bold
                            </button>
                            <button
                                onClick={() => editor.chain().focus().toggleItalic().run()}
                                className={cn(
                                    "border-none bg-transparent text-white text-sm font-medium py-1.5 px-2.5 cursor-pointer rounded-md",
                                    "hover:bg-white/15",
                                    editor.isActive('italic') && "bg-white/20",
                                )}
                            >
                                Italic
                            </button>
                            <button
                                onClick={handleCommentClick}
                                className={cn(
                                    "border-none bg-transparent text-white text-sm font-medium py-1.5 px-2.5 cursor-pointer rounded-md",
                                    "hover:bg-white/15",
                                    editor.isActive('comment') && "bg-white/20",
                                )}
                            >
                                Comment
                            </button>
                        </div>
                    )}
                    <EditorContent editor={editor} />
                </div>

                {/* Floating Comments Track */}
                <div className={cn(
                    "absolute top-8 w-[300px] bottom-0 pointer-events-none",
                    "left-[calc(50%+408px+1rem)]",
                    "max-[1400px]:left-[867px]",
                    "max-[1200px]:left-[calc(2rem+816px+1rem)]",
                    "max-[1150px]:w-auto",
                )}>
                    {showCommentInput && (
                        <div
                            className="absolute w-[280px] bg-white rounded-lg shadow-lg p-3 pointer-events-auto border border-accent z-[100]"
                            style={{ top: commentInputTop }}
                        >
                            <textarea
                                value={commentText}
                                onChange={(e) => setCommentText(e.target.value)}
                                placeholder="Type your comment..."
                                autoFocus
                                className="w-full border border-border-focus rounded py-2 px-2 font-[inherit] text-sm resize-y min-h-[60px] outline-none mb-2 text-page-text focus:border-accent focus:shadow-[0_0_0_2px_rgba(196,131,90,0.3)]"
                            />
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={cancelComment}
                                    className="py-1.5 px-3 rounded text-[13px] font-medium cursor-pointer border-none bg-transparent text-text-tertiary hover:bg-black/5"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={addComment}
                                    className="py-1.5 px-3 rounded text-[13px] font-medium cursor-pointer border-none bg-accent text-white hover:bg-accent-hover"
                                >
                                    Comment
                                </button>
                            </div>
                        </div>
                    )}

                    {comments.map((c, i) => (
                        <div
                            key={c.id || i}
                            ref={el => commentsRef.current[i] = el}
                            className="absolute w-[280px] bg-white rounded-lg shadow-md p-3 pointer-events-auto border border-transparent hover:shadow-lg"
                            style={{
                                top: adjustedPositions[i] !== undefined ? adjustedPositions[i] : c.top,
                                transition: 'top 0.3s ease-out'
                            }}
                        >
                            <div className="flex justify-between mb-1 text-xs">
                                <span className="font-semibold text-page-text">User</span>
                                <div className="flex gap-2 items-center">
                                    <span className="text-[#57606a]">Just now</span>
                                    <button
                                        className="border-none bg-transparent text-[#57606a] cursor-pointer py-0.5 px-1.5 rounded flex items-center justify-center transition-colors hover:bg-[#e5e7eb] hover:text-page-text"
                                        onClick={() => resolveComment(c.id)}
                                        title="Resolve comment"
                                    >
                                        <XIcon size={14} />
                                    </button>
                                </div>
                            </div>
                            <div className="text-sm text-page-text mb-2 whitespace-pre-wrap">{c.comment}</div>
                            <div className="text-xs text-[#57606a] border-l-2 border-warning pl-2 italic whitespace-nowrap overflow-hidden text-ellipsis">"{c.text}"</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Editor;
