import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import './Toast.css';

const ToastContext = createContext(null);

let toastIdCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const dismissToast = useCallback((id) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message, type = 'info') => {
    const id = ++toastIdCounter;

    setToasts(prev => {
      const next = [...prev, { id, message, type }];
      // Maximum 5 visible toasts, remove oldest
      if (next.length > 5) {
        const removed = next.shift();
        if (timersRef.current[removed.id]) {
          clearTimeout(timersRef.current[removed.id]);
          delete timersRef.current[removed.id];
        }
      }
      return next;
    });

    // Auto-dismiss after 5 seconds
    timersRef.current[id] = setTimeout(() => {
      dismissToast(id);
    }, 5000);

    return id;
  }, [dismissToast]);

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const handleDismiss = useCallback((id) => {
    dismissToast(id);
  }, [dismissToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-container">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`toast-item toast-${toast.type}`}
          >
            <div className="toast-icon" />
            <div className="toast-body">
              <span className="toast-message">{toast.message}</span>
              <button
                className="toast-dismiss"
                onClick={() => handleDismiss(toast.id)}
                aria-label="Dismiss notification"
              >
                &times;
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
