import React, { useMemo } from 'react';
import { XIcon, GitDiffIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

function parseDiff(diffText) {
  if (!diffText) return [];
  const lines = diffText.split('\n');
  const result = [];
  let oldLine = 0, newLine = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        oldLine = parseInt(match[1]) - 1;
        newLine = parseInt(match[2]) - 1;
      }
      result.push({ type: 'header', text: line });
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      newLine++;
      result.push({ type: 'add', text: line.slice(1), newLine });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      oldLine++;
      result.push({ type: 'remove', text: line.slice(1), oldLine });
    } else if (!line.startsWith('diff') && !line.startsWith('index') && !line.startsWith('---') && !line.startsWith('+++')) {
      oldLine++;
      newLine++;
      result.push({ type: 'context', text: line.startsWith(' ') ? line.slice(1) : line, oldLine, newLine });
    }
  }
  return result;
}

const DiffViewer = ({ filePath, diffText, isStaged, onClose }) => {
  const lines = useMemo(() => parseDiff(diffText), [diffText]);
  const fileName = filePath ? filePath.split('/').pop() : '';
  const dirPath = filePath ? filePath.split('/').slice(0, -1).join('/') : '';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-[35px] border-b border-border shrink-0">
        <GitDiffIcon size={14} className="text-text-tertiary shrink-0" />
        <span className="text-[13px] text-text-primary flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-sans">
          {fileName}
          {dirPath && (
            <span className="ml-2 text-text-tertiary text-[11px]">{dirPath}</span>
          )}
          <span className="ml-3 text-[11px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-text-secondary">
            {isStaged ? 'staged' : 'working tree'}
          </span>
        </span>
        <button
          className="flex items-center justify-center w-5 h-5 rounded-sm text-text-primary opacity-40 hover:opacity-100 hover:bg-white/[0.06] cursor-pointer bg-transparent border-none shrink-0"
          onClick={onClose}
          title="Close diff"
        >
          <XIcon size={14} />
        </button>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-auto font-mono text-[12px] leading-[20px] bg-bg-base [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb:hover]:bg-white/25">
        {lines.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-primary opacity-50 italic text-[13px] font-sans">
            No diff available
          </div>
        ) : (
          lines.map((line, idx) => (
            <div
              key={idx}
              className={cn(
                "flex items-stretch whitespace-pre",
                line.type === 'add' && "bg-git-added/10",
                line.type === 'remove' && "bg-git-deleted/10",
                line.type === 'header' && "bg-white/[0.03]",
              )}
            >
              <span className={cn(
                "w-10 text-right pr-3 shrink-0 opacity-40 select-none border-r border-border/40 leading-[20px]",
                line.type === 'add' && "text-git-added",
                line.type === 'remove' && "text-git-deleted",
                (line.type === 'header' || line.type === 'context') && "text-text-tertiary",
              )}>
                {line.type !== 'add' && line.type !== 'header' ? (line.oldLine || '') : ''}
              </span>
              <span className={cn(
                "w-10 text-right pr-3 shrink-0 opacity-40 select-none border-r border-border/40 leading-[20px]",
                line.type === 'add' && "text-git-added",
                line.type === 'remove' && "text-git-deleted",
                (line.type === 'header' || line.type === 'context') && "text-text-tertiary",
              )}>
                {line.type !== 'remove' && line.type !== 'header' ? (line.newLine || '') : ''}
              </span>
              <span className={cn(
                "w-5 text-center shrink-0 select-none leading-[20px]",
                line.type === 'add' && "text-git-added",
                line.type === 'remove' && "text-git-deleted",
                line.type === 'header' && "text-accent",
                (line.type === 'context') && "text-text-tertiary opacity-40",
              )}>
                {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
              </span>
              <span className={cn(
                "flex-1 pl-2 pr-4 min-w-0 leading-[20px]",
                line.type === 'add' && "text-git-added",
                line.type === 'remove' && "text-git-deleted",
                line.type === 'header' && "text-accent font-semibold",
                line.type === 'context' && "text-text-secondary",
              )}>
                {line.text}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default DiffViewer;
