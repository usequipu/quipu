import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    XIcon, TextBIcon, TextItalicIcon, TextStrikethroughIcon,
    TextHOneIcon, TextHTwoIcon, TextHThreeIcon,
    ListBulletsIcon, ListNumbersIcon, QuotesIcon, CodeIcon, CodeBlockIcon,
    TableIcon, MagnifyingGlassPlusIcon, MagnifyingGlassMinusIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import { RevealMarkdown } from '../extensions/RevealMarkdown';
import { BlockDragHandle } from '../extensions/BlockDragHandle';
import { FindReplace } from '../extensions/FindReplace';
import { WikiLink, wikiLinksToHTML } from '../extensions/WikiLink';
import { CodeBlockWithLang } from '../extensions/CodeBlockWithLang';
import FindBar from './FindBar';
import FrontmatterProperties from './FrontmatterProperties';
import frameService from '../services/frameService.js';
import fs from '../services/fileSystem.js';

// Map an editor position to a 1-based line number (top-level block index)
const posToLineNumber = (doc, pos) => {
    let line = 0;
    let offset = 0;
    for (let i = 0; i < doc.childCount; i++) {
        line++;
        offset += doc.child(i).nodeSize;
        if (offset >= pos) break;
    }
    return Math.max(1, line);
};

// Map a 1-based line number to the start position inside that block
const lineNumberToPos = (doc, lineNumber) => {
    let line = 0;
    let pos = 0;
    for (let i = 0; i < doc.childCount; i++) {
        line++;
        if (line === lineNumber) {
            return pos + 1; // +1 to enter the node content
        }
        pos += doc.child(i).nodeSize;
    }
    return doc.content.size;
};

const ToolbarButton = ({ onClick, isActive, title, disabled, children }) => (
    <button
        className={cn('editor-toolbar-btn', isActive && 'active', disabled && 'opacity-30 cursor-not-allowed')}
        onClick={disabled ? undefined : onClick}
        title={title}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
    >
        {children}
    </button>
);

const ToolbarSeparator = () => <div className="editor-toolbar-separator" />;

const Editor = ({
    onEditorReady, onContentChange, activeFile, activeTabId, activeTab, snapshotTab,
    workspacePath, openFile, revealFolder,
    updateFrontmatter, addFrontmatterProperty, removeFrontmatterProperty,
    renameFrontmatterKey, toggleFrontmatterCollapsed,
    addFrontmatterTag, removeFrontmatterTag, updateFrontmatterTag,
}) => {
    const ANNOTATION_TYPES = ['comment', 'review', 'todo', 'bug', 'question', 'instruction'];
    const TYPE_COLORS = {
        comment: 'bg-text-tertiary/20 text-text-secondary',
        review: 'bg-accent/20 text-accent',
        todo: 'bg-info/20 text-info',
        bug: 'bg-error/20 text-error',
        question: 'bg-warning/20 text-warning',
        instruction: 'bg-success/20 text-success',
    };

    const [commentText, setCommentText] = useState('');
    const [commentType, setCommentType] = useState('comment');
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
    const [showMenu, setShowMenu] = useState(false);
    const [comments, setComments] = useState([]);
    const [showCommentInput, setShowCommentInput] = useState(false);
    const [commentInputTop, setCommentInputTop] = useState(0);
    const savedSelectionRef = useRef(null); // saved {from, to} for comment mark
    const menuRef = useRef(null);
    const pageRef = useRef(null);
    const commentsRef = useRef({});
    const loadedTabRef = useRef(null);
    const isLoadingContentRef = useRef(false); // suppress onUpdate during setContent
    const recentFrameSaveRef = useRef(0); // timestamp of our last FRAME write

    const [showFindBar, setShowFindBar] = useState(false);

    // Editor mode: 'richtext' (default) or 'obsidian'
    const [editorMode, setEditorMode] = useState(() => {
        return localStorage.getItem('quipu-editor-mode') || 'richtext';
    });

    // Refs to access editor/rawContent inside toggleEditorMode without temporal dead zone
    const editorRefForToggle = useRef(null);
    const rawContentRef = useRef('');

    const toggleEditorMode = useCallback(() => {
        setEditorMode(prev => {
            const cycle = { richtext: 'obsidian', obsidian: 'raw', raw: 'richtext' };
            const next = cycle[prev] || 'richtext';
            localStorage.setItem('quipu-editor-mode', next);

            // When leaving raw mode, sync raw edits back into TipTap
            const ed = editorRefForToggle.current;
            const raw = rawContentRef.current;
            if (prev === 'raw' && ed && !ed.isDestroyed && raw) {
                const isMarkdown = activeFile?.name?.endsWith('.md') || activeFile?.name?.endsWith('.markdown');
                if (isMarkdown) {
                    const processed = wikiLinksToHTML(raw);
                    ed.commands.setContent(processed, { emitUpdate: false });
                } else if (activeFile?.isQuipu) {
                    try {
                        const parsed = JSON.parse(raw);
                        if (parsed.content) {
                            ed.commands.setContent(parsed.content, { emitUpdate: false });
                        }
                    } catch { /* invalid JSON — keep old content */ }
                } else {
                    const paragraphs = raw.split('\n').map(line => ({
                        type: 'paragraph',
                        content: line ? [{ type: 'text', text: line }] : [],
                    }));
                    ed.commands.setContent({
                        type: 'doc',
                        content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }],
                    }, { emitUpdate: false });
                }
            }

            return next;
        });
    }, [activeFile]);

    // Raw mode editing state
    const [rawContent, setRawContent] = useState('');
    // Keep ref in sync for toggleEditorMode
    useEffect(() => { rawContentRef.current = rawContent; }, [rawContent]);

    // Sync raw content when switching to raw mode or when active file changes
    useEffect(() => {
        if (editorMode !== 'raw' || !activeFile) return;
        if (activeFile.isQuipu && typeof activeFile.content === 'object') {
            setRawContent(JSON.stringify(activeFile.content, null, 2));
        } else if (editor?.storage?.markdown?.getMarkdown) {
            setRawContent(editor.storage.markdown.getMarkdown());
        } else {
            setRawContent(typeof activeFile.content === 'string' ? activeFile.content : '');
        }
    }, [editorMode, activeFile?.path]);

    // Expose raw mode flag for save logic
    useEffect(() => {
        window.__quipuEditorRawMode = editorMode === 'raw';
        return () => { delete window.__quipuEditorRawMode; };
    }, [editorMode]);

    const handleRawContentChange = useCallback((e) => {
        const value = e.target.value;
        setRawContent(value);
        if (onContentChange) {
            onContentChange(value);
        }
    }, [onContentChange]);

    // Expose toggleEditorMode for command palette (editor.toggleMode action)
    useEffect(() => {
        window.__quipuToggleEditorMode = toggleEditorMode;
        return () => { delete window.__quipuToggleEditorMode; };
    }, [toggleEditorMode]);

    // Expose find bar toggle for App.jsx keyboard shortcut
    useEffect(() => {
        window.__quipuToggleFind = () => setShowFindBar(prev => !prev);
        return () => { delete window.__quipuToggleFind; };
    }, []);

    // Document zoom: 75%-200%, persisted in localStorage, independent of window zoom
    const ZOOM_MIN = 75;
    const ZOOM_MAX = 200;
    const ZOOM_STEP = 25;

    const [zoomLevel, setZoomLevel] = useState(() => {
        const saved = localStorage.getItem('quipu-editor-zoom');
        const parsed = saved ? parseInt(saved, 10) : 100;
        return parsed >= ZOOM_MIN && parsed <= ZOOM_MAX ? parsed : 100;
    });

    const handleZoomIn = useCallback(() => {
        setZoomLevel(prev => {
            const next = Math.min(prev + ZOOM_STEP, ZOOM_MAX);
            localStorage.setItem('quipu-editor-zoom', String(next));
            return next;
        });
    }, []);

    const handleZoomOut = useCallback(() => {
        setZoomLevel(prev => {
            const next = Math.max(prev - ZOOM_STEP, ZOOM_MIN);
            localStorage.setItem('quipu-editor-zoom', String(next));
            return next;
        });
    }, []);

    // Ctrl+scroll zoom — must use ref + addEventListener with { passive: false }
    const editorScrollRef = useRef(null);
    useEffect(() => {
        const el = editorScrollRef.current;
        if (!el) return;
        const handler = (e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            if (e.deltaY < 0) handleZoomIn();
            else handleZoomOut();
        };
        el.addEventListener('wheel', handler, { passive: false });
        return () => el.removeEventListener('wheel', handler);
    }, [handleZoomIn, handleZoomOut]);

    // Table context menu state
    const [tableContextMenu, setTableContextMenu] = useState(null);

    const closeTableMenu = useCallback(() => {
        setTableContextMenu(null);
    }, []);


    const displayTitle = useMemo(() => {
        if (!activeFile?.name) return '';
        return activeFile.name.replace(/\.(md|markdown|quipu)$/i, '');
    }, [activeFile?.name]);

    // New state for adjusted positions
    const [adjustedPositions, setAdjustedPositions] = useState({});

    // Ref keeps handleImageUpload fresh inside the static editorProps closure
    const handleImageUploadRef = useRef(null);

    // Handle image upload from clipboard paste or file drop
    const handleImageUpload = useCallback(async (file, view, insertPos) => {
        if (!activeFile?.path || !workspacePath) {
            // No active file context: insert as base64 data URL fallback
            const reader = new FileReader();
            reader.onload = () => {
                const src = reader.result;
                const pos = insertPos ?? view.state.selection.from;
                const node = view.state.schema.nodes.image.create({ src });
                const tr = view.state.tr.insert(pos, node);
                view.dispatch(tr);
            };
            reader.readAsDataURL(file);
            return;
        }

        try {
            // Generate a unique filename
            const ext = file.name?.split('.').pop() || file.type.split('/')[1] || 'png';
            const timestamp = Date.now();
            const filename = `image-${timestamp}.${ext}`;

            // Determine target directory (same directory as the active file)
            const filePath = activeFile.path;
            const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
            const dir = lastSep >= 0 ? filePath.substring(0, lastSep) : workspacePath;
            const targetPath = `${dir}/${filename}`;

            // Convert blob to base64 for upload
            const arrayBuffer = await file.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);

            // Upload using the file system service
            await fs.uploadImage(targetPath, base64);

            // Build the image src URL
            const src = fs.getFileUrl(targetPath);

            // Insert the image node into the document
            const pos = insertPos ?? view.state.selection.from;
            const node = view.state.schema.nodes.image.create({
                src,
                alt: filename,
            });
            const tr = view.state.tr.insert(pos, node);
            view.dispatch(tr);
        } catch (err) {
            console.warn('Image upload failed, falling back to base64:', err);
            // Fallback: insert as base64 data URL
            const reader = new FileReader();
            reader.onload = () => {
                const src = reader.result;
                const pos = insertPos ?? view.state.selection.from;
                const node = view.state.schema.nodes.image.create({ src });
                const tr = view.state.tr.insert(pos, node);
                view.dispatch(tr);
            };
            reader.readAsDataURL(file);
        }
    }, [activeFile?.path, workspacePath]);
    handleImageUploadRef.current = handleImageUpload;

    // Resolve a wiki link path relative to the current file and open it
    const handleWikiLinkOpenRef = useRef(null);
    handleWikiLinkOpenRef.current = useCallback(async (linkPath) => {
        if (!openFile || !workspacePath) return;
        // Resolve relative to current file's directory
        const currentDir = activeFile?.path
            ? activeFile.path.substring(0, activeFile.path.lastIndexOf('/'))
            : workspacePath;
        // Normalize: remove trailing slash, build absolute path
        const cleanPath = linkPath.replace(/\/+$/, '');
        const absolutePath = cleanPath.startsWith('/')
            ? workspacePath + cleanPath
            : currentDir + '/' + cleanPath;

        // Check if path is a directory by trying readDirectory
        if (revealFolder) {
            try {
                await fs.readDirectory(absolutePath);
                // Success means it's a directory — expand ancestors and toggle target
                revealFolder(absolutePath);
                return;
            } catch {
                // Not a directory or doesn't exist — fall through to openFile
            }
        }

        const fileName = cleanPath.includes('/')
            ? cleanPath.substring(cleanPath.lastIndexOf('/') + 1)
            : cleanPath;
        openFile(absolutePath, fileName);
    }, [openFile, workspacePath, activeFile?.path, revealFolder]);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({ codeBlock: false }),
            CodeBlockWithLang,
            Table.configure({ resizable: false }),
            TableRow,
            TableHeader,
            TableCell,
            Image.configure({
                inline: false,
                allowBase64: true,
            }),
            Placeholder.configure({
                placeholder: 'Start writing...',
            }),
            Markdown.configure({
                html: true,
                tightLists: true,
                bulletListMarker: '-',
                transformPastedText: true,
                transformCopiedText: true,
            }),
            RevealMarkdown,
            BlockDragHandle,
            FindReplace,
            WikiLink.configure({
                onOpen: (path) => handleWikiLinkOpenRef.current?.(path),
            }),
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
        editorProps: {
            handlePaste: (view, event) => {
                const items = event.clipboardData?.items;
                if (!items) return false;

                for (const item of items) {
                    if (item.type.startsWith('image/')) {
                        event.preventDefault();
                        const file = item.getAsFile();
                        if (!file) return true;

                        handleImageUploadRef.current(file, view);
                        return true;
                    }
                }
                return false;
            },
            handleDrop: (view, event) => {
                const files = event.dataTransfer?.files;
                if (!files || files.length === 0) return false;

                // Check if any file is an image
                const imageFile = Array.from(files).find(f => f.type.startsWith('image/'));
                if (!imageFile) return false;

                event.preventDefault();

                // Get the drop position in the document
                const coords = { left: event.clientX, top: event.clientY };
                const pos = view.posAtCoords(coords);
                if (pos) {
                    handleImageUploadRef.current(imageFile, view, pos.pos);
                } else {
                    handleImageUploadRef.current(imageFile, view);
                }
                return true;
            },
            handleClick: (view, pos, event) => {
                const target = event.target;
                // Handle external link clicks — open in new tab/system browser
                if (target.tagName === 'A' && target.href) {
                    const href = target.href;
                    if (href.startsWith('http://') || href.startsWith('https://')) {
                        event.preventDefault();
                        window.open(href, '_blank');
                        return true;
                    }
                }
                return false;
            },
        },
        onUpdate: ({ editor }) => {
            // Skip updates triggered by programmatic setContent during tab loading
            if (isLoadingContentRef.current) return;
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

    const handleEditorContextMenu = useCallback((e) => {
        if (!editor) return;

        // Check if cursor is inside a table
        const isInTable = editor.isActive('table');

        if (isInTable) {
            e.preventDefault();
            setTableContextMenu({ x: e.clientX, y: e.clientY });
        }
        // else: allow native context menu
    }, [editor]);

    // Close table context menu on click outside, Escape, or scroll
    useEffect(() => {
        if (!tableContextMenu) return;

        const handleClick = () => closeTableMenu();
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') closeTableMenu();
        };
        const handleScroll = () => closeTableMenu();

        document.addEventListener('click', handleClick);
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('scroll', handleScroll, true);

        return () => {
            document.removeEventListener('click', handleClick);
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('scroll', handleScroll, true);
        };
    }, [tableContextMenu, closeTableMenu]);

    // Keep editor ref in sync for toggleEditorMode
    useEffect(() => { editorRefForToggle.current = editor; }, [editor]);

    // Set lang attribute for multilingual spellcheck (English + Portuguese)
    useEffect(() => {
        if (!editor?.view?.dom) return;
        editor.view.dom.setAttribute('lang', 'en, pt-BR');
    }, [editor]);

    // Notify parent when editor is ready
    useEffect(() => {
        if (editor && onEditorReady) {
            onEditorReady(editor);
        }
    }, [editor, onEditorReady]);

    // Load content when active tab changes or is externally reloaded
    useEffect(() => {
        if (!editor) return;
        if (!activeFile || !activeTabId) {
            loadedTabRef.current = null;
            editor.commands.setContent('', { emitUpdate: false });
            return;
        }

        // Compound key: tabId + reloadKey ensures external reloads re-run this effect
        const tabKey = `${activeTabId}:${activeTab?.reloadKey ?? 0}`;
        if (loadedTabRef.current === tabKey) return;

        // Snapshot previous tab before switching (not on reload of same tab)
        const prevTabId = loadedTabRef.current ? loadedTabRef.current.split(':')[0] : null;
        if (prevTabId && prevTabId !== activeTabId && snapshotTab) {
            snapshotTab(prevTabId, editor.getJSON(), 0);
        }

        loadedTabRef.current = tabKey;
        isLoadingContentRef.current = true;

        // Defer setContent to a microtask to avoid flushSync warnings from
        // CodeBlockLowlight decorations firing during React's render phase
        queueMicrotask(() => {
            if (!editor || editor.isDestroyed) { isLoadingContentRef.current = false; return; }

            // If tab has a tiptapJSON snapshot, use it (returning to a previously viewed tab)
            if (activeTab && activeTab.tiptapJSON) {
                editor.commands.setContent(activeTab.tiptapJSON, { emitUpdate: false });
            } else if (activeFile.isQuipu && typeof activeFile.content === 'object') {
                editor.commands.setContent(activeFile.content, { emitUpdate: false });
            } else {
                const text = typeof activeFile.content === 'string' ? activeFile.content : '';
                const isMarkdown = activeFile.name.endsWith('.md') || activeFile.name.endsWith('.markdown');

                if (isMarkdown) {
                    const processed = wikiLinksToHTML(text);
                    editor.commands.setContent(processed, { emitUpdate: false });
                } else {
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

            // Double rAF: first frame lets TipTap process the new state,
            // second frame ensures the view's DOM positions are valid for coordsAtPos
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    isLoadingContentRef.current = false;
                    if (editor && !editor.isDestroyed) {
                        extractComments(editor);
                    }
                });
            });
        });
    }, [editor, activeFile, activeTabId, activeTab, snapshotTab]);

    // Load FRAME annotations as comment marks when switching tabs or when FRAME files change externally
    const frameReloadKey = activeTab?.frameReloadKey ?? 0;

    useEffect(() => {
        if (!editor || !activeFile?.path || !workspacePath || !activeTabId) return;

        // Skip quipu files — they store comments inline in TipTap JSON
        if (activeFile.isQuipu) return;

        let cancelled = false;
        const isExternalReload = frameReloadKey > 0;

        // Skip FRAME reloads caused by our own writes (within 3s)
        if (isExternalReload && recentFrameSaveRef.current && Date.now() - recentFrameSaveRef.current < 3000) {
            return;
        }

        const loadFrameAnnotations = async () => {
            try {
                const frame = await frameService.readFrame(workspacePath, activeFile.path);
                if (cancelled) return;

                const { doc } = editor.state;
                const { tr } = editor.state;
                let applied = false;

                // On external FRAME reload, clear all existing comment marks first
                // so we get a fresh set from the updated FRAME file
                if (isExternalReload) {
                    doc.descendants((node, pos) => {
                        if (node.marks) {
                            const commentMark = node.marks.find((m) => m.type.name === 'comment');
                            if (commentMark) {
                                tr.removeMark(pos, pos + node.nodeSize, commentMark.type);
                                applied = true;
                            }
                        }
                    });
                }

                if (!frame?.annotations?.length) {
                    // If there were marks to clear but no new annotations, dispatch the removal
                    if (applied && !cancelled) {
                        editor.view.dispatch(tr);
                        extractComments(editor);
                    }
                    return;
                }

                // Collect existing comment IDs to avoid duplicates (only for initial load, not external reload)
                const existingIds = new Set();
                if (!isExternalReload) {
                    doc.descendants((node) => {
                        if (node.marks) {
                            const cm = node.marks.find((m) => m.type.name === 'comment');
                            if (cm?.attrs.id) existingIds.add(cm.attrs.id);
                        }
                    });
                }

                for (const annotation of frame.annotations) {
                    if (!isExternalReload && existingIds.has(annotation.id)) continue;

                    const pos = lineNumberToPos(doc, annotation.line);
                    if (pos <= 0 || pos >= doc.content.size) continue;

                    const $pos = doc.resolve(pos);
                    const blockNode = $pos.parent;
                    const blockStart = $pos.start();
                    const blockEnd = blockStart + blockNode.content.size;

                    if (blockEnd > blockStart) {
                        const commentMark = editor.schema.marks.comment.create({
                            comment: annotation.text,
                            id: annotation.id,
                        });
                        tr.addMark(blockStart, blockEnd, commentMark);
                        applied = true;
                    }
                }

                if (applied && !cancelled) {
                    editor.view.dispatch(tr);
                    extractComments(editor);
                }
            } catch (err) {
                console.warn('Failed to load FRAME annotations:', err);
            }
        };

        // Delay to ensure editor content is settled after tab switch
        const timer = setTimeout(loadFrameAnnotations, 100);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [activeTabId, editor, workspacePath, activeFile?.path, activeFile?.isQuipu, frameReloadKey]);

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
        // Save current selection before showing input (clicking textarea will deselect)
        const { from, to } = editor.state.selection;
        savedSelectionRef.current = { from, to };

        // Calculate position for input box
        const coords = editor.view.coordsAtPos(from);
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

            const sel = savedSelectionRef.current;
            const from = sel ? sel.from : editor.state.selection.from;
            const to = sel ? sel.to : editor.state.selection.to;
            const lineNumber = posToLineNumber(editor.state.doc, from);

            // Apply comment mark directly via ProseMirror transaction to avoid
            // focus() restoring a stale/collapsed selection
            const markType = editor.schema.marks.comment;
            const mark = markType.create({ comment: commentText, id: commentId });
            const tr = editor.state.tr.addMark(from, to, mark);
            editor.view.dispatch(tr);

            savedSelectionRef.current = null;
            setCommentText('');
            setCommentType('comment');
            setShowCommentInput(false);
            extractComments(editor);

            // Sync to FRAME (fire-and-forget)
            if (workspacePath && activeFile?.path) {
                recentFrameSaveRef.current = Date.now();
                frameService.addAnnotation(workspacePath, activeFile.path, {
                    id: commentId,
                    line: lineNumber,
                    text: commentText,
                    type: commentType,
                    author: 'user',
                }).catch((err) => {
                    console.warn('Failed to sync comment to FRAME:', err);
                });
            }

            // Generate prompt (available for AI integrations)
            generatePrompt(editor);
        }
    };

    const cancelComment = () => {
        setCommentText('');
        setCommentType('comment');
        setShowCommentInput(false);
        savedSelectionRef.current = null;
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

        // Remove from FRAME (fire-and-forget)
        if (workspacePath && activeFile?.path) {
            recentFrameSaveRef.current = Date.now();
            frameService.removeAnnotation(workspacePath, activeFile.path, commentId).catch((err) => {
                console.warn('Failed to remove FRAME annotation:', err);
            });
        }
    };

    return (
        <div className="flex flex-col h-full w-full bg-bg-surface overflow-hidden relative">
            {editorMode === 'richtext' && editor && (
                <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-border bg-bg-surface">
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleBold().run()}
                        isActive={editor.isActive('bold')}
                        title="Bold (Ctrl+B)"
                    >
                        <TextBIcon size={16} weight="bold" />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleItalic().run()}
                        isActive={editor.isActive('italic')}
                        title="Italic (Ctrl+I)"
                    >
                        <TextItalicIcon size={16} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleStrike().run()}
                        isActive={editor.isActive('strike')}
                        title="Strikethrough"
                    >
                        <TextStrikethroughIcon size={16} />
                    </ToolbarButton>

                    <ToolbarSeparator />

                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                        isActive={editor.isActive('heading', { level: 1 })}
                        title="Heading 1"
                    >
                        <TextHOneIcon size={16} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                        isActive={editor.isActive('heading', { level: 2 })}
                        title="Heading 2"
                    >
                        <TextHTwoIcon size={16} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                        isActive={editor.isActive('heading', { level: 3 })}
                        title="Heading 3"
                    >
                        <TextHThreeIcon size={16} />
                    </ToolbarButton>

                    <ToolbarSeparator />

                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleBulletList().run()}
                        isActive={editor.isActive('bulletList')}
                        title="Bullet List"
                    >
                        <ListBulletsIcon size={16} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleOrderedList().run()}
                        isActive={editor.isActive('orderedList')}
                        title="Ordered List"
                    >
                        <ListNumbersIcon size={16} />
                    </ToolbarButton>

                    <ToolbarSeparator />

                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleBlockquote().run()}
                        isActive={editor.isActive('blockquote')}
                        title="Blockquote"
                    >
                        <QuotesIcon size={16} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleCode().run()}
                        isActive={editor.isActive('code')}
                        title="Inline Code"
                    >
                        <CodeIcon size={16} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                        isActive={editor.isActive('codeBlock')}
                        title="Code Block"
                    >
                        <CodeBlockIcon size={16} />
                    </ToolbarButton>

                    <ToolbarSeparator />

                    <ToolbarButton
                        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
                        isActive={editor.isActive('table')}
                        title="Insert Table"
                        disabled={editor.isActive('table')}
                    >
                        <TableIcon size={16} />
                    </ToolbarButton>

                    <div className="flex-1" />

                    <div className="flex items-center gap-0.5">
                        <ToolbarButton
                            onClick={handleZoomOut}
                            disabled={zoomLevel <= ZOOM_MIN}
                            title="Zoom out"
                        >
                            <MagnifyingGlassMinusIcon size={16} />
                        </ToolbarButton>
                        <span className="text-[11px] text-text-secondary min-w-[36px] text-center select-none">
                            {zoomLevel}%
                        </span>
                        <ToolbarButton
                            onClick={handleZoomIn}
                            disabled={zoomLevel >= ZOOM_MAX}
                            title="Zoom in"
                        >
                            <MagnifyingGlassPlusIcon size={16} />
                        </ToolbarButton>
                    </div>

                    <ToolbarSeparator />

                    <button
                        onClick={toggleEditorMode}
                        className="text-[11px] text-text-tertiary hover:text-text-secondary px-2 py-1 rounded hover:bg-bg-elevated transition-colors"
                        title="Switch to Obsidian mode"
                    >
                        Rich Text
                    </button>
                </div>
            )}

            {editorMode === 'obsidian' && editor && (
                <div className="shrink-0 flex items-center justify-end gap-1 px-4 py-1.5 border-b border-border bg-bg-surface">
                    <div className="flex items-center gap-0.5">
                        <button
                            onClick={handleZoomOut}
                            disabled={zoomLevel <= ZOOM_MIN}
                            className={cn(
                                "p-1 rounded text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors",
                                zoomLevel <= ZOOM_MIN && "opacity-30 cursor-not-allowed hover:bg-transparent hover:text-text-secondary",
                            )}
                            title="Zoom out"
                        >
                            <MagnifyingGlassMinusIcon size={14} />
                        </button>
                        <span className="text-[11px] text-text-secondary min-w-[36px] text-center select-none">
                            {zoomLevel}%
                        </span>
                        <button
                            onClick={handleZoomIn}
                            disabled={zoomLevel >= ZOOM_MAX}
                            className={cn(
                                "p-1 rounded text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors",
                                zoomLevel >= ZOOM_MAX && "opacity-30 cursor-not-allowed hover:bg-transparent hover:text-text-secondary",
                            )}
                            title="Zoom in"
                        >
                            <MagnifyingGlassPlusIcon size={14} />
                        </button>
                    </div>
                    <button
                        onClick={toggleEditorMode}
                        className="text-[11px] text-text-tertiary hover:text-text-secondary px-2 py-1 rounded hover:bg-bg-elevated transition-colors"
                        title="Switch to Raw mode"
                    >
                        Obsidian
                    </button>
                </div>
            )}

            {editorMode === 'raw' && (
                <div className="shrink-0 flex items-center justify-end gap-1 px-4 py-1.5 border-b border-border bg-bg-surface">
                    <button
                        onClick={toggleEditorMode}
                        className="text-[11px] text-text-tertiary hover:text-text-secondary px-2 py-1 rounded hover:bg-bg-elevated transition-colors"
                        title="Switch to Rich Text mode"
                    >
                        Raw
                    </button>
                </div>
            )}

            {showFindBar && editorMode !== 'raw' && (
                <FindBar
                    editor={editor}
                    onClose={() => setShowFindBar(false)}
                />
            )}

            <div
                ref={editorScrollRef}
                className={cn(
                    "flex-1 flex justify-center items-start overflow-y-auto relative",
                    "py-12 px-16",
                    "max-[1400px]:justify-start max-[1400px]:pl-12",
                    "max-[1200px]:overflow-x-auto max-[1200px]:p-8",
                    "max-[1150px]:py-6 max-[1150px]:px-4",
                )}
            >
                <div
                    className={cn(
                        "w-[816px] min-h-[1056px] bg-page-bg rounded border border-page-border",
                        "shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.06),0_12px_30px_rgba(0,0,0,0.05)]",
                        "p-16 relative shrink-0 transition-[width,transform] duration-300",
                        "max-[1150px]:w-full max-[1150px]:max-w-[816px]",
                    )}
                    style={zoomLevel !== 100 ? {
                        transform: `scale(${zoomLevel / 100})`,
                        transformOrigin: 'top center',
                    } : undefined}
                    ref={pageRef}
                    onContextMenu={handleEditorContextMenu}
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
                                onAddTag={addFrontmatterTag}
                                onRemoveTag={removeFrontmatterTag}
                                onUpdateTag={updateFrontmatterTag}
                            />
                        </div>
                    )}
                    {displayTitle && (
                        <h1 className="text-3xl font-bold font-editor text-page-text select-none break-words mb-4">
                            {displayTitle}
                        </h1>
                    )}
                    {showMenu && (
                        <div
                            className="flex bg-bg-overlay p-0.5 rounded-lg shadow-lg border border-border"
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
                                onClick={handleCommentClick}
                                className={cn(
                                    "border-none bg-transparent text-text-primary text-sm font-medium py-1.5 px-3 cursor-pointer rounded-md",
                                    "hover:bg-accent/20",
                                    editor.isActive('comment') && "bg-accent/20",
                                )}
                            >
                                Comment
                            </button>
                        </div>
                    )}
                    <div className={editorMode === 'richtext' ? 'editor-richtext' : editorMode === 'obsidian' ? 'editor-obsidian' : 'editor-raw'}>
                        {editorMode === 'raw' ? (
                            <textarea
                                className="whitespace-pre-wrap font-mono text-sm p-4 text-page-text bg-page-bg w-full overflow-auto resize-none outline-none border-none absolute inset-0"
                                style={{ fontFamily: 'var(--font-mono)' }}
                                value={rawContent}
                                onChange={handleRawContentChange}
                                spellCheck={false}
                            />
                        ) : (
                            <EditorContent editor={editor} />
                        )}
                    </div>
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
                            className="absolute w-[280px] bg-bg-surface rounded-lg shadow-lg p-3 pointer-events-auto border border-accent z-[100]"
                            style={{ top: commentInputTop }}
                        >
                            <textarea
                                value={commentText}
                                onChange={(e) => setCommentText(e.target.value)}
                                onKeyDown={(e) => {
                                    if (((e.ctrlKey || e.metaKey) || e.shiftKey) && e.key === 'Enter') {
                                        e.preventDefault();
                                        addComment();
                                    }
                                    if (e.key === 'Escape') {
                                        cancelComment();
                                    }
                                }}
                                placeholder="Type your comment..."
                                autoFocus
                                className="w-full border border-border-focus rounded py-2 px-2 font-[inherit] text-sm resize-y min-h-[60px] outline-none mb-2 text-page-text focus:border-accent focus:shadow-[0_0_0_2px_rgba(196,131,90,0.3)]"
                            />
                            <div className="flex items-center justify-between gap-2">
                                <select
                                    value={commentType}
                                    onChange={(e) => setCommentType(e.target.value)}
                                    className="text-[11px] bg-bg-elevated border border-border rounded px-1.5 py-1 text-text-secondary outline-none cursor-pointer"
                                >
                                    {ANNOTATION_TYPES.map(t => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                                <div className="flex gap-2">
                                    <button
                                        onClick={cancelComment}
                                        className="py-1.5 px-3 rounded text-[13px] font-medium cursor-pointer border-none bg-transparent text-text-tertiary hover:bg-bg-elevated"
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
                        </div>
                    )}

                    {comments.map((c, i) => (
                        <div
                            key={c.id || i}
                            ref={el => commentsRef.current[i] = el}
                            className="absolute w-[280px] bg-bg-surface rounded-lg shadow-md p-3 pointer-events-auto border border-transparent hover:shadow-lg"
                            style={{
                                top: adjustedPositions[i] !== undefined ? adjustedPositions[i] : c.top,
                                transition: 'top 0.3s ease-out'
                            }}
                        >
                            <div className="flex justify-between mb-1 text-xs">
                                <select
                                    value={c.type || 'comment'}
                                    onChange={(e) => {
                                        // Update type in FRAME — Editor comments don't store type on the mark,
                                        // only in the sidebar display. Update local state + FRAME.
                                        const newType = e.target.value;
                                        setComments(prev => prev.map(cm =>
                                            cm.id === c.id ? { ...cm, type: newType } : cm
                                        ));
                                        if (workspacePath && activeFile?.path) {
                                            frameService.readFrame(workspacePath, activeFile.path).then(frame => {
                                                if (!frame?.annotations) return;
                                                const ann = frame.annotations.find(a => a.id === c.id);
                                                if (ann) {
                                                    ann.type = newType;
                                                    frame.updatedAt = new Date().toISOString();
                                                    const relativePath = activeFile.path.startsWith(workspacePath + '/')
                                                        ? activeFile.path.substring(workspacePath.length + 1)
                                                        : activeFile.path;
                                                    const framePath = `${workspacePath}/.quipu/meta/${relativePath}.frame.json`;
                                                    recentFrameSaveRef.current = Date.now();
                                                    fs.writeFile(framePath, JSON.stringify(frame, null, 2));
                                                }
                                            }).catch(() => {});
                                        }
                                    }}
                                    className={`px-1 py-0.5 rounded text-[10px] font-medium border-none outline-none cursor-pointer ${TYPE_COLORS[c.type] || TYPE_COLORS.comment}`}
                                >
                                    {ANNOTATION_TYPES.map(t => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                                <div className="flex gap-2 items-center">
                                    <button
                                        className="border-none bg-transparent text-text-secondary cursor-pointer py-0.5 px-1.5 rounded flex items-center justify-center transition-colors hover:bg-bg-elevated hover:text-page-text"
                                        onClick={() => resolveComment(c.id)}
                                        title="Resolve comment"
                                    >
                                        <XIcon size={14} />
                                    </button>
                                </div>
                            </div>
                            <div className="text-sm text-page-text mb-2 whitespace-pre-wrap">{c.comment}</div>
                            <div className="text-xs text-text-secondary border-l-2 border-warning pl-2 italic whitespace-nowrap overflow-hidden text-ellipsis">"{c.text}"</div>
                        </div>
                    ))}
                </div>

                {/* Table Context Menu */}
                {tableContextMenu && (
                    <div
                        className="fixed z-50 bg-bg-surface border border-border rounded-md shadow-lg py-1 min-w-[180px]"
                        style={{
                            top: tableContextMenu.y,
                            left: tableContextMenu.x,
                            ...(tableContextMenu.x + 180 > window.innerWidth
                                ? { left: tableContextMenu.x - 180 }
                                : {}),
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <div
                            className="py-1.5 px-4 cursor-pointer text-[13px] text-text-secondary hover:bg-accent hover:text-white"
                            onClick={() => { editor.chain().focus().addRowBefore().run(); closeTableMenu(); }}
                        >
                            Add Row Above
                        </div>
                        <div
                            className="py-1.5 px-4 cursor-pointer text-[13px] text-text-secondary hover:bg-accent hover:text-white"
                            onClick={() => { editor.chain().focus().addRowAfter().run(); closeTableMenu(); }}
                        >
                            Add Row Below
                        </div>
                        <div
                            className="py-1.5 px-4 cursor-pointer text-[13px] text-text-secondary hover:bg-accent hover:text-white"
                            onClick={() => { editor.chain().focus().addColumnBefore().run(); closeTableMenu(); }}
                        >
                            Add Column Left
                        </div>
                        <div
                            className="py-1.5 px-4 cursor-pointer text-[13px] text-text-secondary hover:bg-accent hover:text-white"
                            onClick={() => { editor.chain().focus().addColumnAfter().run(); closeTableMenu(); }}
                        >
                            Add Column Right
                        </div>
                        <div className="h-px bg-border mx-2 my-1" />
                        <div
                            className="py-1.5 px-4 cursor-pointer text-[13px] text-text-secondary hover:bg-accent hover:text-white"
                            onClick={() => { editor.chain().focus().deleteRow().run(); closeTableMenu(); }}
                        >
                            Delete Row
                        </div>
                        <div
                            className="py-1.5 px-4 cursor-pointer text-[13px] text-text-secondary hover:bg-accent hover:text-white"
                            onClick={() => { editor.chain().focus().deleteColumn().run(); closeTableMenu(); }}
                        >
                            Delete Column
                        </div>
                        <div className="h-px bg-border mx-2 my-1" />
                        <div
                            className="py-1.5 px-4 cursor-pointer text-[13px] text-error hover:bg-error hover:text-white"
                            onClick={() => { editor.chain().focus().deleteTable().run(); closeTableMenu(); }}
                        >
                            Delete Table
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Editor;
