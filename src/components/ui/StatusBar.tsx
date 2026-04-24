import React, { useState } from 'react';
import { CloudIcon, CloudCheckIcon, CircleNotchIcon, WarningIcon } from '@phosphor-icons/react';
import { useKamalu } from '../../context/KamaluContext';
import KamaluConnectDialog from './KamaluConnectDialog';
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
    if (status === 'connecting') return <CircleNotchIcon size={12} className="animate-spin shrink-0" />;
    if (status === 'connected') return <CloudCheckIcon size={12} className="shrink-0" />;
    if (status === 'error') return <WarningIcon size={12} className="shrink-0" />;
    return <CloudIcon size={12} className="shrink-0" />;
  })();

  return (
    <>
      <div
        className="flex items-center h-[22px] w-full shrink-0 select-none"
        style={{ backgroundColor: 'var(--color-activity-bar)' }}
      >
        {/* Remote connect button — left side, VS Code style */}
        <button
          onClick={() => setDialogOpen(true)}
          title={status === 'connected' ? `Connected to ${serverUrl}` : 'Connect to Kamalu remote'}
          className={cn(
            'flex items-center gap-1.5 h-full px-3 text-[11px] font-medium transition-colors',
            'text-[var(--color-activity-bar-text)]',
            status === 'connected'
              ? 'hover:bg-white/10'
              : status === 'error'
              ? 'hover:bg-error/20'
              : 'hover:bg-white/10'
          )}
        >
          {icon}
          <span className="leading-none">{label}</span>
        </button>
      </div>

      <KamaluConnectDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
