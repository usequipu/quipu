import React, { useState, useCallback } from 'react';
import { Minus, Square, X } from '@phosphor-icons/react';
import { useTab } from '../../context/TabContext';
import { useFileSystem } from '../../context/FileSystemContext';

declare global {
  interface Window {
    __QUIPU_WINDOW__?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
    };
  }
}

const isElectron = (): boolean => !!(window.__QUIPU_WINDOW__);

/**
 * Slim top strip that lives above the editor column only (not the sidebar).
 * After Phase 1 of the visual overhaul, this only hosts the Electron window
 * controls anchored to the far right. The rest of the strip is window-region
 * `drag` so the user can still move the window around by grabbing the empty
 * area. The Quipu brand logo (collapse / restore sidebar toggle) is rendered
 * as an always-present, absolutely-positioned element at the App root —
 * outside this strip — so it never moves with the sidebar's collapse
 * animation.
 */
const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const { activeFile } = useTab();
  const { workspacePath } = useFileSystem();
  // Show the active file's full path, scoped to the workspace when
  // possible (so a 90-character absolute path doesn't dominate the strip
  // for files that live inside the open workspace). Falls back to
  // workspace name when no file is open. `activeFile.path` is the
  // absolute on-disk path.
  const activePath = activeFile?.path ?? null;
  const titleText = (() => {
    if (activePath && workspacePath && activePath.startsWith(workspacePath + '/')) {
      return activePath.slice(workspacePath.length + 1);
    }
    if (activePath) return activePath;
    return workspacePath?.split('/').pop() ?? '';
  })();

  const handleMinimize = useCallback(() => {
    window.__QUIPU_WINDOW__?.minimize();
  }, []);

  const handleMaximize = useCallback(() => {
    window.__QUIPU_WINDOW__?.maximize();
    setIsMaximized(prev => !prev);
  }, []);

  const handleClose = useCallback(() => {
    window.__QUIPU_WINDOW__?.close();
  }, []);

  // `isMaximized` is intentionally tracked so future affordances (e.g.,
  // swapping the maximize icon) can read it; suppress unused-var lint until
  // that lands.
  void isMaximized;

  return (
    <div
      className="h-9 flex items-center justify-end bg-bg-surface shrink-0 relative z-100"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Centered file path / workspace name. Absolute-positioned with a
          generous side inset so the window controls (right) and the
          floating brand logo (left, App-root) stay clickable. The text
          is select-none + pointer-events-none so it never interferes
          with the drag region. */}
      <div
        className="absolute left-0 right-0 mx-auto flex items-center justify-center px-32 pointer-events-none select-none"
        style={{ height: '100%' }}
      >
        <span className="text-xs font-normal text-text-tertiary whitespace-nowrap overflow-hidden text-ellipsis max-w-full" title={activePath ?? ''}>
          {titleText}
        </span>
      </div>
      {isElectron() && (
        <div
          className="flex items-center h-full"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            className="flex items-center justify-center w-[46px] h-full border-none bg-transparent text-text-secondary cursor-pointer transition-[background] duration-100 hover:bg-bg-elevated hover:text-text-primary"
            onClick={handleMinimize}
            aria-label="Minimize"
          >
            <Minus size={14} weight="bold" />
          </button>
          <button
            className="flex items-center justify-center w-[46px] h-full border-none bg-transparent text-text-secondary cursor-pointer transition-[background] duration-100 hover:bg-bg-elevated hover:text-text-primary"
            onClick={handleMaximize}
            aria-label="Maximize"
          >
            <Square size={11} weight="bold" />
          </button>
          <button
            className="flex items-center justify-center w-[46px] h-full border-none bg-transparent text-text-secondary cursor-pointer transition-[background] duration-100 hover:bg-error hover:text-white"
            onClick={handleClose}
            aria-label="Close"
          >
            <X size={14} weight="bold" />
          </button>
        </div>
      )}
    </div>
  );
};

export default TitleBar;
