import React, { useState, useCallback } from 'react';
import { ChatCircleDotsIcon, XIcon, CaretRightIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

type AnnotationTypeLabel = 'comment' | 'review' | 'todo' | 'bug' | 'question' | 'instruction';

const TYPE_COLORS: Record<AnnotationTypeLabel, string> = {
  comment: 'bg-blue-100 text-blue-800',
  review: 'bg-purple-100 text-purple-800',
  todo: 'bg-amber-100 text-amber-800',
  bug: 'bg-red-100 text-red-800',
  question: 'bg-green-100 text-green-800',
  instruction: 'bg-orange-100 text-orange-800',
};

const ANNOTATION_TYPES: AnnotationTypeLabel[] = ['comment', 'review', 'todo', 'bug', 'question', 'instruction'];

export interface CommentData {
  id: string;
  comment: string;
  text: string;
  type?: string;
  pos: number;
  top: number;
}

interface CommentPanelProps {
  comments: CommentData[];
  onResolve: (commentId: string) => void;
  onChangeType: (commentId: string, newType: AnnotationTypeLabel) => void;
  onScrollTo: (commentId: string) => void;
}

/**
 * Collapsible comment panel that shows as a sidebar when the viewport
 * is too narrow for floating comments. Renders comments in a chat-like
 * chronological list with the quoted text and comment body.
 */
const CommentPanel: React.FC<CommentPanelProps> = ({
  comments,
  onResolve,
  onChangeType,
  onScrollTo,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  if (comments.length === 0) return null;

  return (
    <>
      {/* Toggle button — fixed to the right edge */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg',
          'bg-bg-surface/90 backdrop-blur-sm border border-border/50 shadow-sm',
          'text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors',
          'text-xs font-medium',
        )}
      >
        <ChatCircleDotsIcon size={16} weight={isOpen ? 'fill' : 'regular'} />
        <span>{comments.length}</span>
        <CaretRightIcon
          size={12}
          className={cn('transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {/* Panel */}
      {isOpen && (
        <div className={cn(
          'absolute top-0 right-0 bottom-0 w-[320px] z-10',
          'bg-bg-surface/95 backdrop-blur-sm border-l border-border/50',
          'flex flex-col overflow-hidden',
        )}>
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border/30">
            <span className="text-sm font-medium text-text-primary">
              Comments ({comments.length})
            </span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-text-tertiary hover:text-text-secondary p-1 rounded hover:bg-bg-elevated"
            >
              <XIcon size={14} />
            </button>
          </div>

          {/* Comment list */}
          <div className="flex-1 overflow-y-auto">
            {comments.map((c) => (
              <div
                key={c.id}
                className="px-4 py-3 border-b border-border/20 hover:bg-bg-elevated/50 cursor-pointer transition-colors"
                onClick={() => onScrollTo(c.id)}
              >
                {/* Type badge + resolve button */}
                <div className="flex items-center justify-between mb-1.5">
                  <select
                    value={c.type || 'comment'}
                    onChange={(e) => {
                      e.stopPropagation();
                      onChangeType(c.id, e.target.value as AnnotationTypeLabel);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[10px] font-medium border-none outline-none cursor-pointer',
                      TYPE_COLORS[(c.type ?? 'comment') as AnnotationTypeLabel] || TYPE_COLORS.comment,
                    )}
                  >
                    {ANNOTATION_TYPES.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onResolve(c.id);
                    }}
                    className="text-text-tertiary hover:text-text-secondary p-0.5 rounded hover:bg-bg-elevated"
                    title="Resolve"
                  >
                    <XIcon size={12} />
                  </button>
                </div>

                {/* Comment text */}
                <div className="text-sm text-page-text mb-1.5 whitespace-pre-wrap">
                  {c.comment}
                </div>

                {/* Quoted text */}
                <div className="text-xs text-text-tertiary border-l-2 border-warning/50 pl-2 italic truncate">
                  &ldquo;{c.text}&rdquo;
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};

export default CommentPanel;
