import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { CaretLeftIcon, CaretRightIcon, MagnifyingGlassPlusIcon, MagnifyingGlassMinusIcon, ChatTextIcon, XIcon } from '@phosphor-icons/react';
import fs from '../services/fileSystem';
import frameService from '../services/frameService';
import { useWorkspace } from '../context/WorkspaceContext';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const PdfViewer = ({ filePath }) => {
  const { workspacePath } = useWorkspace();
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.2);

  // Comment state
  const [comments, setComments] = useState([]);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentInputTop, setCommentInputTop] = useState(0);
  const [selectedTextInfo, setSelectedTextInfo] = useState(null);
  const [showCommentButton, setShowCommentButton] = useState(false);
  const [commentButtonPos, setCommentButtonPos] = useState({ top: 0, left: 0 });
  const [adjustedPositions, setAdjustedPositions] = useState({});
  const [highlightRects, setHighlightRects] = useState({});

  const pageContainerRef = useRef(null);
  const commentsRef = useRef({});

  const fileUrl = useMemo(() => fs.getFileUrl(filePath), [filePath]);

  // Filter comments to current page
  const pageComments = useMemo(() => {
    return comments.filter(c => c.page === pageNumber);
  }, [comments, pageNumber]);

  // Load comments from FRAME on mount
  const loadComments = useCallback(async () => {
    if (!workspacePath || !filePath) return;
    try {
      const frame = await frameService.readFrame(workspacePath, filePath);
      if (frame && frame.annotations) {
        setComments(frame.annotations.filter(a => a.page != null));
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

  // Compute overlap-adjusted positions and text highlights for comment cards
  // Uses stored topRatio (fraction of page height) scaled to current render size,
  // then measures actual card heights to prevent overlap
  useEffect(() => {
    if (pageComments.length === 0) {
      setAdjustedPositions({});
      setHighlightRects({});
      return;
    }

    // Delay to let TextLayer and cards render
    const timer = setTimeout(() => {
      const pageEl = pageContainerRef.current?.querySelector('.react-pdf__Page');
      const pageHeight = pageEl?.offsetHeight || 800;
      const containerRect = pageContainerRef.current?.getBoundingClientRect();

      // --- Overlap-adjusted card positions ---
      const newPositions = {};
      let lastBottom = 0;
      const GAP = 12;

      const sorted = [...pageComments].sort((a, b) => (a.topRatio || 0) - (b.topRatio || 0));

      sorted.forEach((comment) => {
        let top = (comment.topRatio || 0) * pageHeight;

        const cardEl = commentsRef.current[comment.id];
        const cardHeight = cardEl?.offsetHeight || 80;

        if (top < lastBottom + GAP) {
          top = lastBottom + GAP;
        }

        newPositions[comment.id] = top;
        lastBottom = top + cardHeight;
      });

      setAdjustedPositions(newPositions);

      // --- Text highlight rects ---
      if (!containerRect) { setHighlightRects({}); return; }

      const textLayer = pageContainerRef.current?.querySelector('.react-pdf__Page__textContent');
      if (!textLayer) { setHighlightRects({}); return; }

      const spans = textLayer.querySelectorAll('span');
      const newHighlights = {};

      pageComments.forEach((comment) => {
        if (!comment.selectedText) return;
        const expectedTop = (comment.topRatio || 0) * pageHeight;
        const tolerance = pageHeight * 0.05; // 5% tolerance band
        const rects = [];

        for (const span of spans) {
          const spanText = span.textContent || '';
          if (!spanText.trim()) continue;

          const spanRect = span.getBoundingClientRect();
          const relTop = spanRect.top - containerRect.top;

          // Only consider spans near the expected vertical position
          if (Math.abs(relTop - expectedTop) > tolerance) continue;

          // Check if this span contains the selected text as a substring
          const idx = spanText.indexOf(comment.selectedText);
          if (idx === -1) continue;

          // Create a temporary Range on just the matched substring to get precise rect
          const textNode = span.firstChild;
          if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;

          try {
            const range = document.createRange();
            range.setStart(textNode, idx);
            range.setEnd(textNode, idx + comment.selectedText.length);
            const rangeRect = range.getBoundingClientRect();
            rects.push({
              top: rangeRect.top - containerRect.top,
              left: rangeRect.left - containerRect.left,
              width: rangeRect.width,
              height: rangeRect.height,
            });

          } catch {
            // Fallback: highlight the whole span if range fails
            rects.push({
              top: relTop,
              left: spanRect.left - containerRect.left,
              width: spanRect.width,
              height: spanRect.height,
            });
          }
        }

        if (rects.length > 0) {
          newHighlights[comment.id] = rects;
        }
      });

      setHighlightRects(newHighlights);
    }, 350);

    return () => clearTimeout(timer);
  }, [pageComments, scale, pageNumber]);

  // Dismiss comment input on page change
  useEffect(() => {
    setShowCommentInput(false);
    setShowCommentButton(false);
    setSelectedTextInfo(null);
    setCommentText('');
  }, [pageNumber]);

  const handleLoadSuccess = useCallback(({ numPages }) => {
    setNumPages(numPages);
    setPageNumber(1);
  }, []);

  const handlePrevPage = useCallback(() => {
    setPageNumber(prev => Math.max(1, prev - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    setPageNumber(prev => Math.min(numPages || 1, prev + 1));
  }, [numPages]);

  const handleZoomIn = useCallback(() => {
    setScale(prev => Math.min(3, prev + 0.2));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale(prev => Math.max(0.4, prev - 0.2));
  }, []);

  // Handle text selection on the PDF page
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();

    if (!text || !pageContainerRef.current) {
      setShowCommentButton(false);
      return;
    }

    // Check the selection is within our page container
    if (!pageContainerRef.current.contains(selection.anchorNode)) {
      setShowCommentButton(false);
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = pageContainerRef.current.getBoundingClientRect();

    // Compute topRatio (fraction of page height) for scale-independent positioning
    const pageEl = pageContainerRef.current.querySelector('.react-pdf__Page');
    const pageHeight = pageEl?.offsetHeight || containerRect.height || 800;
    const relativeTop = rect.top - containerRect.top;
    const topRatio = relativeTop / pageHeight;

    setCommentButtonPos({
      top: relativeTop - 36,
      left: rect.left - containerRect.left + rect.width / 2 - 16,
    });

    setSelectedTextInfo({
      text,
      topRatio,
      relativeTop,
    });
    setShowCommentButton(true);
  }, []);

  const handleStartComment = useCallback(() => {
    if (!selectedTextInfo) return;
    setCommentInputTop(selectedTextInfo.relativeTop);
    setShowCommentInput(true);
    setShowCommentButton(false);
  }, [selectedTextInfo]);

  const addComment = useCallback(async () => {
    if (!commentText.trim() || !selectedTextInfo || !workspacePath || !filePath) return;

    const annotation = {
      page: pageNumber,
      selectedText: selectedTextInfo.text,
      topRatio: selectedTextInfo.topRatio,
      text: commentText.trim(),
      type: 'review',
      author: 'user',
    };

    // Add to local state immediately
    const newId = crypto.randomUUID();
    setComments(prev => [...prev, { ...annotation, id: newId, timestamp: new Date().toISOString() }]);

    // Persist to FRAME
    frameService.addAnnotation(workspacePath, filePath, { ...annotation, id: newId })
      .catch((err) => console.warn('Failed to sync PDF comment to FRAME:', err));

    setCommentText('');
    setShowCommentInput(false);
    setSelectedTextInfo(null);
    window.getSelection()?.removeAllRanges();
  }, [commentText, selectedTextInfo, workspacePath, filePath, pageNumber]);

  const cancelComment = useCallback(() => {
    setCommentText('');
    setShowCommentInput(false);
    setSelectedTextInfo(null);
  }, []);

  const resolveComment = useCallback(async (commentId) => {
    setComments(prev => prev.filter(c => c.id !== commentId));

    if (workspacePath && filePath) {
      frameService.removeAnnotation(workspacePath, filePath, commentId)
        .catch((err) => console.warn('Failed to remove PDF comment from FRAME:', err));
    }
  }, [workspacePath, filePath]);

  // Get page width for sidebar positioning
  const [pageWidth, setPageWidth] = useState(612 * 1.2);

  useEffect(() => {
    const timer = setTimeout(() => {
      const pageEl = pageContainerRef.current?.querySelector('.react-pdf__Page');
      if (pageEl) {
        setPageWidth(pageEl.offsetWidth);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [scale, pageNumber, numPages]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-surface">
      {/* Toolbar */}
      <div className="flex items-center justify-center gap-4 px-4 py-2 bg-bg-elevated border-b border-border">
        <button
          onClick={handlePrevPage}
          disabled={pageNumber <= 1}
          className="p-1 rounded hover:bg-white/[0.06] disabled:opacity-30 text-text-secondary"
        >
          <CaretLeftIcon size={18} />
        </button>
        <span className="text-sm text-text-secondary">
          {pageNumber} / {numPages || '...'}
        </span>
        <button
          onClick={handleNextPage}
          disabled={pageNumber >= (numPages || 1)}
          className="p-1 rounded hover:bg-white/[0.06] disabled:opacity-30 text-text-secondary"
        >
          <CaretRightIcon size={18} />
        </button>
        <div className="w-px h-4 bg-border" />
        <button
          onClick={handleZoomOut}
          className="p-1 rounded hover:bg-white/[0.06] text-text-secondary"
        >
          <MagnifyingGlassMinusIcon size={18} />
        </button>
        <span className="text-xs text-text-tertiary w-12 text-center">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={handleZoomIn}
          className="p-1 rounded hover:bg-white/[0.06] text-text-secondary"
        >
          <MagnifyingGlassPlusIcon size={18} />
        </button>
      </div>

      {/* PDF content with comment sidebar */}
      <div className="flex-1 overflow-auto flex justify-center py-6">
        <div className="relative" ref={pageContainerRef} onMouseUp={handleMouseUp}>
          <Document
            file={fileUrl}
            onLoadSuccess={handleLoadSuccess}
            loading={
              <div className="text-text-tertiary text-sm">Loading PDF...</div>
            }
            error={
              <div className="text-error text-sm">Failed to load PDF</div>
            }
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              className="shadow-lg"
            />
          </Document>

          {/* Highlight overlays for commented text */}
          {Object.entries(highlightRects).map(([commentId, rects]) =>
            rects.map((rect, i) => (
              <div
                key={`hl-${commentId}-${i}`}
                className="absolute bg-accent/20 pointer-events-none rounded-sm"
                style={{
                  top: rect.top,
                  left: rect.left,
                  width: rect.width,
                  height: rect.height,
                }}
              />
            ))
          )}

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

          {/* Comment sidebar - positioned to the right of the PDF page */}
          <div
            className="absolute top-0 bottom-0 w-[300px] pointer-events-none"
            style={{ left: pageWidth + 16 }}
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
                <div className="flex justify-end gap-2">
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
            )}

            {/* Comment cards */}
            {pageComments.map((c) => (
              <div
                key={c.id}
                ref={el => { commentsRef.current[c.id] = el; }}
                className="absolute w-[280px] bg-bg-surface rounded-lg shadow-md p-3 pointer-events-auto border border-transparent hover:shadow-lg"
                style={{
                  top: adjustedPositions[c.id] !== undefined ? adjustedPositions[c.id] : (c.topRatio || 0) * (pageContainerRef.current?.querySelector('.react-pdf__Page')?.offsetHeight || 800),
                  transition: 'top 0.3s ease-out'
                }}
              >
                <div className="flex justify-between mb-1 text-xs">
                  <span className="font-semibold text-page-text">User</span>
                  <div className="flex gap-2 items-center">
                    <span className="text-text-secondary">Just now</span>
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

export default PdfViewer;
