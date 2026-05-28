import React, { useState, useCallback } from 'react';
import { Minus, Square, X } from '@phosphor-icons/react';

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
 * area.
 */
const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

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
