import { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowUpIcon, ArrowDownIcon, XIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

const FindBar = ({ editor, onClose }) => {
  const [term, setTerm] = useState('');
  const [totalMatches, setTotalMatches] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const syncStorage = useCallback(() => {
    if (!editor) return;
    setTotalMatches(editor.storage.findReplace?.totalMatches ?? 0);
    setCurrentIndex(editor.storage.findReplace?.currentIndex ?? -1);
  }, [editor]);

  const handleChange = useCallback((e) => {
    const value = e.target.value;
    setTerm(value);
    if (!editor) return;
    editor.commands.setFindTerm(value);
    syncStorage();
  }, [editor, syncStorage]);

  const handleNext = useCallback(() => {
    if (!editor) return;
    editor.commands.findNext();
    syncStorage();
  }, [editor, syncStorage]);

  const handlePrev = useCallback(() => {
    if (!editor) return;
    editor.commands.findPrev();
    syncStorage();
  }, [editor, syncStorage]);

  const handleClose = useCallback(() => {
    if (editor) editor.commands.clearFind();
    onClose();
  }, [editor, onClose]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrev();
      } else {
        handleNext();
      }
    } else if (e.key === 'F3') {
      e.preventDefault();
      if (e.shiftKey) handlePrev();
      else handleNext();
    }
  }, [handleClose, handleNext, handlePrev]);

  const matchLabel = totalMatches === 0
    ? (term ? 'No results' : '')
    : `${currentIndex + 1} of ${totalMatches}`;

  return (
    <div className="absolute top-2 right-4 z-50 flex items-center gap-1 bg-bg-surface border border-border rounded-lg shadow-lg px-2 py-1.5">
      <input
        ref={inputRef}
        type="text"
        value={term}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Find..."
        className={cn(
          "bg-bg-elevated border border-border rounded px-2 py-0.5 text-[13px] text-text-primary outline-none w-[180px]",
          "focus:border-accent",
          totalMatches === 0 && term && "border-error/60",
        )}
      />
      {matchLabel && (
        <span className="text-[11px] text-text-tertiary min-w-[54px] text-center select-none">
          {matchLabel}
        </span>
      )}
      <button
        onClick={handlePrev}
        disabled={totalMatches === 0}
        className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        title="Previous match (Shift+Enter)"
      >
        <ArrowUpIcon size={14} />
      </button>
      <button
        onClick={handleNext}
        disabled={totalMatches === 0}
        className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        title="Next match (Enter)"
      >
        <ArrowDownIcon size={14} />
      </button>
      <button
        onClick={handleClose}
        className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
        title="Close (Escape)"
      >
        <XIcon size={14} />
      </button>
    </div>
  );
};

export default FindBar;
