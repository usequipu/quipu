import React from 'react';
import { toast, Toaster } from 'sonner';
import type { ToastType } from '@/types/workspace';

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => number;
}

interface ToastProviderProps {
  children: React.ReactNode;
}

let toastIdCounter = 0;

/**
 * Maps our ToastType to the appropriate sonner toast method and returns
 * a stable numeric id for backward compatibility.
 */
export function showToast(message: string, type: ToastType = 'info'): number {
  const id = ++toastIdCounter;
  const numericId = String(id);

  switch (type) {
    case 'error':
      toast.error(message, { id: numericId });
      break;
    case 'warning':
      toast.warning(message, { id: numericId });
      break;
    case 'success':
      toast.success(message, { id: numericId });
      break;
    case 'info':
    default:
      toast.info(message, { id: numericId });
      break;
  }

  return id;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: ToastProviderProps) {
  const contextValue = React.useMemo<ToastContextValue>(() => ({ showToast }), []);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <Toaster
        theme="dark"
        position="bottom-right"
        visibleToasts={5}
        toastOptions={{
          className: 'font-sans',
          style: {
            background: 'var(--color-bg-elevated)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
            fontSize: '13px',
          },
        }}
      />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
