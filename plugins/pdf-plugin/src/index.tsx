import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { MagnifyingGlassPlusIcon, MagnifyingGlassMinusIcon, ChatTextIcon, XIcon } from '@phosphor-icons/react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import type { PluginApi, ViewerProps, FileSystemService } from '../plugin-types';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PdfAnnotationType = 'comment' | 'review' | 'todo' | 'bug' | 'question' | 'instruction';

interface PdfComment {
  id: string;
  page: number;
  selectedText?: string;
  topRatio?: number;
  text: string;
  type: PdfAnnotationType;
  author?: string;
  timestamp?: string;
}

interface SelectedTextInfo {
  text: string;
  topRatio: number;
  relativeTop: number;
  page: number;
}

interface PageDimension {
  width: number;
  height: number;
}

interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface HighlightData {
  rects: HighlightRect[];
  pageNum: number;
}

interface FrameAnnotation {
  id: string;
  page?: number;
  selectedText?: string;
  topRatio?: number;
  text: string;
  type: string;
  author: string;
  timestamp: string;
}

interface Frame {
  version: number;
  type: string;
  id: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  annotations: FrameAnnotation[];
  instructions: string;
  history: unknown[];
}

// ---------------------------------------------------------------------------
// Inline frame service (uses plugin fileSystem API)
// ---------------------------------------------------------------------------

function makeFrameService(apiFs: FileSystemService) {
  function getFramePath(workspacePath: string, filePath: string): string {
    const relativePath = filePath.startsWith(workspacePath + '/')
      ? filePath.slice(workspacePath.length + 1)
      : filePath;
    return `${workspacePath}/.quipu/meta/${relativePath}.frame.json`;
  }

  function emptyFrame(workspacePath: string, filePath: string): Frame {
    const relativePath = filePath.startsWith(workspacePath + '/')
      ? filePath.slice(workspacePath.length + 1)
      : filePath;
    return {
      version: 1,
      type: 'frame',
      id: crypto.randomUUID(),
      filePath: relativePath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      annotations: [],
      instructions: '',
      history: [],
    };
  }

  async function readFrame(workspacePath: string, filePath: string): Promise<Frame | null> {
    try {
      const content = await apiFs.readFile(getFramePath(workspacePath, filePath));
      if (!content) return null;
      return JSON.parse(content) as Frame;
    } catch {
      return null;
    }
  }

  async function writeFrame(workspacePath: string, filePath: string, frame: Frame): Promise<void> {
    const framePath = getFramePath(workspacePath, filePath);
    const dir = framePath.substring(0, framePath.lastIndexOf('/'));
    try { await apiFs.createFolder(dir); } catch { /* may already exist */ }
    frame.updatedAt = new Date().toISOString();
    await apiFs.writeFile(framePath, JSON.stringify(frame, null, 2));
  }

  async function addAnnotation(
    workspacePath: string,
    filePath: string,
    annotation: Omit<FrameAnnotation, 'timestamp'>,
  ): Promise<void> {
    let frame = await readFrame(workspacePath, filePath);
    if (!frame) frame = emptyFrame(workspacePath, filePath);
    frame.annotations.push({ ...annotation, timestamp: new Date().toISOString() });
    await writeFrame(workspacePath, filePath, frame);
  }

  async function updateAnnotationType(
    workspacePath: string,
    filePath: string,
    id: string,
    type: string,
  ): Promise<void> {
    const frame = await readFrame(workspacePath, filePath);
    if (!frame) return;
    const ann = frame.annotations.find((a) => a.id === id);
    if (ann) { ann.type = type; await writeFrame(workspacePath, filePath, frame); }
  }

  async function removeAnnotation(workspacePath: string, filePath: string, id: string): Promise<void> {
    const frame = await readFrame(workspacePath, filePath);
    if (!frame) return;
    frame.annotations = frame.annotations.filter((a) => a.id !== id);
    await writeFrame(workspacePath, filePath, frame);
  }

  return { readFrame, addAnnotation, updateAnnotationType, removeAnnotation };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANNOTATION_TYPES: PdfAnnotationType[] = ['comment', 'review', 'todo', 'bug', 'question', 'instruction'];
const TYPE_COLORS: Record<PdfAnnotationType, string> = {
  comment:     'bg-text-tertiary/20 text-text-secondary',
  review:      'bg-accent/20 text-accent',
  todo:        'bg-info/20 text-info',
  bug:         'bg-error/20 text-error',
  question:    'bg-warning/20 text-warning',
  instruction: 'bg-success/20 text-success',
};

const PAGE_BUFFER = 5;
const ESTIMATED_PAGE_HEIGHT = 1056;
const PAGE_GAP = 24;

const pdfOptions = {
  cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/standard_fonts/`,
};

// ---------------------------------------------------------------------------
// Component factory (closes over apiFs)
// ---------------------------------------------------------------------------

function makePdfViewer(apiFs: FileSystemService) {
  const frameService = makeFrameService(apiFs);

  return function PdfViewer({ tab, workspacePath }: ViewerProps) {
    const filePath: string = tab.path;

    const [numPages, setNumPages] = useState<number | null>(null);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [zoomPercent, setZoomPercent] = useState<number>(100);
    const [containerWidth, setContainerWidth] = useState<number>(0);
    const [pageInput, setPageInput] = useState<string>('1');
    const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([1]));
    const [pageDimensions, setPageDimensions] = useState<Record<number, PageDimension>>({});

    const [comments, setComments] = useState<PdfComment[]>([]);
    const [showCommentInput, setShowCommentInput] = useState<boolean>(false);
    const [commentText, setCommentText] = useState<string>('');
    const [commentInputTop, setCommentInputTop] = useState<number>(0);
    const [selectedTextInfo, setSelectedTextInfo] = useState<SelectedTextInfo | null>(null);
    const [commentType, setCommentType] = useState<PdfAnnotationType>('comment');
    const [showCommentButton, setShowCommentButton] = useState<boolean>(false);
    const [commentButtonPos, setCommentButtonPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
    const [adjustedPositions, setAdjustedPositions] = useState<Record<string, number>>({});
    const [highlightRects, setHighlightRects] = useState<Record<string, HighlightData>>({});

    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
    const commentsRef = useRef<Record<string, HTMLDivElement | null>>({});

    const fileUrl = useMemo<string>(() => apiFs.getFileUrl(filePath), [filePath]);

    // Measure scroll container width
    useEffect(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const measure = () => setContainerWidth(el.clientWidth);
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    const pageWidth = useMemo(() => {
      if (!containerWidth) return 612;
      const sidebarSpace = containerWidth > 900 ? 340 : 0;
      const available = containerWidth - 48 - sidebarSpace;
      return Math.max(300, (available * zoomPercent) / 100);
    }, [containerWidth, zoomPercent]);

    const renderedPages = useMemo<Set<number>>(() => {
      const rendered = new Set<number>();
      for (const p of visiblePages) {
        for (let i = Math.max(1, p - PAGE_BUFFER); i <= Math.min(numPages || 1, p + PAGE_BUFFER); i++) {
          rendered.add(i);
        }
      }
      return rendered;
    }, [visiblePages, numPages]);

    const visibleComments = useMemo<PdfComment[]>(
      () => comments.filter((c) => visiblePages.has(c.page)),
      [comments, visiblePages],
    );

    // Load comments from FRAME on mount
    const loadComments = useCallback(async (): Promise<void> => {
      if (!workspacePath || !filePath) return;
      try {
        const frame = await frameService.readFrame(workspacePath, filePath);
        if (frame?.annotations) {
          setComments(
            frame.annotations
              .filter((a) => a.page != null)
              .map((a): PdfComment => ({
                id: a.id,
                page: a.page!,
                selectedText: a.selectedText,
                topRatio: a.topRatio,
                text: a.text,
                type: (a.type as PdfAnnotationType) || 'comment',
                author: a.author,
                timestamp: a.timestamp,
              })),
          );
        } else {
          setComments([]);
        }
      } catch {
        setComments([]);
      }
    }, [workspacePath, filePath]);

    useEffect(() => { loadComments(); }, [loadComments]);

    // IntersectionObserver for visible pages
    useEffect(() => {
      if (!numPages || !scrollContainerRef.current) return;
      const observer = new IntersectionObserver(
        (entries) => {
          setVisiblePages((prev) => {
            const next = new Set(prev);
            for (const entry of entries) {
              const n = parseInt((entry.target as HTMLElement).dataset.pageNumber || '0', 10);
              if (entry.isIntersecting) next.add(n);
              else next.delete(n);
            }
            return next;
          });
        },
        { root: scrollContainerRef.current, rootMargin: '200px 0px', threshold: 0.01 },
      );
      for (let i = 1; i <= numPages; i++) {
        const el = pageRefs.current[i];
        if (el) observer.observe(el);
      }
      return () => observer.disconnect();
    }, [numPages]);

    // Track current page from scroll
    useEffect(() => {
      const container = scrollContainerRef.current;
      if (!container || !numPages) return;
      const handleScroll = (): void => {
        const containerMid = container.getBoundingClientRect().top + container.getBoundingClientRect().height / 2;
        let closest = 1, closestDist = Infinity;
        for (let i = 1; i <= numPages; i++) {
          const el = pageRefs.current[i];
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          const dist = Math.abs(rect.top + rect.height / 2 - containerMid);
          if (dist < closestDist) { closestDist = dist; closest = i; }
        }
        setCurrentPage(closest);
        setPageInput(String(closest));
      };
      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => container.removeEventListener('scroll', handleScroll);
    }, [numPages]);

    // Highlight rects and comment positions
    useEffect(() => {
      if (visibleComments.length === 0) { setAdjustedPositions({}); setHighlightRects({}); return; }
      const timer = setTimeout(() => {
        const newPositions: Record<string, number> = {};
        const newHighlights: Record<string, HighlightData> = {};

        const byPage: Record<number, PdfComment[]> = {};
        for (const c of visibleComments) {
          if (!byPage[c.page]) byPage[c.page] = [];
          byPage[c.page].push(c);
        }

        for (const [pageNumStr, pageComments] of Object.entries(byPage)) {
          const pageNum = parseInt(pageNumStr, 10);
          const pageEl = pageRefs.current[pageNum];
          if (!pageEl) continue;
          const pdfPageEl = pageEl.querySelector('.react-pdf__Page') as HTMLElement | null;
          const pageHeight = pdfPageEl?.offsetHeight || ESTIMATED_PAGE_HEIGHT;
          const pageRect = pageEl.getBoundingClientRect();
          const scrollRect = scrollContainerRef.current?.getBoundingClientRect();
          if (!scrollRect) continue;
          const pageTopInContainer = pageEl.offsetTop;

          let lastBottom = 0;
          const GAP = 12;
          const sorted = [...pageComments].sort((a, b) => (a.topRatio || 0) - (b.topRatio || 0));
          sorted.forEach((comment) => {
            let top = pageTopInContainer + (comment.topRatio || 0) * pageHeight;
            const cardEl = commentsRef.current[comment.id];
            const cardHeight = cardEl?.offsetHeight || 80;
            if (top < lastBottom + GAP) top = lastBottom + GAP;
            newPositions[comment.id] = top;
            lastBottom = top + cardHeight;
          });

          const textLayer = pdfPageEl?.querySelector('.react-pdf__Page__textContent');
          if (!textLayer) continue;
          const spans = textLayer.querySelectorAll('span');
          pageComments.forEach((comment) => {
            if (!comment.selectedText) return;
            const expectedTop = (comment.topRatio || 0) * pageHeight;
            const tolerance = pageHeight * 0.05;
            const rects: HighlightRect[] = [];
            for (const span of spans) {
              const spanText = span.textContent || '';
              if (!spanText.trim()) continue;
              const spanRect = span.getBoundingClientRect();
              const relTop = spanRect.top - pageRect.top;
              if (Math.abs(relTop - expectedTop) > tolerance) continue;
              const idx = spanText.indexOf(comment.selectedText);
              if (idx === -1) continue;
              const textNode = span.firstChild;
              if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
              try {
                const range = document.createRange();
                range.setStart(textNode, Math.min(idx, (textNode as Text).length));
                range.setEnd(textNode, Math.min(idx + comment.selectedText.length, (textNode as Text).length));
                const clientRects = range.getClientRects();
                for (const cr of clientRects) {
                  rects.push({ top: cr.top - pageRect.top, left: cr.left - pageRect.left, width: cr.width, height: cr.height });
                }
              } catch {
                rects.push({ top: relTop, left: spanRect.left - pageRect.left, width: spanRect.width, height: spanRect.height });
              }
            }
            if (rects.length > 0) newHighlights[comment.id] = { rects, pageNum };
          });
        }
        setAdjustedPositions(newPositions);
        setHighlightRects(newHighlights);
      }, 350);
      return () => clearTimeout(timer);
    }, [visibleComments, pageWidth, visiblePages]);

    const handleLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
      setNumPages(n);
      setCurrentPage(1);
      setPageInput('1');
      const initial = new Set<number>();
      for (let i = 1; i <= Math.min(n, 1 + PAGE_BUFFER); i++) initial.add(i);
      setVisiblePages(initial);
    }, []);

    const handlePageLoadSuccess = useCallback(
      (pageNum: number) => (page: { width: number; height: number }) => {
        setPageDimensions((prev) => ({ ...prev, [pageNum]: { width: page.width, height: page.height } }));
      },
      [],
    );

    const scrollToPage = useCallback((pageNum: number) => {
      const el = pageRefs.current[pageNum];
      if (el && scrollContainerRef.current) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    const handlePageInputSubmit = useCallback((): void => {
      const num = parseInt(pageInput, 10);
      if (num >= 1 && num <= (numPages || 1)) scrollToPage(num);
      else setPageInput(String(currentPage));
    }, [pageInput, numPages, currentPage, scrollToPage]);

    const handleZoomIn = useCallback(() => setZoomPercent((p) => Math.min(300, p + 10)), []);
    const handleZoomOut = useCallback(() => setZoomPercent((p) => Math.max(30, p - 10)), []);

    // Ctrl+scroll zoom
    useEffect(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const handler = (e: WheelEvent): void => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const scrollRatio = el.scrollHeight > 0 ? el.scrollTop / el.scrollHeight : 0;
        setZoomPercent((prev) => {
          const next = Math.min(300, Math.max(30, prev + (e.deltaY > 0 ? -10 : 10)));
          requestAnimationFrame(() => { el.scrollTop = scrollRatio * el.scrollHeight; });
          return next;
        });
      };
      el.addEventListener('wheel', handler, { passive: false });
      return () => el.removeEventListener('wheel', handler);
    }, []);

    // Text selection → comment button
    const handleMouseUp = useCallback((): void => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (!text || !scrollContainerRef.current) { setShowCommentButton(false); return; }

      const anchorNode = selection!.anchorNode;
      let pageNum: number | null = null;
      let pageEl: HTMLDivElement | null = null;
      for (let i = 1; i <= (numPages || 0); i++) {
        const ref = pageRefs.current[i];
        if (ref && ref.contains(anchorNode)) { pageNum = i; pageEl = ref; break; }
      }
      if (!pageNum || !pageEl) { setShowCommentButton(false); return; }

      const range = selection!.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const pageRect = pageEl.getBoundingClientRect();
      const pdfPageEl = pageEl.querySelector('.react-pdf__Page') as HTMLElement | null;
      const pageHeight = pdfPageEl?.offsetHeight || pageRect.height || ESTIMATED_PAGE_HEIGHT;
      const relativeTop = rect.top - pageRect.top;
      const topRatio = relativeTop / pageHeight;

      const scrollRect = scrollContainerRef.current!.getBoundingClientRect();
      setCommentButtonPos({
        top: rect.top - scrollRect.top + scrollContainerRef.current.scrollTop - 36,
        left: rect.left - scrollRect.left + rect.width / 2 - 16,
      });
      setSelectedTextInfo({ text, topRatio, relativeTop, page: pageNum });
      setShowCommentButton(true);
    }, [numPages]);

    const handleStartComment = useCallback((): void => {
      if (!selectedTextInfo) return;
      const pageEl = pageRefs.current[selectedTextInfo.page];
      if (!pageEl) return;
      setCommentInputTop(pageEl.offsetTop + selectedTextInfo.relativeTop);
      setShowCommentInput(true);
      setShowCommentButton(false);
    }, [selectedTextInfo]);

    const addComment = useCallback(async (): Promise<void> => {
      if (!commentText.trim() || !selectedTextInfo || !workspacePath || !filePath) return;
      const newId = crypto.randomUUID();
      const annotation: PdfComment = {
        id: newId,
        page: selectedTextInfo.page,
        selectedText: selectedTextInfo.text,
        topRatio: selectedTextInfo.topRatio,
        text: commentText.trim(),
        type: commentType,
        author: 'user',
        timestamp: new Date().toISOString(),
      };
      setComments((prev) => [...prev, annotation]);
      frameService.addAnnotation(workspacePath, filePath, {
        id: newId,
        page: annotation.page,
        selectedText: annotation.selectedText,
        topRatio: annotation.topRatio,
        text: annotation.text,
        type: annotation.type,
        author: 'user',
      }).catch((err) => console.warn('Failed to sync PDF comment to FRAME:', err));
      setCommentText('');
      setCommentType('comment');
      setShowCommentInput(false);
      setSelectedTextInfo(null);
      window.getSelection()?.removeAllRanges();
    }, [commentText, commentType, selectedTextInfo, workspacePath, filePath]);

    const cancelComment = useCallback((): void => {
      setCommentText(''); setCommentType('comment');
      setShowCommentInput(false); setSelectedTextInfo(null);
    }, []);

    const handleUpdateCommentType = useCallback(async (commentId: string, newType: PdfAnnotationType): Promise<void> => {
      setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, type: newType } : c));
      if (workspacePath && filePath) {
        frameService.updateAnnotationType(workspacePath, filePath, commentId, newType)
          .catch((err) => console.warn('Failed to update annotation type:', err));
      }
    }, [workspacePath, filePath]);

    const resolveComment = useCallback(async (commentId: string): Promise<void> => {
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      if (workspacePath && filePath) {
        frameService.removeAnnotation(workspacePath, filePath, commentId)
          .catch((err) => console.warn('Failed to remove PDF comment from FRAME:', err));
      }
    }, [workspacePath, filePath]);

    const getPageHeight = useCallback((pageNum: number): number => {
      const dims = pageDimensions[pageNum];
      if (dims) return pageWidth * (dims.height / dims.width);
      return pageWidth * (11 / 8.5);
    }, [pageDimensions, pageWidth]);

    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-bg-surface">
        {/* Toolbar */}
        <div className="flex items-center justify-center gap-4 px-4 py-2 bg-bg-elevated border-b border-border">
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={handlePageInputSubmit}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePageInputSubmit(); }}
              className="w-10 text-center text-sm text-text-primary bg-bg-surface border border-border rounded px-1 py-0.5 outline-none focus:border-accent"
            />
            <span className="text-sm text-text-secondary">/ {numPages || '...'}</span>
          </div>
          <div className="w-px h-4 bg-border" />
          <button onClick={handleZoomOut} className="p-1 rounded hover:bg-white/[0.06] text-text-secondary">
            <MagnifyingGlassMinusIcon size={18} />
          </button>
          <span className="text-xs text-text-tertiary w-12 text-center">{zoomPercent}%</span>
          <button onClick={handleZoomIn} className="p-1 rounded hover:bg-white/[0.06] text-text-secondary">
            <MagnifyingGlassPlusIcon size={18} />
          </button>
        </div>

        {/* PDF content */}
        <div
          className="flex-1 overflow-auto py-6 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:bg-white/15"
          ref={scrollContainerRef}
          onMouseUp={handleMouseUp}
        >
          <div className="relative flex flex-col items-center min-w-fit">
            <Document
              file={fileUrl}
              onLoadSuccess={handleLoadSuccess}
              options={pdfOptions}
              loading={<div className="text-text-tertiary text-sm p-8">Loading PDF...</div>}
              error={<div className="text-error text-sm p-8">Failed to load PDF.</div>}
            >
              {numPages && Array.from({ length: numPages }, (_, i) => {
                const pageNum = i + 1;
                const isRendered = renderedPages.has(pageNum);
                const pageHeight = getPageHeight(pageNum);
                return (
                  <div
                    key={pageNum}
                    ref={(el: HTMLDivElement | null) => { pageRefs.current[pageNum] = el; }}
                    data-page-number={pageNum}
                    className="relative"
                    style={{ marginBottom: PAGE_GAP }}
                  >
                    {isRendered ? (
                      <Page
                        pageNumber={pageNum}
                        width={pageWidth}
                        devicePixelRatio={Math.max(window.devicePixelRatio * 1.5 || 2, (100 / zoomPercent) * (window.devicePixelRatio * 1.5 || 2))}
                        className="shadow-lg"
                        onLoadSuccess={handlePageLoadSuccess(pageNum)}
                        error={<div className="p-4 text-error text-sm">Failed to render page {pageNum}</div>}
                      />
                    ) : (
                      <div
                        className="bg-bg-elevated shadow-lg flex items-center justify-center text-text-tertiary text-sm"
                        style={{ width: pageWidth, height: pageHeight }}
                      >
                        Page {pageNum}
                      </div>
                    )}

                    {/* Highlight overlays */}
                    {Object.entries(highlightRects)
                      .filter(([, data]) => data.pageNum === pageNum)
                      .map(([commentId, data]) =>
                        data.rects.map((rect, ri) => (
                          <div
                            key={`hl-${commentId}-${ri}`}
                            className="absolute bg-accent/20 pointer-events-none rounded-sm"
                            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
                          />
                        )),
                      )}
                  </div>
                );
              })}
            </Document>

            {/* Floating comment button */}
            {showCommentButton && (
              <button
                className="absolute z-50 p-1.5 rounded-lg bg-accent text-white shadow-lg hover:bg-accent-hover transition-colors"
                style={{ top: commentButtonPos.top, left: commentButtonPos.left }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleStartComment}
                title="Add comment"
              >
                <ChatTextIcon size={18} />
              </button>
            )}

            {/* Comment sidebar */}
            <div
              className="absolute top-0 bottom-0 w-[300px] pointer-events-none"
              style={{ left: `calc(50% + ${pageWidth / 2}px + 16px)` }}
            >
              {showCommentInput && (
                <div
                  className="absolute w-[280px] bg-bg-surface rounded-lg shadow-lg p-3 pointer-events-auto border border-accent z-[100]"
                  style={{ top: commentInputTop }}
                >
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey || e.shiftKey) && e.key === 'Enter') { e.preventDefault(); addComment(); }
                      if (e.key === 'Escape') cancelComment();
                    }}
                    placeholder="Type your comment..."
                    autoFocus
                    className="w-full border border-border rounded py-2 px-2 font-[inherit] text-sm resize-y min-h-[60px] outline-none mb-2 text-page-text focus:border-accent focus:shadow-[0_0_0_2px_rgba(196,131,90,0.3)]"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <select
                      value={commentType}
                      onChange={(e) => setCommentType(e.target.value as PdfAnnotationType)}
                      className="text-[11px] bg-bg-elevated border border-border rounded px-1.5 py-1 text-text-secondary outline-none cursor-pointer"
                    >
                      {ANNOTATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <div className="flex gap-2">
                      <button onClick={cancelComment} onMouseDown={(e) => e.preventDefault()} className="py-1.5 px-3 rounded text-[13px] font-medium cursor-pointer border-none bg-transparent text-text-tertiary hover:bg-bg-elevated">Cancel</button>
                      <button onClick={addComment} onMouseDown={(e) => e.preventDefault()} className="py-1.5 px-3 rounded text-[13px] font-medium cursor-pointer border-none bg-accent text-white hover:bg-accent-hover">Comment</button>
                    </div>
                  </div>
                </div>
              )}

              {visibleComments.map((c) => (
                <div
                  key={c.id}
                  ref={(el: HTMLDivElement | null) => { commentsRef.current[c.id] = el; }}
                  className="absolute w-[280px] bg-bg-surface rounded-lg shadow-md p-3 pointer-events-auto border border-transparent hover:shadow-lg"
                  style={{
                    top: adjustedPositions[c.id] !== undefined
                      ? adjustedPositions[c.id]
                      : (pageRefs.current[c.page]?.offsetTop || 0) + (c.topRatio || 0) *
                          ((pageRefs.current[c.page]?.querySelector('.react-pdf__Page') as HTMLElement | null)?.offsetHeight || ESTIMATED_PAGE_HEIGHT),
                    transition: 'top 0.3s ease-out',
                  }}
                >
                  <div className="flex justify-between mb-1 text-xs">
                    <select
                      value={c.type || 'comment'}
                      onChange={(e) => handleUpdateCommentType(c.id, e.target.value as PdfAnnotationType)}
                      className={`px-1 py-0.5 rounded text-[10px] font-medium border-none outline-none cursor-pointer ${TYPE_COLORS[c.type] || TYPE_COLORS.comment}`}
                    >
                      {ANNOTATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <div className="flex gap-2 items-center">
                      <span className="text-text-secondary">p.{c.page}</span>
                      <button
                        className="border-none bg-transparent text-text-secondary cursor-pointer py-0.5 px-1.5 rounded flex items-center justify-center transition-colors hover:bg-bg-elevated hover:text-page-text"
                        onClick={() => resolveComment(c.id)}
                        onMouseDown={(e) => e.preventDefault()}
                        title="Resolve comment"
                      >
                        <XIcon size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="text-sm text-page-text mb-2 whitespace-pre-wrap">{c.text}</div>
                  <div className="text-xs text-text-secondary border-l-2 border-warning pl-2 italic whitespace-nowrap overflow-hidden text-ellipsis">"{c.selectedText}"</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };
}

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

export function init(api: PluginApi): void {
  const PdfViewer = makePdfViewer(api.services.fileSystem);

  api.register({
    id: 'pdf-viewer',
    canHandle: (tab) => !!tab?.isPdf,
    priority: 10,
    component: PdfViewer as React.ComponentType<ViewerProps>,
  });
}
