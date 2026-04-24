import React, { useState, useEffect } from 'react';
import { Dialog } from 'radix-ui';
import { XIcon, CircleNotchIcon, CheckCircleIcon, WarningCircleIcon, CloudIcon } from '@phosphor-icons/react';
import { useKamalu } from '../../context/KamaluContext';
import { cn } from '../../lib/utils';

interface KamaluConnectDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function KamaluConnectDialog({ open, onClose }: KamaluConnectDialogProps) {
  const { status, serverUrl, user, errorMessage, connect, signIn, disconnect } = useKamalu();
  const isConnected = status === 'connected';

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [urlValue, setUrlValue] = useState(serverUrl ?? 'https://api.quipu.cc');
  const [keyValue, setKeyValue] = useState('');

  useEffect(() => {
    if (open) {
      setUrlValue(serverUrl ?? 'https://api.quipu.cc');
      setKeyValue('');
      setShowAdvanced(false);
    }
  }, [open, serverUrl]);

  const handleSignIn = () => {
    signIn();
  };

  const handleManualConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlValue.trim() || !keyValue.trim()) return;
    await connect(urlValue.trim(), keyValue.trim());
  };

  const handleDisconnect = () => {
    disconnect();
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-[9998]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg-elevated border border-border rounded-lg shadow-xl w-[420px] z-[9999] outline-none">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
            <Dialog.Title className="text-sm font-semibold text-text-primary">
              Connect to Kamalu
            </Dialog.Title>
            <button
              onClick={onClose}
              className="text-text-tertiary hover:text-text-primary transition-colors p-0.5 rounded"
            >
              <XIcon size={14} />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            {isConnected && user && (
              <div className="flex items-center gap-2.5 bg-success/10 border border-success/20 rounded-md px-3 py-2.5">
                <CheckCircleIcon size={16} className="text-success shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text-primary truncate">{user.email}</p>
                  <p className="text-xs text-text-tertiary truncate">{serverUrl}</p>
                </div>
              </div>
            )}

            {status === 'error' && errorMessage && (
              <div className="flex items-start gap-2.5 bg-error/10 border border-error/20 rounded-md px-3 py-2.5">
                <WarningCircleIcon size={16} className="text-error shrink-0 mt-0.5" />
                <p className="text-xs text-error">{errorMessage}</p>
              </div>
            )}

            {!isConnected && !showAdvanced && (
              <div className="space-y-3">
                <p className="text-sm text-text-secondary leading-relaxed">
                  Sign in with your Kamalu account to sync and publish knowledge bases.
                </p>
                <button
                  onClick={handleSignIn}
                  disabled={status === 'connecting'}
                  className={cn(
                    'w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-md text-white transition-colors',
                    status === 'connecting'
                      ? 'bg-accent/60 cursor-not-allowed'
                      : 'bg-accent hover:bg-accent-hover'
                  )}
                >
                  {status === 'connecting'
                    ? <><CircleNotchIcon size={14} className="animate-spin" /> Waiting for sign-in…</>
                    : <><CloudIcon size={14} /> Sign in with Kamalu</>}
                </button>
                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => setShowAdvanced(true)}
                    className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
                  >
                    Advanced: use API key
                  </button>
                  <button
                    onClick={onClose}
                    className="text-xs text-text-secondary hover:text-text-primary transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {!isConnected && showAdvanced && (
              <form onSubmit={handleManualConnect} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    Server URL
                  </label>
                  <input
                    type="url"
                    value={urlValue}
                    onChange={(e) => setUrlValue(e.target.value)}
                    placeholder="https://api.quipu.cc"
                    className="w-full px-3 py-2 text-sm bg-bg-surface border border-border rounded-md text-text-primary outline-none focus:border-accent font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={keyValue}
                    onChange={(e) => setKeyValue(e.target.value)}
                    placeholder="kam_..."
                    className="w-full px-3 py-2 text-sm bg-bg-surface border border-border rounded-md text-text-primary outline-none focus:border-accent font-mono"
                    required
                  />
                </div>
                <div className="flex justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(false)}
                    className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
                  >
                    ← Back to sign-in
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={status === 'connecting'}
                      className={cn(
                        'flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-md text-white transition-colors',
                        status === 'connecting'
                          ? 'bg-accent/60 cursor-not-allowed'
                          : 'bg-accent hover:bg-accent-hover'
                      )}
                    >
                      {status === 'connecting' && (
                        <CircleNotchIcon size={13} className="animate-spin" />
                      )}
                      {status === 'connecting' ? 'Connecting…' : 'Connect'}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {isConnected && (
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={handleDisconnect}
                  className="px-4 py-1.5 text-sm bg-error/15 text-error hover:bg-error/25 rounded-md transition-colors"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
