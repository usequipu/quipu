import React, { useState, useCallback } from 'react';
import { Minus, Square, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

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

interface TitleBarProps {
  /** When true, the floating restore-sidebar logo is shown on the left. */
  showRestoreLogo?: boolean;
  /** Click handler for the restore-sidebar logo. */
  onRestoreLogoClick?: () => void;
}

/**
 * Slim top strip that lives above the editor column only (not the sidebar).
 * After Phase 1 of the visual overhaul, this only hosts the Electron window
 * controls anchored to the far right. The rest of the strip is window-region
 * `drag` so the user can still move the window around by grabbing the empty
 * area. When the sidebar is collapsed (Phase 4), a floating brand logo
 * appears on the left as the restore affordance.
 */
const TitleBar: React.FC<TitleBarProps> = ({ showRestoreLogo, onRestoreLogoClick }) => {
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
      className="h-9 flex items-center bg-bg-surface shrink-0 relative z-100"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Floating restore-sidebar logo. Absolute-positioned so its center
          lands at exactly the same window coordinates as the ActivityBar's
          brand logo (which sits inside the sidebar card with its `mt-3`
          12px top margin). That way the swap between the two on collapse
          / expand reads as a fade in place, with no vertical jump. */}
      <button
        type="button"
        onClick={onRestoreLogoClick}
        aria-label="Restore sidebar"
        title="Restore sidebar"
        className={cn(
          'absolute w-5 h-5 flex items-center justify-center bg-transparent border-none cursor-pointer transition-all duration-200',
          showRestoreLogo
            ? 'opacity-100 translate-x-0 pointer-events-auto'
            : 'opacity-0 -translate-x-2 pointer-events-none',
        )}
        style={{
          // ActivityBar logo position: sidebar card mx-2 (8px) + rail w-12
          // center (24px) → x=32; my-3 (12px) + rail h-9 center (18px) → y=30.
          // Img is 20×20, so top=20 and left=22 puts its center at (32, 30).
          left: '22px',
          top: '20px',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
        tabIndex={showRestoreLogo ? 0 : -1}
      >
        <img
          src={new URL('../../assets/quipu-icon.png', import.meta.url).href}
          alt="Quipu"
          className="w-5 h-5 select-none pointer-events-none"
          draggable={false}
        />
      </button>
      <div className="flex-1" />
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
