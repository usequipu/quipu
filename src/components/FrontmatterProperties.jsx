import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CaretRight, CaretDown, X, Plus } from '@phosphor-icons/react';

const FrontmatterField = ({ fieldKey, value, onUpdate, onRemove, onRenameKey }) => {
  const [isEditingKey, setIsEditingKey] = useState(false);
  const [editingKeyValue, setEditingKeyValue] = useState(fieldKey);

  const isArray = Array.isArray(value);
  const isBoolean = typeof value === 'boolean';
  const isObject = typeof value === 'object' && value !== null && !isArray;

  const handleKeyBlur = () => {
    setIsEditingKey(false);
    if (editingKeyValue && editingKeyValue !== fieldKey) {
      onRenameKey(fieldKey, editingKeyValue);
    } else {
      setEditingKeyValue(fieldKey);
    }
  };

  const handleKeyKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.target.blur();
    } else if (e.key === 'Escape') {
      setEditingKeyValue(fieldKey);
      setIsEditingKey(false);
    }
  };

  return (
    <div className="flex items-start gap-3 group">
      {/* Key */}
      {isEditingKey ? (
        <Input
          value={editingKeyValue}
          onChange={(e) => setEditingKeyValue(e.target.value)}
          onBlur={handleKeyBlur}
          onKeyDown={handleKeyKeyDown}
          autoFocus
          className="w-28 shrink-0 h-7 text-xs font-mono text-page-text/70
                     bg-transparent border-page-border"
        />
      ) : (
        <span
          className="w-28 shrink-0 text-xs font-mono text-page-text/50 pt-1.5
                     truncate cursor-pointer hover:text-page-text/70"
          onClick={() => setIsEditingKey(true)}
          title={fieldKey}
        >
          {fieldKey}
        </span>
      )}

      {/* Value */}
      <div className="flex-1 min-w-0">
        {isArray ? (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {value.map((item, i) => (
              <Badge key={i} variant="secondary" className="text-xs font-mono">
                {String(item)}
              </Badge>
            ))}
          </div>
        ) : isBoolean ? (
          <button
            className={cn(
              "mt-1 w-8 h-4 rounded-full transition-colors relative",
              value ? "bg-accent" : "bg-page-border"
            )}
            onClick={() => onUpdate(fieldKey, !value)}
          >
            <span
              className={cn(
                "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
                value ? "left-4" : "left-0.5"
              )}
            />
          </button>
        ) : isObject ? (
          <pre className="text-xs font-mono text-page-text/60 whitespace-pre-wrap pt-1">
            {JSON.stringify(value, null, 2)}
          </pre>
        ) : (
          <Input
            value={String(value ?? '')}
            onChange={(e) => onUpdate(fieldKey, e.target.value)}
            className="h-7 text-sm font-mono bg-transparent border-transparent
                       text-page-text hover:border-page-border focus:border-accent"
          />
        )}
      </div>

      {/* Remove button */}
      <button
        className="mt-1.5 opacity-0 group-hover:opacity-100 p-0.5 text-page-text/30
                   hover:text-error transition-opacity cursor-pointer"
        onClick={() => onRemove(fieldKey)}
        title="Remove property"
      >
        <X size={12} />
      </button>
    </div>
  );
};

const FrontmatterProperties = ({
  frontmatter,
  frontmatterRaw,
  isCollapsed,
  tabId,
  onUpdate,
  onAdd,
  onRemove,
  onRenameKey,
  onToggleCollapse,
}) => {
  // No frontmatter at all — don't render
  if (!frontmatter && !frontmatterRaw) return null;

  const count = Object.keys(frontmatter || {}).length;

  // Malformed YAML fallback
  if (frontmatterRaw && !frontmatter) {
    return (
      <Collapsible open={!isCollapsed} onOpenChange={() => onToggleCollapse(tabId)}>
        <CollapsibleTrigger
          className="flex items-center gap-2 w-full px-4 py-2 text-xs font-mono
                     text-page-text/60 bg-page-bg border-b border-page-border
                     hover:text-page-text/80 cursor-pointer"
        >
          {isCollapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
          <span>Properties (malformed YAML)</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="px-4 py-3 text-xs font-mono text-error/80 bg-error/5
                          border-b border-page-border whitespace-pre-wrap">
            {frontmatterRaw}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // Normal properties view
  return (
    <Collapsible open={!isCollapsed} onOpenChange={() => onToggleCollapse(tabId)}>
      <CollapsibleTrigger
        className="flex items-center gap-2 w-full px-4 py-2 text-xs font-mono
                   text-page-text/60 bg-page-bg border-b border-page-border
                   hover:text-page-text/80 cursor-pointer"
      >
        {isCollapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
        <span>Properties {count > 0 ? `(${count})` : ''}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 py-3 space-y-1.5 bg-page-bg border-b border-page-border">
          {count > 0 ? (
            Object.entries(frontmatter).map(([key, value]) => (
              <FrontmatterField
                key={key}
                fieldKey={key}
                value={value}
                onUpdate={(k, v) => onUpdate(tabId, k, v)}
                onRemove={(k) => onRemove(tabId, k)}
                onRenameKey={(oldK, newK) => onRenameKey(tabId, oldK, newK)}
              />
            ))
          ) : (
            <p className="text-xs font-mono text-page-text/40 py-1">No properties</p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-xs font-mono text-accent/70 hover:text-accent
                       px-0 h-6"
            onClick={() => onAdd(tabId)}
          >
            <Plus size={12} className="mr-1" />
            Add property
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default FrontmatterProperties;
