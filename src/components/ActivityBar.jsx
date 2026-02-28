import React from 'react';
import './ActivityBar.css';

const PANELS = [
    { id: 'explorer', label: 'Explorer', icon: 'files' },
    { id: 'search', label: 'Search', icon: 'search', disabled: true },
    { id: 'git', label: 'Source Control', icon: 'git', disabled: true },
];

export default function ActivityBar({ activePanel, onPanelToggle }) {
    return (
        <div className="activity-bar" role="toolbar" aria-label="Activity Bar">
            {PANELS.map(panel => (
                <button
                    key={panel.id}
                    className={`activity-bar-btn ${activePanel === panel.id ? 'activity-bar-btn-active' : ''} ${panel.disabled ? 'activity-bar-btn-disabled' : ''}`}
                    onClick={() => !panel.disabled && onPanelToggle(panel.id)}
                    aria-label={panel.label}
                    title={panel.disabled ? `${panel.label} (coming soon)` : panel.label}
                    disabled={panel.disabled}
                >
                    <span className={`activity-icon activity-icon-${panel.icon}`} />
                </button>
            ))}
        </div>
    );
}
