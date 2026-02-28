import React, { useCallback } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import './TabBar.css';

export default function TabBar() {
    const { openTabs, activeTabId, switchTab, closeTab } = useWorkspace();

    const handleClose = useCallback((e, tabId) => {
        e.stopPropagation();
        closeTab(tabId);
    }, [closeTab]);

    if (openTabs.length === 0) return null;

    return (
        <div className="tab-bar" role="tablist">
            {openTabs.map(tab => (
                <div
                    key={tab.id}
                    className={`tab ${tab.id === activeTabId ? 'tab-active' : ''}`}
                    role="tab"
                    aria-selected={tab.id === activeTabId}
                    onClick={() => switchTab(tab.id)}
                    title={tab.path}
                >
                    <span className="tab-name">{tab.name}</span>
                    {tab.isDirty && <span className="tab-dirty" aria-label="unsaved changes" />}
                    <button
                        className="tab-close"
                        onClick={(e) => handleClose(e, tab.id)}
                        aria-label={`Close ${tab.name}`}
                    >
                        &times;
                    </button>
                </div>
            ))}
        </div>
    );
}
