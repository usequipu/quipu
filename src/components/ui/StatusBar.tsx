import React, { useState } from 'react';
import { CloudIcon, CloudCheckIcon, WarningIcon } from '@phosphor-icons/react';
import { useKamalu } from '../../context/KamaluContext';
import KamaluConnectDialog from './KamaluConnectDialog';
import { ScribeGlyphs, MayanLoader } from './ScribeGlyphs';
import { cn } from '../../lib/utils';

export default function StatusBar() {
  const { status, serverUrl, user } = useKamalu();
  const [dialogOpen, setDialogOpen] = useState(false);

  const label = (() => {
    if (status === 'connected' && user) return user.email;
    if (status === 'connecting') return 'Connecting…';
    if (status === 'error') return 'Connection failed';
    return 'Connect to Kamalu';
  })();

  const icon = (() => {
    if (status === 'connecting') return <MayanLoader />;
    if (status === 'connected') return <CloudCheckIcon size={12} className="shrink-0" />;
    if (status === 'error') return <WarningIcon size={12} className="shrink-0" />;
    return <CloudIcon size={12} className="shrink-0" />;
  })();

  return (
    <>
      <div
        className="flex items-center h-[22px] w-full shrink-0 select-none bg-bg-surface"
      >
        {/* Remote connect button — left side, VS Code style */}
        <button
          onClick={() => setDialogOpen(true)}
          title={status === 'connected' ? `Connected to ${serverUrl}` : 'Connect to Kamalu remote'}
          className={cn(
            'flex items-center gap-1.5 h-full px-3 text-[11px] font-medium transition-colors',
            'text-text-tertiary',
            status === 'connected'
              ? 'hover:bg-bg-elevated'
              : status === 'error'
              ? 'hover:bg-error/20'
              : 'hover:bg-bg-elevated'
          )}
        >
          {icon}
          <span className="leading-none">{label}</span>
        </button>

        {/* Scribe glyphs — right-aligned ambient ornament that ticks on
            every input or selection change. Decorative; not interactive. */}
        <div className="ml-auto flex items-center h-full px-3 text-text-tertiary">
          <ScribeGlyphs />
        </div>
      </div>

      <KamaluConnectDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
