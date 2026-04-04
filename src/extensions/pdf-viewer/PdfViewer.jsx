import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import {
  MagnifyingGlassPlusIcon,
  MagnifyingGlassMinusIcon,
  ChatTextIcon,
  XIcon,
} from "@phosphor-icons/react";

const ANNOTATION_TYPES = [
  "comment",
  "review",
  "todo",
  "bug",
  "question",
  "instruction",
];
const TYPE_COLORS = {
  comment: "bg-text-tertiary/20 text-text-secondary",
  review: "bg-accent/20 text-accent",
  todo: "bg-info/20 text-info",
  bug: "bg-error/20 text-error",
  question: "bg-warning/20 text-warning",
  instruction: "bg-success/20 text-success",
};
import fs from "../../services/fileSystem";
import frameService from "../../services/frameService";
import { useWorkspace } from "../../context/WorkspaceContext";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// How many pages above/below the viewport to keep rendered
const PAGE_BUFFER = 5;
// Estimated page height before actual dimensions are known
const ESTIMATED_PAGE_HEIGHT = 1056;
const PAGE_GAP = 24;

// Memoized outside component to avoid re-creating on every render (react-pdf reloads on options change)
const pdfOptions = {
  cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/standard_fonts/`,
};

const PdfViewer = ({ tab }) => {
  const filePath = tab.path;
  const { workspacePath } = useWorkspace();
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomPercent, setZoomPercent] = useState(100); // 100% = fit to container
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [visiblePages, setVisiblePages] = useState(new Set([1]));
  const [pageDimensions, setPageDimensions] = useState({});

  // Comment state
  const [comments, setComments] = useState([]);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentInputTop, setCommentInputTop] = useState(0);
  const [selectedTextInfo, setSelectedTextInfo] = useState(null);
  const [commentType, setCommentType] = useState("comment");
  const [showCommentButton, setShowCommentButton] = useState(false);
  const [commentButtonPos, setCommentButtonPos] = useState({ top: 0, left: 0 });
  const [adjustedPositions, setAdjustedPositions] = useState({});
  const [highlightRects, setHighlightRects] = useState({});

  const scrollContainerRef = useRef(null);
  const pageRefs = useRef({});
  const commentsRef = useRef({});
  const observerRef = useRef(null);

  const fileUrl = useMemo(() => fs.getFileUrl(filePath), [filePath]);

  // Measure scroll container width for fit-to-width rendering
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Page width: fit to container at 100%, scaled by zoom. Subtract padding (48px = py-6 * 2 sides).
  // Leave 340px for comment sidebar when container is wide enough.
  const pageWidth = useMemo(() => {
    if (!containerWidth) return 612; // fallback before measurement
    const sidebarSpace = containerWidth > 900 ? 340 : 0;
    const available = containerWidth - 48 - sidebarSpace;
    return Math.max(300, (available * zoomPercent) / 100);
  }, [containerWidth, zoomPercent]);

  // Determine which pages should be rendered (visible + buffer)
  const renderedPages = useMemo(() => {
    const rendered = new Set();
    for (const p of visiblePages) {
      for (
        let i = Math.max(1, p - PAGE_BUFFER);
        i <= Math.min(numPages || 1, p + PAGE_BUFFER);
        i++
      ) {
        rendered.add(i);
      }
    }
    return rendered;
  }, [visiblePages, numPages]);

  // Comments for all visible pages
  const visibleComments = useMemo(() => {
    return comments.filter((c) => visiblePages.has(c.page));
  }, [comments, visiblePages]);

  // Load comments from FRAME on mount
  const loadComments = useCallback(async () => {
    if (!workspacePath || !filePath) return;
    try {
      const frame = await frameService.readFrame(workspacePath, filePath);
      if (frame && frame.annotations) {
        setComments(frame.annotations.filter((a) => a.page != null));
      } else {
        setComments([]);
      }
    } catch {
      setComments([]);
    }
  }, [workspacePath, filePath]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // Set up IntersectionObserver to track visible pages
  useEffect(() => {
    if (!numPages || !scrollContainerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const pageNum = parseInt(entry.target.dataset.pageNumber, 10);
            if (entry.isIntersecting) {
              next.add(pageNum);
            } else {
              next.delete(pageNum);
            }
          }
          return next;
        });
      },
      {
        root: scrollContainerRef.current,
        rootMargin: "200px 0px",
        threshold: 0.01,
      },
    );

    observerRef.current = observer;

    // Observe all page sentinel divs
    for (let i = 1; i <= numPages; i++) {
      const el = pageRefs.current[i];
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [numPages]);

  // Track current page from scroll position (most visible page)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !numPages) return;

    const handleScroll = () => {
      const containerRect = container.getBoundingClientRect();
      const containerMid = containerRect.top + containerRect.height / 2;
      let closestPage = 1;
      let closestDist = Infinity;

      for (let i = 1; i <= numPages; i++) {
        const el = pageRefs.current[i];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const pageMid = rect.top + rect.height / 2;
        const dist = Math.abs(pageMid - containerMid);
        if (dist < closestDist) {
          closestDist = dist;
          closestPage = i;
        }
      }

      setCurrentPage(closestPage);
      setPageInput(String(closestPage));
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [numPages]);

  // Compute highlight rects and adjusted comment positions for visible pages
  useEffect(() => {
    if (visibleComments.length === 0) {
      setAdjustedPositions({});
      setHighlightRects({});
      return;
    }

    const timer = setTimeout(() => {
      const newPositions = {};
      const newHighlights = {};

      // Group comments by page for overlap adjustment
      const commentsByPage = {};
      for (const c of visibleComments) {
        if (!commentsByPage[c.page]) commentsByPage[c.page] = [];
        commentsByPage[c.page].push(c);
      }

      for (const [pageNumStr, pageComments] of Object.entries(commentsByPage)) {
        const pageNum = parseInt(pageNumStr, 10);
        const pageEl = pageRefs.current[pageNum];
        if (!pageEl) continue;

        const pdfPageEl = pageEl.querySelector(".react-pdf__Page");
        const pageHeight = pdfPageEl?.offsetHeight || ESTIMATED_PAGE_HEIGHT;
        const pageRect = pageEl.getBoundingClientRect();
        const scrollRect = scrollContainerRef.current?.getBoundingClientRect();
        if (!scrollRect) continue;

        // Page top offset relative to scroll container's scrollTop
        const pageTopInContainer = pageEl.offsetTop;

        // --- Overlap-adjusted card positions ---
        let lastBottom = 0;
        const GAP = 12;
        const sorted = [...pageComments].sort(
          (a, b) => (a.topRatio || 0) - (b.topRatio || 0),
        );

        sorted.forEach((comment) => {
          let top = pageTopInContainer + (comment.topRatio || 0) * pageHeight;
          const cardEl = commentsRef.current[comment.id];
          const cardHeight = cardEl?.offsetHeight || 80;

          if (top < lastBottom + GAP) {
            top = lastBottom + GAP;
          }

          newPositions[comment.id] = top;
          lastBottom = top + cardHeight;
        });

        // --- Text highlight rects ---
        const textLayer = pdfPageEl?.querySelector(
          ".react-pdf__Page__textContent",
        );
        if (!textLayer) continue;

        const spans = textLayer.querySelectorAll("span");

        pageComments.forEach((comment) => {
          if (!comment.selectedText) return;
          const expectedTop = (comment.topRatio || 0) * pageHeight;
          const tolerance = pageHeight * 0.05;
          const rects = [];

          for (const span of spans) {
            const spanText = span.textContent || "";
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
              const startOffset = Math.min(idx, textNode.length);
              const endOffset = Math.min(
                idx + comment.selectedText.length,
                textNode.length,
              );
              range.setStart(textNode, startOffset);
              range.setEnd(textNode, endOffset);
              // Use getClientRects for multi-line/multi-column selections
              const clientRects = range.getClientRects();
              for (const cr of clientRects) {
                rects.push({
                  top: cr.top - pageRect.top,
                  left: cr.left - pageRect.left,
                  width: cr.width,
                  height: cr.height,
                });
              }
            } catch {
              rects.push({
                top: relTop,
                left: spanRect.left - pageRect.left,
                width: spanRect.width,
                height: spanRect.height,
              });
            }
          }

          if (rects.length > 0) {
            newHighlights[comment.id] = { rects, pageNum };
          }
        });
      }

      setAdjustedPositions(newPositions);
      setHighlightRects(newHighlights);
    }, 350);

    return () => clearTimeout(timer);
  }, [visibleComments, pageWidth, visiblePages]);

  const handleLoadSuccess = useCallback(({ numPages: n }) => {
    setNumPages(n);
    setCurrentPage(1);
    setPageInput("1");
    // Initialize visible pages
    const initial = new Set();
    for (let i = 1; i <= Math.min(n, 1 + PAGE_BUFFER); i++) {
      initial.add(i);
    }
    setVisiblePages(initial);
  }, []);

  const handlePageLoadSuccess = useCallback(
    (pageNum) => (page) => {
      setPageDimensions((prev) => ({
        ...prev,
        [pageNum]: { width: page.width, height: page.height },
      }));
    },
    [],
  );

  const scrollToPage = useCallback((pageNum) => {
    const el = pageRefs.current[pageNum];
    if (el && scrollContainerRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const handlePageInputSubmit = useCallback(() => {
    const num = parseInt(pageInput, 10);
    if (num >= 1 && num <= (numPages || 1)) {
      scrollToPage(num);
    } else {
      setPageInput(String(currentPage));
    }
  }, [pageInput, numPages, currentPage, scrollToPage]);

  const handleZoomIn = useCallback(() => {
    setZoomPercent((prev) => Math.min(300, prev + 10));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomPercent((prev) => Math.max(30, prev - 10));
  }, []);

  // Ctrl+scroll zoom — preserve scroll center during zoom
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handler = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();

      // Record the scroll ratio before zoom so we can restore it
      const scrollRatio =
        el.scrollHeight > 0 ? el.scrollTop / el.scrollHeight : 0;

      setZoomPercent((prev) => {
        const delta = e.deltaY > 0 ? -10 : 10;
        const next = Math.min(300, Math.max(30, prev + delta));

        // Restore scroll position after React re-renders with new scale
        requestAnimationFrame(() => {
          el.scrollTop = scrollRatio * el.scrollHeight;
        });

        return next;
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // Handle text selection on any PDF page
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();

    if (!text || !scrollContainerRef.current) {
      setShowCommentButton(false);
      return;
    }

    // Find which page the selection is in
    const anchorNode = selection.anchorNode;
    let pageNum = null;
    let pageEl = null;
    for (let i = 1; i <= (numPages || 0); i++) {
      const ref = pageRefs.current[i];
      if (ref && ref.contains(anchorNode)) {
        pageNum = i;
        pageEl = ref;
        break;
      }
    }

    if (!pageNum || !pageEl) {
      setShowCommentButton(false);
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();

    const pdfPageEl = pageEl.querySelector(".react-pdf__Page");
    const pageHeight =
      pdfPageEl?.offsetHeight || pageRect.height || ESTIMATED_PAGE_HEIGHT;
    const relativeTop = rect.top - pageRect.top;
    const topRatio = relativeTop / pageHeight;

    // Position button relative to scroll container
    const scrollRect = scrollContainerRef.current.getBoundingClientRect();
    setCommentButtonPos({
      top:
        rect.top - scrollRect.top + scrollContainerRef.current.scrollTop - 36,
      left: rect.left - scrollRect.left + rect.width / 2 - 16,
    });

    setSelectedTextInfo({
      text,
      topRatio,
      relativeTop,
      page: pageNum,
    });
    setShowCommentButton(true);
  }, [numPages]);

  const handleStartComment = useCallback(() => {
    if (!selectedTextInfo) return;
    const pageEl = pageRefs.current[selectedTextInfo.page];
    if (!pageEl) return;
    setCommentInputTop(pageEl.offsetTop + selectedTextInfo.relativeTop);
    setShowCommentInput(true);
    setShowCommentButton(false);
  }, [selectedTextInfo]);

  const addComment = useCallback(async () => {
    if (!commentText.trim() || !selectedTextInfo || !workspacePath || !filePath)
      return;

    const annotation = {
      page: selectedTextInfo.page,
      selectedText: selectedTextInfo.text,
      topRatio: selectedTextInfo.topRatio,
      text: commentText.trim(),
      type: commentType,
      author: "user",
    };

    const newId = crypto.randomUUID();
    setComments((prev) => [
      ...prev,
      { ...annotation, id: newId, timestamp: new Date().toISOString() },
    ]);

    frameService
      .addAnnotation(workspacePath, filePath, { ...annotation, id: newId })
      .catch((err) =>
        console.warn("Failed to sync PDF comment to FRAME:", err),
      );

    setCommentText("");
    setCommentType("comment");
    setShowCommentInput(false);
    setSelectedTextInfo(null);
    window.getSelection()?.removeAllRanges();
  }, [commentText, commentType, selectedTextInfo, workspacePath, filePath]);

  const cancelComment = useCallback(() => {
    setCommentText("");
    setCommentType("comment");
    setShowCommentInput(false);
    setSelectedTextInfo(null);
  }, []);

  const updateCommentType = useCallback(
    async (commentId, newType) => {
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? { ...c, type: newType } : c)),
      );
      // Update in FRAME
      if (workspacePath && filePath) {
        try {
          const frame = await frameService.readFrame(workspacePath, filePath);
          if (frame?.annotations) {
            const ann = frame.annotations.find((a) => a.id === commentId);
            if (ann) {
              ann.type = newType;
              frame.updatedAt = new Date().toISOString();
              const fs = (await import("../../services/fileSystem")).default;
              const relativePath = filePath.startsWith(workspacePath + "/")
                ? filePath.substring(workspacePath.length + 1)
                : filePath;
              const framePath = `${workspacePath}/.quipu/meta/${relativePath}.frame.json`;
              await fs.writeFile(framePath, JSON.stringify(frame, null, 2));
            }
          }
        } catch (err) {
          console.warn("Failed to update annotation type in FRAME:", err);
        }
      }
    },
    [workspacePath, filePath],
  );

  const resolveComment = useCallback(
    async (commentId) => {
      setComments((prev) => prev.filter((c) => c.id !== commentId));

      if (workspacePath && filePath) {
        frameService
          .removeAnnotation(workspacePath, filePath, commentId)
          .catch((err) =>
            console.warn("Failed to remove PDF comment from FRAME:", err),
          );
      }
    },
    [workspacePath, filePath],
  );

  // With width-based rendering, all pages render at pageWidth pixels wide.
  // The rendered height = pageWidth * (original height / original width).
  const getPageHeight = useCallback(
    (pageNum) => {
      const dims = pageDimensions[pageNum];
      if (dims) return pageWidth * (dims.height / dims.width);
      return pageWidth * (11 / 8.5); // US Letter aspect ratio fallback
    },
    [pageDimensions, pageWidth],
  );

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
            onKeyDown={(e) => {
              if (e.key === "Enter") handlePageInputSubmit();
            }}
            className="w-10 text-center text-sm text-text-primary bg-bg-surface border border-border rounded px-1 py-0.5 outline-none focus:border-accent"
          />
          <span className="text-sm text-text-secondary">
            / {numPages || "..."}
          </span>
        </div>
        <div className="w-px h-4 bg-border" />
        <button
          onClick={handleZoomOut}
          className="p-1 rounded hover:bg-white/[0.06] text-text-secondary"
        >
          <MagnifyingGlassMinusIcon size={18} />
        </button>
        <span className="text-xs text-text-tertiary w-12 text-center">
          {zoomPercent}%
        </span>
        <button
          onClick={handleZoomIn}
          className="p-1 rounded hover:bg-white/[0.06] text-text-secondary"
        >
          <MagnifyingGlassPlusIcon size={18} />
        </button>
      </div>

      {/* PDF content with all pages stacked */}
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
            loading={
              <div className="text-text-tertiary text-sm p-8">
                Loading PDF...
              </div>
            }
            error={
              <div className="text-error text-sm p-8">
                Failed to load PDF. The file may be corrupted or use unsupported
                features.
              </div>
            }
          >
            {numPages &&
              Array.from({ length: numPages }, (_, i) => {
                const pageNum = i + 1;
                const isRendered = renderedPages.has(pageNum);
                const pageHeight = getPageHeight(pageNum);

                return (
                  <div
                    key={pageNum}
                    ref={(el) => {
                      pageRefs.current[pageNum] = el;
                    }}
                    data-page-number={pageNum}
                    className="relative"
                    style={{ marginBottom: PAGE_GAP }}
                  >
                    {isRendered ? (
                      <Page
                        pageNumber={pageNum}
                        width={pageWidth}
                        devicePixelRatio={Math.max(
                          window.devicePixelRatio * 1.5 || 2,
                          (100 / zoomPercent) *
                            (window.devicePixelRatio * 1.5 || 2),
                        )}
                        className="shadow-lg"
                        onLoadSuccess={handlePageLoadSuccess(pageNum)}
                        error={
                          <div className="p-4 text-error text-sm">
                            Failed to render page {pageNum}
                          </div>
                        }
                      />
                    ) : (
                      <div
                        className="bg-bg-elevated shadow-lg flex items-center justify-center text-text-tertiary text-sm"
                        style={{
                          width: pageWidth,
                          height: pageHeight,
                        }}
                      >
                        Page {pageNum}
                      </div>
                    )}

                    {/* Highlight overlays for this page's comments */}
                    {Object.entries(highlightRects)
                      .filter(([, data]) => data.pageNum === pageNum)
                      .map(([commentId, data]) =>
                        data.rects.map((rect, ri) => (
                          <div
                            key={`hl-${commentId}-${ri}`}
                            className="absolute bg-accent/20 pointer-events-none rounded-sm"
                            style={{
                              top: rect.top,
                              left: rect.left,
                              width: rect.width,
                              height: rect.height,
                            }}
                          />
                        )),
                      )}
                  </div>
                );
              })}
          </Document>

          {/* Floating comment button on text selection */}
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

          {/* Comment sidebar - positioned to the right of all pages */}
          <div
            className="absolute top-0 bottom-0 w-[300px] pointer-events-none"
            style={{ left: `calc(50% + ${pageWidth / 2}px + 16px)` }}
          >
            {/* Comment input */}
            {showCommentInput && (
              <div
                className="absolute w-[280px] bg-bg-surface rounded-lg shadow-lg p-3 pointer-events-auto border border-accent z-[100]"
                style={{ top: commentInputTop }}
              >
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      (e.ctrlKey || e.metaKey || e.shiftKey) &&
                      e.key === "Enter"
                    ) {
                      e.preventDefault();
                      addComment();
                    }
                    if (e.key === "Escape") {
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
                    {ANNOTATION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button
                      onClick={cancelComment}
                      onMouseDown={(e) => e.preventDefault()}
                      className="py-1.5 px-3 rounded text-[13px] font-medium cursor-pointer border-none bg-transparent text-text-tertiary hover:bg-bg-elevated"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={addComment}
                      onMouseDown={(e) => e.preventDefault()}
                      className="py-1.5 px-3 rounded text-[13px] font-medium cursor-pointer border-none bg-accent text-white hover:bg-accent-hover"
                    >
                      Comment
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Comment cards for all visible pages */}
            {visibleComments.map((c) => (
              <div
                key={c.id}
                ref={(el) => {
                  commentsRef.current[c.id] = el;
                }}
                className="absolute w-[280px] bg-bg-surface rounded-lg shadow-md p-3 pointer-events-auto border border-transparent hover:shadow-lg"
                style={{
                  top:
                    adjustedPositions[c.id] !== undefined
                      ? adjustedPositions[c.id]
                      : (pageRefs.current[c.page]?.offsetTop || 0) +
                        (c.topRatio || 0) *
                          (pageRefs.current[c.page]?.querySelector(
                            ".react-pdf__Page",
                          )?.offsetHeight || ESTIMATED_PAGE_HEIGHT),
                  transition: "top 0.3s ease-out",
                }}
              >
                <div className="flex justify-between mb-1 text-xs">
                  <select
                    value={c.type || "comment"}
                    onChange={(e) => updateCommentType(c.id, e.target.value)}
                    className={`px-1 py-0.5 rounded text-[10px] font-medium border-none outline-none cursor-pointer ${TYPE_COLORS[c.type] || TYPE_COLORS.comment}`}
                  >
                    {ANNOTATION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
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
                <div className="text-sm text-page-text mb-2 whitespace-pre-wrap">
                  {c.text}
                </div>
                <div className="text-xs text-text-secondary border-l-2 border-warning pl-2 italic whitespace-nowrap overflow-hidden text-ellipsis">
                  "{c.selectedText}"
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PdfViewer;
