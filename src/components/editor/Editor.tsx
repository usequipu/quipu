import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { ChangeEvent } from 'react';
import {
    XIcon, TextBIcon, TextItalicIcon, TextStrikethroughIcon,
    TextHOneIcon, TextHTwoIcon, TextHThreeIcon,
    ListBulletsIcon, ListNumbersIcon, QuotesIcon, CodeIcon, CodeBlockIcon,
    TableIcon, MagnifyingGlassPlusIcon, MagnifyingGlassMinusIcon, ChatCircleDotsIcon,
    WarningIcon, CaretDownIcon, CaretRightIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor as TiptapEditor, JSONContent } from '@tiptap/react';
import type { EditorView } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import { RevealMarkdown } from './extensions/RevealMarkdown';
import { BlockDragHandle } from './extensions/BlockDragHandle';
import { FindReplace } from './extensions/FindReplace';
import { WikiLink, wikiLinksToHTML } from './extensions/WikiLink';
import { CodeBlockWithLang } from './extensions/CodeBlockWithLang';
import { EmbeddedDatabase } from './extensions/EmbeddedDatabase';
import { SlashCommand } from './extensions/SlashCommand';
import type { SlashCommandItem } from './extensions/SlashCommand';
import FindBar from './FindBar';
import SlashCommandMenu from './SlashCommandMenu';
import type { SlashCommandMenuRef } from './SlashCommandMenu';
import CommentPanel from './CommentPanel';
import FrontmatterProperties from './FrontmatterProperties';
import frameService from '../../services/frameService';
import type { FrameAnnotation, FrameAnnotationResponse } from '../../services/frameService';
import fs from '../../services/fileSystem';
import type { Tab } from '../../types/tab';

// ---------- Local types ----------

type EditorMode = 'richtext' | 'obsidian' | 'raw';

type AnnotationTypeLabel = 'comment' | 'review' | 'todo' | 'bug' | 'question' | 'instruction';

interface MenuPosition {
    top: number;
    left: number;
}

interface TableContextMenuPosition {
    x: number;
    y: number;
}

interface SavedSelection {
    from: number;
    to: number;
}

interface CommentData {
    text: string;
    comment: string;
    id: string;
    pos: number;
    top: number;
    type?: string;
}

interface ToolbarButtonProps {
    onClick: () => void;
    isActive?: boolean;
    title: string;
    disabled?: boolean;
    children: React.ReactNode;
}

interface EditorProps {
    onEditorReady: (editor: TiptapEditor) => void;
    onContentChange: (rawContent?: string) => void;
    onRawModeChange: (isRaw: boolean) => void;
    onToggleEditorModeRef: React.MutableRefObject<(() => void) | null>;
    onToggleFindRef: React.MutableRefObject<(() => void) | null>;
    activeFile: { path: string; name: string; content: string | JSONContent | null; isQuipu: boolean } | null;
    activeTabId: string | null;
    activeTab: Tab | null;
    snapshotTab: (tabId: string, json: JSONContent, scrollPosition: number) => void;
    workspacePath: string | null;
    openFile: (path: string, name: string) => void;
    revealFolder: (path: string) => void;
    updateFrontmatter: (tabId: string, key: string, value: unknown) => void;
    addFrontmatterProperty: (tabId: string) => void;
    removeFrontmatterProperty: (tabId: string, key: string) => void;
    renameFrontmatterKey: (tabId: string, oldKey: string, newKey: string) => void;
    toggleFrontmatterCollapsed: (tabId: string) => void;
    addFrontmatterTag: (tabId: string, key: string, tag: string) => void;
    removeFrontmatterTag: (tabId: string, key: string, index: number) => void;
    updateFrontmatterTag: (tabId: string, key: string, index: number, value: string) => void;
}

// Map an editor position to a 1-based content-relative line number.
// Uses '\n' as block separator so each ProseMirror block boundary = one newline,
// matching the server's newline-based counting of the plain-text corpus.
// Frontmatter is stored in tab state (not in the doc), so no stripping needed.
const posToLineNumber = (editor: TiptapEditor, pos: number): number => {
    const text = editor.state.doc.textBetween(0, pos, '\n');
    return text.split('\n').length; // split on '\n' gives 1-based count
};

// Map a 1-based content-relative line number to a ProseMirror position.
// Walks the plain text (same '\n' block separator) to find the character offset
// of line N, then binary-searches for the corresponding ProseMirror position.
const lineNumberToPos = (editor: TiptapEditor, lineNumber: number): number => {
    const doc = editor.state.doc;
    const fullText = doc.textBetween(0, doc.content.size, '\n');
    const lines = fullText.split('\n');

    if (lineNumber < 1) return 1;
    if (lineNumber > lines.length) return doc.content.size;

    // Compute character offset of the first char of line N
    let charOffset = 0;
    for (let i = 1; i < lineNumber; i++) {
        charOffset += lines[i - 1].length + 1; // +1 for the '\n' separator
    }

    if (charOffset === 0) return 1; // line 1 → start of first block content

    // Binary search: smallest ProseMirror pos p where textBetween(0,p,'\n').length >= charOffset
    let lo = 0;
    let hi = doc.content.size;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (doc.textBetween(0, mid, '\n').length < charOffset) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }

    // Advance past block boundaries (depth=0 means at doc level, between blocks)
    while (lo < doc.content.size && doc.resolve(lo).depth === 0) {
        lo++;
    }

    return lo;
};

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ onClick, isActive, title, disabled, children }) => (
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

const ToolbarSeparator: React.FC = () => <div className="editor-toolbar-separator" />;

const Editor: React.FC<EditorProps> = ({
    onEditorReady, onContentChange, onRawModeChange, onToggleEditorModeRef, onToggleFindRef,
    activeFile, activeTabId, activeTab, snapshotTab,
    workspacePath, openFile, revealFolder,
    updateFrontmatter, addFrontmatterProperty, removeFrontmatterProperty,
    renameFrontmatterKey, toggleFrontmatterCollapsed,
    addFrontmatterTag, removeFrontmatterTag, updateFrontmatterTag,
}) => {
    const ANNOTATION_TYPES: AnnotationTypeLabel[] = ['comment', 'review', 'todo', 'bug', 'question', 'instruction'];
    const TYPE_COLORS: Record<AnnotationTypeLabel, string> = {
        comment: 'bg-text-tertiary/20 text-text-secondary',
        review: 'bg-accent/20 text-accent',
        todo: 'bg-info/20 text-info',
        bug: 'bg-error/20 text-error',
        question: 'bg-warning/20 text-warning',
        instruction: 'bg-success/20 text-success',
    };

    const [commentText, setCommentText] = useState<string>('');
    const [commentType, setCommentType] = useState<AnnotationTypeLabel>('comment');
    const [menuPosition, setMenuPosition] = useState<MenuPosition>({ top: 0, left: 0 });
    const [showMenu, setShowMenu] = useState<boolean>(false);
    const [comments, setComments] = useState<CommentData[]>([]);
    const [showCommentInput, setShowCommentInput] = useState<boolean>(false);
    const [detachedAnnotations, setDetachedAnnotations] = useState<FrameAnnotation[]>([]);
    const [commentResponses, setCommentResponses] = useState<Record<string, FrameAnnotationResponse[]>>({});
    const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
    const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});

    const toggleThread = (id: string) => setExpandedThreads(prev => ({ ...prev, [id]: !prev[id] }));
    const [commentPortalTarget, setCommentPortalTarget] = useState<HTMLElement | null>(null);

    const savedSelectionRef = useRef<SavedSelection | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const pageRef = useRef<HTMLDivElement | null>(null);
    const commentWrapperRef = useRef<HTMLDivElement | null>(null);
    const commentsRef = useRef<Record<number, HTMLDivElement | null>>({});
    const loadedTabRef = useRef<string | null>(null);
    const isLoadingContentRef = useRef<boolean>(false); // suppress onUpdate during setContent
    const recentFrameSaveRef = useRef<number>(0); // timestamp of our last FRAME write

    const [showFindBar, setShowFindBar] = useState<boolean>(false);
    const [commentsOverflow, setCommentsOverflow] = useState<boolean>(false);
    const [commentPanelOpen, setCommentPanelOpen] = useState<boolean>(false);
    const [commentsVisible, setCommentsVisible] = useState<boolean>(true);
    const [commentTrackLeft, setCommentTrackLeft] = useState<number>(0);

    // Editor mode: 'richtext' (default) or 'obsidian'
    const [editorMode, setEditorMode] = useState<EditorMode>(() => {
        return (localStorage.getItem('quipu-editor-mode') as EditorMode) || 'richtext';
    });

    // Refs to access editor/rawContent inside toggleEditorMode without temporal dead zone
    const editorRefForToggle = useRef<TiptapEditor | null>(null);
    const rawContentRef = useRef<string>('');

    const toggleEditorMode = useCallback(() => {
        setEditorMode((prev: EditorMode) => {
            const cycle: Record<EditorMode, EditorMode> = { richtext: 'obsidian', obsidian: 'raw', raw: 'richtext' };
            const next: EditorMode = cycle[prev] || 'richtext';
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
    const [rawContent, setRawContent] = useState<string>('');
    // Keep ref in sync for toggleEditorMode
    useEffect(() => { rawContentRef.current = rawContent; }, [rawContent]);

    // Sync raw content when switching to raw mode or when active file changes
    useEffect(() => {
        if (editorMode !== 'raw' || !activeFile) return;
        if (activeFile.isQuipu && typeof activeFile.content === 'object') {
            setRawContent(JSON.stringify(activeFile.content, null, 2));
        } else if ((editor?.storage as Record<string, any> | undefined)?.markdown?.getMarkdown) {
            setRawContent((editor!.storage as Record<string, any>).markdown.getMarkdown());
        } else {
            setRawContent(typeof activeFile.content === 'string' ? activeFile.content : '');
        }
    }, [editorMode, activeFile?.path]);

    // Notify parent of raw mode changes for save logic
    useEffect(() => {
        onRawModeChange(editorMode === 'raw');
    }, [editorMode, onRawModeChange]);

    const handleRawContentChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        setRawContent(value);
        if (onContentChange) {
            onContentChange(value);
        }
    }, [onContentChange]);

    // Register toggleEditorMode callback with parent via ref
    useEffect(() => {
        onToggleEditorModeRef.current = toggleEditorMode;
        return () => { onToggleEditorModeRef.current = null; };
    }, [toggleEditorMode, onToggleEditorModeRef]);

    // Register find bar toggle callback with parent via ref
    useEffect(() => {
        onToggleFindRef.current = () => setShowFindBar(prev => !prev);
        return () => { onToggleFindRef.current = null; };
    }, [onToggleFindRef]);

    // Document zoom: 75%-200%, persisted in localStorage, independent of window zoom
    const ZOOM_MIN = 75;
    const ZOOM_MAX = 200;
    const ZOOM_STEP = 25;

    const [zoomLevel, setZoomLevel] = useState<number>(() => {
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
    const editorScrollRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const el = editorScrollRef.current;
        if (!el) return;
        const handler = (e: WheelEvent) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            if (e.deltaY < 0) handleZoomIn();
            else handleZoomOut();
        };
        el.addEventListener('wheel', handler, { passive: false });
        return () => el.removeEventListener('wheel', handler);
    }, [handleZoomIn, handleZoomOut]);

    // Detect if floating comments have space and track their fixed left position
    useEffect(() => {
        const el = editorScrollRef.current;
        if (!el) return;
        const check = () => {
            const scaledDocWidth = 816 * (zoomLevel / 100);
            const needed = scaledDocWidth + 300; // page + comment track (296px) + tiny buffer
            setCommentsOverflow(el.clientWidth < needed);
        };
        check();
        const observer = new ResizeObserver(check);
        observer.observe(el);
        return () => observer.disconnect();
    }, [zoomLevel]);

    // Table context menu state
    const [tableContextMenu, setTableContextMenu] = useState<TableContextMenuPosition | null>(null);
    // General editor context menu state
    const [editorContextMenu, setEditorContextMenu] = useState<{ x: number; y: number } | null>(null);

    const closeTableMenu = useCallback(() => {
        setTableContextMenu(null);
    }, []);

    const closeEditorMenu = useCallback(() => {
        setEditorContextMenu(null);
    }, []);

    const [adjustedPositions, setAdjustedPositions] = useState<Record<number, number>>({});
    const [commentInputTop, setCommentInputTop] = useState<number>(0);

    // Ref keeps handleImageUpload fresh inside the static editorProps closure
    const handleImageUploadRef = useRef<((file: File, view: EditorView, insertPos?: number) => Promise<void>) | null>(null);
    // Ref keeps the TipTap editor accessible inside the static editorProps closure
    const tiptapEditorRef = useRef<TiptapEditor | null>(null);

    // Handle image upload from clipboard paste or file drop
    const handleImageUpload = useCallback(async (file: File, view: EditorView, insertPos?: number) => {
        if (!activeFile?.path || !workspacePath) {
            // No active file context: insert as base64 data URL fallback
            const reader = new FileReader();
            reader.onload = () => {
                const src = reader.result as string;
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
                const src = reader.result as string;
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
    const handleWikiLinkOpenRef = useRef<((linkPath: string) => Promise<void>) | null>(null);
    handleWikiLinkOpenRef.current = useCallback(async (linkPath: string) => {
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
            EmbeddedDatabase,
            SlashCommand.configure({
                suggestion: {
                    render: () => {
                        let component: HTMLDivElement | null = null;
                        let root: any = null; // ReactDOM root
                        let menuRef: SlashCommandMenuRef | null = null;

                        return {
                            onStart: (props: any) => {
                                component = document.createElement('div');
                                component.style.position = 'absolute';
                                component.style.zIndex = '9999';
                                document.body.appendChild(component);

                                const rect = props.clientRect?.();
                                if (rect && component) {
                                    component.style.left = `${rect.left}px`;
                                    component.style.top = `${rect.bottom + 4}px`;
                                }

                                // Use dynamic import to avoid circular deps
                                import('react-dom/client').then(({ createRoot }) => {
                                    if (!component) return;
                                    root = createRoot(component);
                                    root.render(
                                        <SlashCommandMenu
                                            ref={(ref: SlashCommandMenuRef | null) => { menuRef = ref; }}
                                            items={props.items}
                                            command={props.command}
                                        />
                                    );
                                });
                            },
                            onUpdate: (props: any) => {
                                const rect = props.clientRect?.();
                                if (rect && component) {
                                    component.style.left = `${rect.left}px`;
                                    component.style.top = `${rect.bottom + 4}px`;
                                }
                                root?.render(
                                    <SlashCommandMenu
                                        ref={(ref: SlashCommandMenuRef | null) => { menuRef = ref; }}
                                        items={props.items}
                                        command={props.command}
                                    />
                                );
                            },
                            onKeyDown: (props: any) => {
                                if (props.event.key === 'Escape') {
                                    // Insert literal "/" and close
                                    return true;
                                }
                                return menuRef?.onKeyDown(props.event) ?? false;
                            },
                            onExit: () => {
                                root?.unmount();
                                component?.remove();
                                component = null;
                                root = null;
                                menuRef = null;
                            },
                        };
                    },
                },
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
                            parseHTML: (element: HTMLElement) => element.getAttribute('data-comment'),
                            renderHTML: (attributes: Record<string, any>) => {
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
                            parseHTML: (element: HTMLElement) => element.getAttribute('data-id'),
                            renderHTML: (attributes: Record<string, any>) => {
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
            handlePaste: (view: EditorView, event: ClipboardEvent) => {
                const items = event.clipboardData?.items;
                if (!items) return false;

                for (const item of items) {
                    if (item.type.startsWith('image/')) {
                        event.preventDefault();
                        const file = item.getAsFile();
                        if (!file) return true;

                        handleImageUploadRef.current?.(file, view);
                        return true;
                    }
                }

                // Always route text through the markdown parser so that special
                // characters (*  _  [  ]  `  ~  #  -)  are never backslash-escaped
                // in the serialized output. This fixes two bypass paths:
                //   1. Ctrl+Shift+V: tiptap-markdown skips clipboardTextParser when
                //      plainText=true, inserting raw text nodes that get escaped.
                //   2. Ctrl+V with HTML clipboard: ProseMirror prefers text/html over
                //      text/plain, so clipboardTextParser is never called.
                const text = event.clipboardData?.getData('text/plain');
                const currentEditor = tiptapEditorRef.current;
                if (text && currentEditor) {
                    const parser = (currentEditor.storage as Record<string, any>).markdown?.parser;
                    if (parser) {
                        try {
                            const html = parser.parse(text) as string;
                            currentEditor.commands.insertContent(html, {
                                parseOptions: { preserveWhitespace: true },
                            });
                            return true;
                        } catch {
                            // If parsing or insertion fails, fall through to default paste
                            return false;
                        }
                    }
                }

                return false;
            },
            handleDrop: (view: EditorView, event: DragEvent) => {
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
                    handleImageUploadRef.current?.(imageFile, view, pos.pos);
                } else {
                    handleImageUploadRef.current?.(imageFile, view);
                }
                return true;
            },
            handleClick: (view: EditorView, pos: number, event: globalThis.MouseEvent) => {
                const target = event.target as HTMLElement;
                // Handle external link clicks — open in new tab/system browser
                if (target.tagName === 'A' && (target as HTMLAnchorElement).href) {
                    const href = (target as HTMLAnchorElement).href;
                    if (href.startsWith('http://') || href.startsWith('https://')) {
                        event.preventDefault();
                        window.open(href, '_blank');
                        return true;
                    }
                }
                return false;
            },
        },
        onUpdate: ({ editor }: { editor: TiptapEditor }) => {
            // Skip updates triggered by programmatic setContent during tab loading
            if (isLoadingContentRef.current) return;
            if (onContentChange) {
                onContentChange();
            }
            extractComments(editor);
        },
        onSelectionUpdate: ({ editor }: { editor: TiptapEditor }) => {
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

            const rawLeft = (start.left + end.left) / 2;
            const rawTop = start.top - 40;

            // Clamp within viewport so popup stays visible in narrow windows
            const popupWidth = 120;
            const left = Math.min(Math.max(rawLeft, popupWidth / 2 + 8), window.innerWidth - popupWidth / 2 - 8);
            const top = Math.max(rawTop, 48); // keep below toolbar (~48px)

            setMenuPosition({ top, left });
            setShowMenu(true);
        },
    });
    tiptapEditorRef.current = editor;

    const handleEditorContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!editor) return;

        // Check if cursor is inside a table
        const isInTable = editor.isActive('table');

        if (isInTable) {
            e.preventDefault();
            setTableContextMenu({ x: e.clientX, y: e.clientY });
        } else {
            e.preventDefault();
            setEditorContextMenu({ x: e.clientX, y: e.clientY });
        }
    }, [editor]);

    // Close table context menu on click outside, Escape, or scroll
    useEffect(() => {
        if (!tableContextMenu) return;

        const handleClick = (): void => closeTableMenu();
        const handleKeyDown = (e: globalThis.KeyboardEvent): void => {
            if (e.key === 'Escape') closeTableMenu();
        };
        const handleScroll = (): void => closeTableMenu();

        document.addEventListener('click', handleClick);
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('scroll', handleScroll, true);

        return () => {
            document.removeEventListener('click', handleClick);
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('scroll', handleScroll, true);
        };
    }, [tableContextMenu, closeTableMenu]);

    // Close general editor context menu
    useEffect(() => {
        if (!editorContextMenu) return;

        const handleClick = (): void => closeEditorMenu();
        const handleKeyDown = (e: globalThis.KeyboardEvent): void => {
            if (e.key === 'Escape') closeEditorMenu();
        };

        document.addEventListener('click', handleClick);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('click', handleClick);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [editorContextMenu, closeEditorMenu]);

    const handleLinkDatabase = useCallback(() => {
        if (!editor) return;
        closeEditorMenu();
        window.dispatchEvent(new CustomEvent('quipu:pick-database', {
            detail: {
                callback: (filePath: string) => {
                    editor.chain().focus().insertContent({
                        type: 'embeddedDatabase',
                        attrs: { src: filePath },
                    }).run();
                },
            },
        }));
    }, [editor, closeEditorMenu]);

    const handleCreateDatabase = useCallback(() => {
        if (!editor) return;
        closeEditorMenu();
        window.dispatchEvent(new CustomEvent('quipu:create-database', {
            detail: {
                callback: (filePath: string) => {
                    editor.chain().focus().insertContent({
                        type: 'embeddedDatabase',
                        attrs: { src: filePath },
                    }).run();
                },
            },
        }));
    }, [editor, closeEditorMenu]);

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
    const frameReloadKey: number = (activeTab as any)?.frameReloadKey ?? 0;

    useEffect(() => {
        if (!editor || !activeFile?.path || !workspacePath || !activeTabId) return;

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

                // Populate the response map for threaded replies.
                if (frame?.annotations) {
                    const map: Record<string, FrameAnnotationResponse[]> = {};
                    for (const ann of frame.annotations) {
                        if (ann.responses && ann.responses.length > 0) {
                            map[ann.id] = ann.responses;
                        }
                    }
                    setCommentResponses(map);
                } else {
                    setCommentResponses({});
                }

                const { doc } = editor.state;
                const { tr } = editor.state;
                let applied = false;

                // Map a corpus character offset (textBetween with '\n') to a ProseMirror position.
                const corpusOffsetToPos = (charOffset: number): number => {
                    if (charOffset === 0) return 1;
                    let lo = 0, hi = doc.content.size;
                    while (lo < hi) {
                        const mid = Math.floor((lo + hi) / 2);
                        if (doc.textBetween(0, mid, '\n').length < charOffset) lo = mid + 1;
                        else hi = mid;
                    }
                    while (lo < doc.content.size && doc.resolve(lo).depth === 0) lo++;
                    return lo;
                };

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
                    if (applied && !cancelled) {
                        isLoadingContentRef.current = true;
                        editor.view.dispatch(tr);
                        isLoadingContentRef.current = false;
                        extractComments(editor);
                    }
                    if (!cancelled) setDetachedAnnotations([]);
                    return;
                }

                // Split annotations into attached and detached
                const freshDetached: FrameAnnotation[] = [];
                const corpus = doc.textBetween(0, doc.content.size, '\n');

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
                    if (annotation.detached) {
                        freshDetached.push(annotation);
                        continue;
                    }
                    if (!isExternalReload && existingIds.has(annotation.id)) continue;
                    if (annotation.line == null) continue;

                    const pos = lineNumberToPos(editor, annotation.line);
                    if (pos <= 0 || pos >= doc.content.size) continue;

                    const commentMark = editor.schema.marks.comment.create({
                        comment: annotation.text,
                        id: annotation.id,
                    });

                    // Prefer exact selectedText range; fall back to whole block
                    let markApplied = false;
                    if (annotation.selectedText) {
                        const st = annotation.selectedText;
                        const targetOcc = annotation.occurrence ?? 1;
                        let occ = 0;
                        let searchFrom = 0;
                        while (searchFrom <= corpus.length) {
                            const idx = corpus.indexOf(st, searchFrom);
                            if (idx < 0) break;
                            occ++;
                            if (occ === targetOcc) {
                                const markFrom = corpusOffsetToPos(idx);
                                const markTo = corpusOffsetToPos(idx + st.length);
                                if (markFrom < markTo && markTo <= doc.content.size) {
                                    tr.addMark(markFrom, markTo, commentMark);
                                    applied = true;
                                    markApplied = true;
                                }
                                break;
                            }
                            searchFrom = idx + 1;
                        }
                    }

                    if (!markApplied) {
                        const $pos = doc.resolve(pos);
                        const blockStart = $pos.start();
                        const blockEnd = blockStart + $pos.parent.content.size;
                        if (blockEnd > blockStart) {
                            tr.addMark(blockStart, blockEnd, commentMark);
                            applied = true;
                        }
                    }
                }

                if (!cancelled) setDetachedAnnotations(freshDetached);

                if (applied && !cancelled) {
                    isLoadingContentRef.current = true;
                    editor.view.dispatch(tr);
                    isLoadingContentRef.current = false;
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


    // Recalculate adjusted positions to prevent overlap.
    // Uses wrapper-local coordinates (matching position:absolute within commentWrapperRef).
    // overflow:hidden on the wrapper clips cards that extend above/below the editor area.
    useEffect(() => {
        const newPositions: Record<number, number> = {};
        let lastBottom = 0;
        const GAP = 16;
        const sortedComments = [...comments].sort((a, b) => a.top - b.top);
        sortedComments.forEach((comment, index) => {
            let top = comment.top;
            if (top >= 0) {
                if (top < lastBottom + GAP) top = lastBottom + GAP;
                const el = commentsRef.current[index];
                const height = el ? el.getBoundingClientRect().height : 80;
                lastBottom = top + height;
            }
            newPositions[index] = top;
        });
        setAdjustedPositions(newPositions);
    }, [comments]);

    const extractComments = (editor: TiptapEditor): void => {
        const commentsData: CommentData[] = [];

        const pageRect = pageRef.current?.getBoundingClientRect();
        const wrapperRect = commentWrapperRef.current?.getBoundingClientRect();
        if (pageRect && wrapperRect) {
            setCommentTrackLeft(pageRect.right - wrapperRect.left + 16);
        }

        editor.state.doc.descendants((node, pos) => {
            if (node.marks) {
                const commentMark = node.marks.find(m => m.type.name === 'comment');
                if (commentMark) {
                    const coords = editor.view.coordsAtPos(pos);
                    // local Y relative to commentWrapperRef (for position:absolute within wrapper)
                    const relativeTop = coords.top - (wrapperRect?.top ?? 0);

                    commentsData.push({
                        text: node.text ?? '',
                        comment: commentMark.attrs.comment,
                        id: commentMark.attrs.id,
                        pos: pos,
                        top: relativeTop
                    });
                }
            }
        });

        // Group grouped comments by ID
        const groupedComments: CommentData[] = [];
        const processedIds = new Set<string>();

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

    const handleCommentClick = (): void => {
        const { from, to } = editor.state.selection;
        savedSelectionRef.current = { from, to };

        const coords = editor.view.coordsAtPos(from);
        const wrapperTop = commentWrapperRef.current?.getBoundingClientRect().top ?? 0;
        setCommentInputTop(coords.top - wrapperTop);
        setShowCommentInput(true);
        setShowMenu(false);

        if (commentsOverflow) {
            setCommentPanelOpen(true);
        }
    };

    const generatePrompt = (editorInstance: TiptapEditor): string => {
        const json = editorInstance.getJSON();

        const serializeNode = (node: JSONContent): string => {
            if (node.type === 'text') {
                const commentMark = node.marks?.find(m => m.type === 'comment');
                if (commentMark) {
                    return `<commented id="${commentMark.attrs?.id}">${node.text}</commented><comment id="${commentMark.attrs?.id}">${commentMark.attrs?.comment}</comment>`;
                }
                return node.text ?? '';
            }

            if (node.content) {
                return node.content.map(serializeNode).join('');
            }

            if (node.type === 'paragraph') {
                return '\n';
            }

            return '';
        };

        if (json.content) {
            return json.content.map(serializeNode).join('');
        }
        return '';
    };

    const addComment = (): void => {
        if (editor && commentText) {
            const commentId = crypto.randomUUID();

            const sel = savedSelectionRef.current;
            const from = sel ? sel.from : editor.state.selection.from;
            const to = sel ? sel.to : editor.state.selection.to;
            const lineNumber = posToLineNumber(editor, from);

            // Capture anchor data for stable re-resolution
            const selectedText = editor.state.doc.textBetween(from, to);
            const contextBefore = editor.state.doc.textBetween(Math.max(0, from - 80), from, '\n');
            const contextAfter = editor.state.doc.textBetween(to, Math.min(editor.state.doc.content.size, to + 80), '\n');

            // Count occurrences of selectedText in the '\n'-delimited corpus
            // (same corpus used by loadFrameAnnotations — must stay in sync)
            const corpus = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n');
            let occurrence: number | null = null;
            if (selectedText) {
                const positions: number[] = [];
                let searchPos = 0;
                while ((searchPos = corpus.indexOf(selectedText, searchPos)) !== -1) {
                    positions.push(searchPos);
                    searchPos += selectedText.length;
                }
                if (positions.length > 1) {
                    const beforeLen = editor.state.doc.textBetween(0, from, '\n').length;
                    let count = positions.length;
                    for (let i = 0; i < positions.length; i++) {
                        if (positions[i] >= beforeLen) { count = i + 1; break; }
                    }
                    occurrence = count;
                }
            }

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
                    selectedText,
                    contextBefore,
                    contextAfter,
                    occurrence,
                }).catch((err) => {
                    console.warn('Failed to sync comment to FRAME:', err);
                });
            }

            // Generate prompt (available for AI integrations)
            generatePrompt(editor);
        }
    };

    const cancelComment = (): void => {
        setCommentText('');
        setCommentType('comment');
        setShowCommentInput(false);
        savedSelectionRef.current = null;
    };

    // Seed commentTrackLeft immediately after mount so the track renders even if
    // extractComments fires before refs are available (React commits refs before effects run,
    // so useLayoutEffect here is guaranteed to see non-null refs).
    useEffect(() => {
        const wrapperEl = commentWrapperRef.current;
        const pageEl = pageRef.current;
        if (wrapperEl && pageEl) {
            setCommentTrackLeft(
                pageEl.getBoundingClientRect().right - wrapperEl.getBoundingClientRect().left + 16
            );
        }
        if (wrapperEl) setCommentPortalTarget(wrapperEl);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Re-extract after zoom/frontmatter changes. The page div has a 300ms CSS transition
    // on transform/margin, so we wait for transitionend for accurate coords.
    // A 350ms fallback covers cases where no transition fires (e.g. same zoom level).
    useEffect(() => {
        if (!editor || editor.isDestroyed) return;
        const page = pageRef.current;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const run = () => {
            if (!editor.isDestroyed) extractComments(editor);
        };

        const onTransitionEnd = (e: TransitionEvent) => {
            if (e.propertyName === 'transform' || e.propertyName === 'margin-right') {
                if (timer) clearTimeout(timer);
                run();
            }
        };

        page?.addEventListener('transitionend', onTransitionEnd);
        timer = setTimeout(run, 350); // fallback after transition duration

        return () => {
            page?.removeEventListener('transitionend', onTransitionEnd);
            if (timer) clearTimeout(timer);
        };
    }, [zoomLevel, activeTab?.frontmatterCollapsed]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const el = editorScrollRef.current;
        if (!el || !editor || editor.isDestroyed) return;

        let rafId: number | null = null;
        const debouncedRefresh = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                if (!editor.isDestroyed) extractComments(editor);
            });
        };

        el.addEventListener('scroll', debouncedRefresh, { passive: true });
        window.addEventListener('resize', debouncedRefresh);
        return () => {
            el.removeEventListener('scroll', debouncedRefresh);
            window.removeEventListener('resize', debouncedRefresh);
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleAddReply = async (commentId: string): Promise<void> => {
        if (!workspacePath || !activeFile?.path) return;
        const body = (replyDrafts[commentId] ?? '').trim();
        if (!body) return;
        try {
            const updated = await frameService.addResponse(workspacePath, activeFile.path, commentId, { body, author: 'user' });
            if (updated) {
                const map: Record<string, FrameAnnotationResponse[]> = {};
                for (const ann of updated.annotations) {
                    if (ann.responses && ann.responses.length > 0) map[ann.id] = ann.responses;
                }
                setCommentResponses(map);
                recentFrameSaveRef.current = Date.now();
            }
            setReplyDrafts((prev) => {
                const next = { ...prev };
                delete next[commentId];
                return next;
            });
        } catch (err) {
            console.warn('[frame] addResponse failed', err);
        }
    };

    const handleRemoveReply = async (commentId: string, responseId: string): Promise<void> => {
        if (!workspacePath || !activeFile?.path) return;
        try {
            const updated = await frameService.removeResponse(workspacePath, activeFile.path, commentId, responseId);
            if (updated) {
                const map: Record<string, FrameAnnotationResponse[]> = {};
                for (const ann of updated.annotations) {
                    if (ann.responses && ann.responses.length > 0) map[ann.id] = ann.responses;
                }
                setCommentResponses(map);
                recentFrameSaveRef.current = Date.now();
            }
        } catch (err) {
            console.warn('[frame] removeResponse failed', err);
        }
    };

    const resolveComment = (commentId: string): void => {
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

    const scrollToComment = useCallback((commentId: string) => {
        if (!editor) return;
        editor.state.doc.descendants((node, pos) => {
            const mark = node.marks?.find(m => m.type.name === 'comment' && m.attrs.id === commentId);
            if (mark) {
                // Focus and select the commented text
                editor.chain().focus().setTextSelection(pos).run();
                // Scroll the editor's scroll container to show the position
                const coords = editor.view.coordsAtPos(pos);
                const scrollEl = editorScrollRef.current;
                if (scrollEl) {
                    const scrollRect = scrollEl.getBoundingClientRect();
                    const targetY = coords.top - scrollRect.top + scrollEl.scrollTop - scrollEl.clientHeight / 3;
                    scrollEl.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
                }
                return false;
            }
        });
    }, [editor]);

    const handleCommentTypeChange = useCallback((commentId: string, newType: string) => {
        setComments(prev => prev.map(cm =>
            cm.id === commentId ? { ...cm, type: newType } : cm
        ));
        if (workspacePath && activeFile?.path) {
            frameService.readFrame(workspacePath, activeFile.path).then(frame => {
                if (!frame?.annotations) return;
                const ann = frame.annotations.find((a: { id: string }) => a.id === commentId);
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
    }, [workspacePath, activeFile]);

    return (
        <div className="flex flex-col h-full w-full bg-bg-surface overflow-hidden relative">
            {/* Selection popup — rendered via portal to escape any parent stacking context */}
            {showMenu && editor && createPortal(
                <div
                    className="flex bg-bg-overlay p-0.5 rounded-lg shadow-lg border border-border"
                    style={{
                        position: 'fixed',
                        top: menuPosition.top,
                        left: menuPosition.left,
                        transform: 'translateX(-50%)',
                        zIndex: 9999,
                    }}
                    ref={menuRef}
                    onMouseDown={(e) => e.preventDefault()}
                >
                    <button
                        onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleCommentClick();
                        }}
                        className={cn(
                            "border-none bg-transparent text-text-primary text-sm font-medium py-1.5 px-3 cursor-pointer rounded-md",
                            "hover:bg-accent/20",
                            editor.isActive('comment') && "bg-accent/20",
                        )}
                    >
                        Comment
                    </button>
                </div>,
                document.body
            )}


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

                    {comments.length > 0 && (
                        <button
                            onClick={() => {
                                if (commentsOverflow) {
                                    setCommentPanelOpen(prev => !prev);
                                } else {
                                    setCommentsVisible(prev => !prev);
                                }
                            }}
                            className={cn(
                                "flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors",
                                (commentsOverflow ? commentPanelOpen : commentsVisible)
                                    ? "text-accent bg-accent/10"
                                    : "text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated",
                            )}
                            title={(commentsOverflow ? commentPanelOpen : commentsVisible) ? "Hide comments" : "Show comments"}
                        >
                            <ChatCircleDotsIcon size={14} />
                            <span>{comments.length}</span>
                        </button>
                    )}
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

            {/* Flex row: editor scroll area + optional comment panel */}
            <div ref={commentWrapperRef} className="flex flex-1 overflow-hidden relative">
            <div
                ref={editorScrollRef}
                className={cn(
                    "flex-1 flex justify-center items-start overflow-y-auto relative bg-page-bg",
                    "pt-0 pb-12 px-16",
                    "max-[1400px]:justify-start max-[1400px]:pl-12",
                    "max-[1200px]:overflow-x-auto max-[1200px]:px-8 max-[1200px]:pb-8",
                    "max-[1150px]:pb-6 max-[1150px]:px-4",
                )}
            >
                <div
                    className={cn(
                        "w-[816px] bg-page-bg",
                        "pt-6 pb-16 px-10 relative shrink-0 transition-[width,transform,margin] duration-300",
                        !commentsOverflow && commentsVisible && (comments.length > 0 || showCommentInput) && "mr-[296px]",
                        "max-[1150px]:w-full max-[1150px]:max-w-[816px] max-[1150px]:mr-0",
                    )}
                    style={zoomLevel !== 100 ? {
                        transform: `scale(${zoomLevel / 100})`,
                        transformOrigin: 'top center',
                    } : undefined}
                    ref={pageRef}
                    onContextMenu={handleEditorContextMenu}
                >
                    {activeTab && (activeTab.frontmatter || activeTab.frontmatterRaw) && (
                        <div className="-mx-10 -mt-6 mb-6 border-b border-border/30">
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
                    {/* Comment selection menu is rendered outside the scroll container via portal below */}
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

                {/* General Editor Context Menu */}
                {editorContextMenu && (
                    <div
                        className="fixed z-50 bg-bg-overlay border border-border rounded-md shadow-lg py-1 min-w-[180px]"
                        style={{
                            top: editorContextMenu.y,
                            left: editorContextMenu.x,
                            ...(editorContextMenu.x + 180 > window.innerWidth
                                ? { left: editorContextMenu.x - 180 }
                                : {}),
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <div
                            className="py-1.5 px-4 cursor-pointer text-[13px] text-text-secondary hover:bg-accent hover:text-white"
                            onClick={handleLinkDatabase}
                        >
                            Link Database
                        </div>
                        <div
                            className="py-1.5 px-4 cursor-pointer text-[13px] text-text-secondary hover:bg-accent hover:text-white"
                            onClick={handleCreateDatabase}
                        >
                            Create Database
                        </div>
                    </div>
                )}
            </div>

            {/* Floating comment track — absolute-positioned portal into commentWrapperRef.
                overflow:hidden on the wrapper clips cards to the editor area bounds. */}
            {!commentsOverflow && commentsVisible && commentTrackLeft > 0 && commentPortalTarget && createPortal(
                <>
                    {showCommentInput && (
                        <div
                            className="bg-bg-surface rounded-lg shadow-lg p-2.5 border border-accent"
                            style={{ position: 'absolute', top: commentInputTop, left: commentTrackLeft, width: 240, zIndex: 200 }}
                        >
                            <textarea
                                value={commentText}
                                onChange={(e) => setCommentText(e.target.value)}
                                onKeyDown={(e) => {
                                    if (((e.ctrlKey || e.metaKey) || e.shiftKey) && e.key === 'Enter') {
                                        e.preventDefault();
                                        addComment();
                                    }
                                    if (e.key === 'Escape') cancelComment();
                                }}
                                placeholder="Comment..."
                                autoFocus
                                rows={2}
                                className="w-full border border-border rounded py-1.5 px-2 text-[13px] resize-none outline-none mb-1.5 text-page-text focus:border-accent"
                            />
                            <div className="flex items-center justify-between gap-1">
                                <select
                                    value={commentType}
                                    onChange={(e) => setCommentType(e.target.value as AnnotationTypeLabel)}
                                    className="text-[10px] bg-bg-elevated border border-border rounded px-1 py-0.5 text-text-secondary outline-none cursor-pointer"
                                >
                                    {ANNOTATION_TYPES.map(t => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                                <div className="flex gap-1">
                                    <button onClick={cancelComment} className="py-1 px-2 rounded text-[11px] cursor-pointer border-none bg-transparent text-text-tertiary hover:bg-bg-elevated">Cancel</button>
                                    <button onClick={addComment} className="py-1 px-2 rounded text-[11px] cursor-pointer border-none bg-accent text-white hover:bg-accent-hover">Add</button>
                                </div>
                            </div>
                        </div>
                    )}
                    {comments.map((c, i) => {
                        const top = adjustedPositions[i] !== undefined ? adjustedPositions[i] : c.top;
                        const cardEl = commentsRef.current[i];
                        const cardHeight = cardEl ? cardEl.getBoundingClientRect().height : 80;
                        // Hide only when completely scrolled above the wrapper top (local coord 0).
                        // Cards extending below are clipped by overflow:hidden on the wrapper.
                        if (top + cardHeight < 0) return null;
                        return (
                            <div
                                key={c.id || i}
                                ref={(el: HTMLDivElement | null) => { commentsRef.current[i] = el; }}
                                className="bg-bg-surface rounded-lg shadow-md p-3 border border-transparent hover:shadow-lg"
                                style={{
                                    position: 'absolute',
                                    top,
                                    left: commentTrackLeft,
                                    width: 280,
                                    zIndex: 100,
                                    transition: 'top 0.15s ease-out',
                                }}
                            >
                                <div className="flex justify-between mb-1 text-xs">
                                    <select
                                        value={c.type || 'comment'}
                                        onChange={(e) => {
                                            const newType = e.target.value as AnnotationTypeLabel;
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
                                        className={`px-1 py-0.5 rounded text-[10px] font-medium border-none outline-none cursor-pointer ${TYPE_COLORS[(c.type ?? 'comment') as AnnotationTypeLabel] || TYPE_COLORS.comment}`}
                                    >
                                        {ANNOTATION_TYPES.map(t => (
                                            <option key={t} value={t}>{t}</option>
                                        ))}
                                    </select>
                                    <button
                                        className="border-none bg-transparent text-text-tertiary cursor-pointer p-0.5 rounded flex items-center justify-center transition-colors hover:bg-bg-elevated hover:text-page-text"
                                        onClick={() => resolveComment(c.id)}
                                        title="Resolve comment"
                                    >
                                        <XIcon size={12} />
                                    </button>
                                </div>
                                <div className="text-[13px] text-page-text mb-1.5 whitespace-pre-wrap leading-relaxed">{c.comment}</div>
                                <div className="text-[11px] text-text-secondary/60 border-l-2 border-warning/40 pl-2 italic line-clamp-2">"{c.text}"</div>

                                {/* Thread toggle + replies (collapsed by default) */}
                                {(() => {
                                    const replies = commentResponses[c.id] ?? [];
                                    const isOpen = !!expandedThreads[c.id];
                                    return (
                                        <>
                                            {replies.length > 0 && (
                                                <button
                                                    type="button"
                                                    className="mt-2 flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-primary transition-colors"
                                                    onClick={(e) => { e.stopPropagation(); toggleThread(c.id); }}
                                                >
                                                    {isOpen ? <CaretDownIcon size={9} weight="bold" /> : <CaretRightIcon size={9} weight="bold" />}
                                                    <span>{isOpen ? 'Hide' : 'Show'} {replies.length} repl{replies.length === 1 ? 'y' : 'ies'}</span>
                                                </button>
                                            )}
                                            {isOpen && replies.length > 0 && (
                                                <ul className="mt-2 space-y-1.5">
                                                    {replies.map((r) => (
                                                        <li key={r.id} className="group/reply pl-2 border-l-2 border-accent/40">
                                                            <div className="flex items-center justify-between mb-0.5">
                                                                <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">{r.author}</span>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleRemoveReply(c.id, r.id); }}
                                                                    className="opacity-0 group-hover/reply:opacity-100 text-text-tertiary hover:text-error p-0.5 rounded hover:bg-bg-elevated transition-opacity"
                                                                    title="Remove reply"
                                                                >
                                                                    <XIcon size={10} />
                                                                </button>
                                                            </div>
                                                            <div className="text-[12px] text-page-text whitespace-pre-wrap leading-relaxed">{r.body}</div>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </>
                                    );
                                })()}

                                {/* Reply composer */}
                                <div className="mt-2 flex items-start gap-1.5" onClick={(e) => e.stopPropagation()}>
                                    <textarea
                                        value={replyDrafts[c.id] ?? ''}
                                        onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                                        onFocus={() => setExpandedThreads((prev) => ({ ...prev, [c.id]: true }))}
                                        onKeyDown={(e) => {
                                            if ((e.ctrlKey || e.metaKey || e.shiftKey) && e.key === 'Enter') {
                                                e.preventDefault();
                                                handleAddReply(c.id);
                                            }
                                        }}
                                        placeholder="Reply…"
                                        className="flex-1 min-h-[26px] max-h-24 px-2 py-1 rounded border border-border bg-bg-base text-[11px] focus:outline-none focus:border-accent resize-y"
                                        rows={1}
                                    />
                                    {(replyDrafts[c.id] ?? '').trim().length > 0 && (
                                        <button
                                            onClick={() => handleAddReply(c.id)}
                                            className="px-2 h-6 rounded bg-accent text-white text-[10px] font-medium hover:bg-accent-hover"
                                            title="Send reply (Ctrl+Enter)"
                                        >
                                            Send
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </>,
                commentPortalTarget
            )}

            {/* Comment Panel — collapsible side panel (narrow viewport / overflow mode) */}
            {commentsOverflow && (comments.length > 0 || showCommentInput) && commentPanelOpen && (
                <div className="shrink-0 w-[320px] border-l border-border/30 bg-bg-surface overflow-y-auto">
                    <div className="px-4 py-3 border-b border-border/30 sticky top-0 bg-bg-surface z-10 flex items-center justify-between">
                        <span className="text-sm font-medium text-text-primary">
                            Comments ({comments.length})
                        </span>
                        <button
                            onClick={() => setCommentPanelOpen(false)}
                            className="text-text-tertiary hover:text-text-secondary p-1 rounded hover:bg-bg-elevated"
                        >
                            <XIcon size={14} />
                        </button>
                    </div>
                    {/* New comment input — shows at top of panel */}
                    {showCommentInput && (
                        <div className="px-4 py-3 border-b border-accent/30 bg-accent/[0.03]">
                            <textarea
                                value={commentText}
                                onChange={(e) => setCommentText(e.target.value)}
                                onKeyDown={(e) => {
                                    if (((e.ctrlKey || e.metaKey) || e.shiftKey) && e.key === 'Enter') {
                                        e.preventDefault();
                                        addComment();
                                    }
                                    if (e.key === 'Escape') cancelComment();
                                }}
                                placeholder="Comment..."
                                autoFocus
                                rows={2}
                                className="w-full border border-border rounded py-1.5 px-2 text-[13px] resize-none outline-none mb-1.5 text-page-text bg-bg-surface focus:border-accent"
                            />
                            <div className="flex items-center justify-between gap-1">
                                <select
                                    value={commentType}
                                    onChange={(e) => setCommentType(e.target.value as AnnotationTypeLabel)}
                                    className="text-[10px] bg-bg-elevated border border-border rounded px-1 py-0.5 text-text-secondary outline-none cursor-pointer"
                                >
                                    {ANNOTATION_TYPES.map(t => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                                <div className="flex gap-1">
                                    <button onClick={cancelComment} className="py-1 px-2 rounded text-[11px] cursor-pointer border-none bg-transparent text-text-tertiary hover:bg-bg-elevated">Cancel</button>
                                    <button onClick={addComment} className="py-1 px-2 rounded text-[11px] cursor-pointer border-none bg-accent text-white hover:bg-accent-hover">Add</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {comments.map((c) => (
                        <div
                            key={c.id}
                            className="px-4 py-3 border-b border-border/20 hover:bg-bg-elevated/50 cursor-pointer transition-colors"
                            onClick={() => scrollToComment(c.id)}
                        >
                            <div className="flex items-center justify-between mb-1.5">
                                <select
                                    value={c.type || 'comment'}
                                    onChange={(e) => {
                                        e.stopPropagation();
                                        handleCommentTypeChange(c.id, e.target.value);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium border-none outline-none cursor-pointer ${TYPE_COLORS[(c.type ?? 'comment') as AnnotationTypeLabel] || TYPE_COLORS.comment}`}
                                >
                                    {ANNOTATION_TYPES.map(t => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                                <button
                                    onClick={(e) => { e.stopPropagation(); resolveComment(c.id); }}
                                    className="text-text-tertiary hover:text-text-secondary p-0.5 rounded hover:bg-bg-elevated"
                                    title="Resolve"
                                >
                                    <XIcon size={12} />
                                </button>
                            </div>
                            <div className="text-sm text-page-text mb-1.5 whitespace-pre-wrap">{c.comment}</div>
                            <div className="text-xs text-text-tertiary border-l-2 border-warning/50 pl-2 italic truncate">
                                &ldquo;{c.text}&rdquo;
                            </div>

                            {/* Thread toggle + replies (collapsed by default) */}
                            {(() => {
                                const replies = commentResponses[c.id] ?? [];
                                const isOpen = !!expandedThreads[c.id];
                                return (
                                    <>
                                        {replies.length > 0 && (
                                            <button
                                                type="button"
                                                className="mt-2 flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-primary transition-colors"
                                                onClick={(e) => { e.stopPropagation(); toggleThread(c.id); }}
                                            >
                                                {isOpen ? <CaretDownIcon size={10} weight="bold" /> : <CaretRightIcon size={10} weight="bold" />}
                                                <span>{isOpen ? 'Hide' : 'Show'} {replies.length} repl{replies.length === 1 ? 'y' : 'ies'}</span>
                                            </button>
                                        )}
                                        {isOpen && replies.length > 0 && (
                                            <ul className="mt-2 space-y-1.5">
                                                {replies.map((r) => (
                                                    <li key={r.id} className="group/reply pl-3 border-l-2 border-accent/40">
                                                        <div className="flex items-center justify-between mb-0.5">
                                                            <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">{r.author}</span>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleRemoveReply(c.id, r.id); }}
                                                                className="opacity-0 group-hover/reply:opacity-100 text-text-tertiary hover:text-error p-0.5 rounded hover:bg-bg-elevated transition-opacity"
                                                                title="Remove reply"
                                                            >
                                                                <XIcon size={10} />
                                                            </button>
                                                        </div>
                                                        <div className="text-xs text-page-text whitespace-pre-wrap">{r.body}</div>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </>
                                );
                            })()}

                            {/* Reply composer */}
                            <div className="mt-2 flex items-start gap-1.5" onClick={(e) => e.stopPropagation()}>
                                <textarea
                                    value={replyDrafts[c.id] ?? ''}
                                    onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                                    onFocus={() => setExpandedThreads((prev) => ({ ...prev, [c.id]: true }))}
                                    onKeyDown={(e) => {
                                        if ((e.ctrlKey || e.metaKey || e.shiftKey) && e.key === 'Enter') {
                                            e.preventDefault();
                                            handleAddReply(c.id);
                                        }
                                    }}
                                    placeholder="Reply…"
                                    className="flex-1 min-h-[28px] max-h-24 px-2 py-1 rounded border border-border bg-bg-base text-xs focus:outline-none focus:border-accent resize-y"
                                    rows={1}
                                />
                                {(replyDrafts[c.id] ?? '').trim().length > 0 && (
                                    <button
                                        onClick={() => handleAddReply(c.id)}
                                        className="px-2 h-7 rounded bg-accent text-white text-[10px] font-medium hover:bg-accent-hover"
                                        title="Send reply (Ctrl+Enter)"
                                    >
                                        Send
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Detached annotations warning panel */}
            {detachedAnnotations.length > 0 && (
                <div className="shrink-0 w-[320px] border-l border-warning/40 bg-bg-surface overflow-y-auto">
                    <div className="px-4 py-3 border-b border-warning/30 sticky top-0 bg-bg-surface z-10 flex items-center gap-2">
                        <WarningIcon size={14} className="text-warning shrink-0" />
                        <span className="text-sm font-medium text-text-primary">
                            Detached ({detachedAnnotations.length})
                        </span>
                    </div>
                    {detachedAnnotations.map((ann) => (
                        <div key={ann.id} className="px-4 py-3 border-b border-border/20">
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                                <div className="flex items-center gap-1 text-[10px] text-warning font-medium">
                                    <WarningIcon size={10} />
                                    detached
                                </div>
                                <button
                                    onClick={() => {
                                        if (workspacePath && activeFile?.path) {
                                            frameService.removeAnnotation(workspacePath, activeFile.path, ann.id)
                                                .catch(err => console.warn('[frame] remove failed', err));
                                        }
                                    }}
                                    className="text-text-tertiary hover:text-text-secondary p-0.5 rounded hover:bg-bg-elevated shrink-0"
                                    title="Remove annotation"
                                >
                                    <XIcon size={12} />
                                </button>
                            </div>
                            <div className="text-sm text-page-text mb-1.5 whitespace-pre-wrap">{ann.text}</div>
                            {ann.selectedText && (
                                <div className="text-xs text-text-tertiary border-l-2 border-warning/50 pl-2 italic truncate">
                                    &ldquo;{ann.selectedText}&rdquo;
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
            </div>{/* end flex row */}
        </div>
    );
};

export default Editor;
