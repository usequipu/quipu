import React from 'react';
import { WarningIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

const FileConflictBar = ({ fileName, onReload, onKeep, onDismiss }) => {
    return (
        <div
            className={cn(
                "flex items-center gap-3 px-4 py-2 border-b border-warning/40",
                "bg-warning/10 text-text-primary text-sm shrink-0",
            )}
        >
            <WarningIcon size={16} weight="fill" className="text-warning shrink-0" />
            <span className="flex-1 min-w-0 truncate">
                <strong>{fileName}</strong> has been changed on disk.
            </span>
            <div className="flex items-center gap-2 shrink-0">
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={onReload}
                >
                    Reload
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onKeep}
                >
                    Keep yours
                </Button>
                <button
                    onClick={onDismiss}
                    className="text-text-tertiary hover:text-text-secondary p-1 rounded hover:bg-bg-elevated transition-colors"
                    aria-label="Dismiss"
                >
                    &times;
                </button>
            </div>
        </div>
    );
};

export default FileConflictBar;
