import React, { useState, useCallback } from 'react';
import { Minus, Square, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import MenuBar from './MenuBar';

const isElectron = () => !!(window.__QUIPU_WINDOW__);

const TitleBar = ({ title, onAction }) => {
  const [isMaximized, setIsMaximized] = useState(false);

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

  return (
    <div className="h-9 flex items-center justify-between bg-bg-surface border-b border-border shrink-0 relative z-100" style={{ WebkitAppRegion: 'drag' }}>
      <div className="flex items-center h-full pl-2" style={{ WebkitAppRegion: 'no-drag' }}>
        <MenuBar onAction={onAction} />
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none">
        <span className="text-xs font-normal text-text-tertiary whitespace-nowrap select-none">{title}</span>
      </div>
      <div className="flex items-center h-full">
        {isElectron() && (
          <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' }}>
            <button className="flex items-center justify-center w-[46px] h-full border-none bg-transparent text-text-secondary cursor-pointer transition-[background] duration-100 hover:bg-bg-elevated hover:text-text-primary" onClick={handleMinimize} aria-label="Minimize">
              <Minus size={14} weight="bold" />
            </button>
            <button className="flex items-center justify-center w-[46px] h-full border-none bg-transparent text-text-secondary cursor-pointer transition-[background] duration-100 hover:bg-bg-elevated hover:text-text-primary" onClick={handleMaximize} aria-label="Maximize">
              <Square size={11} weight="bold" />
            </button>
            <button className="flex items-center justify-center w-[46px] h-full border-none bg-transparent text-text-secondary cursor-pointer transition-[background] duration-100 hover:bg-error hover:text-white" onClick={handleClose} aria-label="Close">
              <X size={14} weight="bold" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TitleBar;
