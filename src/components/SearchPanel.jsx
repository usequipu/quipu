import React, { useState, useCallback, useRef, useEffect } from 'react';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../context/WorkspaceContext';
import searchService from '../services/searchService';

export default function SearchPanel({ activePanel }) {
  const { workspacePath, openFile } = useWorkspace();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);

  // Focus input when this panel becomes active
  useEffect(() => {
    if (activePanel === 'search' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activePanel]);

  const performSearch = useCallback(async (searchQuery, caseSensitive, regex) => {
    if (!workspacePath || !searchQuery.trim()) {
      setResults(null);
      setIsTruncated(false);
      setError(null);
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const response = await searchService.search(workspacePath, searchQuery, {
        caseSensitive,
        regex,
      });
      setResults(response.results);
      setIsTruncated(response.truncated);
    } catch (err) {
      setError(err.message);
      setResults(null);
      setIsTruncated(false);
    } finally {
      setIsSearching(false);
    }
  }, [workspacePath]);

  // Debounced search triggered by query, caseSensitive, or regex changes
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setResults(null);
      setIsTruncated(false);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      performSearch(query, isCaseSensitive, isRegex);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, isCaseSensitive, isRegex, performSearch]);

  const handleQueryChange = useCallback((e) => {
    setQuery(e.target.value);
  }, []);

  const handleToggleCaseSensitive = useCallback(() => {
    setIsCaseSensitive(prev => !prev);
  }, []);

  const handleToggleRegex = useCallback(() => {
    setIsRegex(prev => !prev);
  }, []);

  const handleResultClick = useCallback((filePath) => {
    if (!workspacePath) return;
    // Build absolute path from workspace + relative path
    const absolutePath = workspacePath + '/' + filePath;
    const fileName = filePath.split('/').pop();
    openFile(absolutePath, fileName);
  }, [workspacePath, openFile]);

  // Group results by file
  const groupedResults = React.useMemo(() => {
    if (!results || results.length === 0) return [];

    const groups = {};
    for (const result of results) {
      if (!groups[result.file]) {
        groups[result.file] = [];
      }
      groups[result.file].push(result);
    }

    return Object.entries(groups).map(([file, matches]) => ({
      file,
      matches,
    }));
  }, [results]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 pt-2.5 pb-1.5 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-primary opacity-70">Search</span>
      </div>
      <div className="flex items-center mx-2.5 mb-2 bg-bg-elevated border border-border rounded px-1 shrink-0 focus-within:border-accent">
        <MagnifyingGlassIcon size={16} className="shrink-0 opacity-50 px-1" />
        <input
          ref={inputRef}
          type="text"
          className="flex-1 border-none outline-none bg-transparent py-1.5 px-1 text-[13px] font-sans text-text-primary min-w-0 placeholder:text-text-tertiary"
          placeholder="Search files..."
          value={query}
          onChange={handleQueryChange}
          spellCheck={false}
        />
        <div className="flex gap-0.5 shrink-0">
          <button
            className={cn(
              "bg-transparent border border-transparent rounded-sm py-0.5 px-1.5 text-xs font-mono text-text-primary opacity-50 cursor-pointer leading-none",
              "hover:opacity-80 hover:bg-white/5",
              isCaseSensitive && "opacity-100 bg-accent text-white border-accent hover:opacity-100 hover:bg-accent-hover",
            )}
            onClick={handleToggleCaseSensitive}
            title="Match Case"
          >
            Aa
          </button>
          <button
            className={cn(
              "bg-transparent border border-transparent rounded-sm py-0.5 px-1.5 text-xs font-mono text-text-primary opacity-50 cursor-pointer leading-none",
              "hover:opacity-80 hover:bg-white/5",
              isRegex && "opacity-100 bg-accent text-white border-accent hover:opacity-100 hover:bg-accent-hover",
            )}
            onClick={handleToggleRegex}
            title="Use Regular Expression"
          >
            .*
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {!workspacePath && (
          <div className="py-4 px-3 text-center text-[13px] text-text-primary opacity-50 italic">Open a folder to search</div>
        )}

        {workspacePath && isSearching && (
          <div className="py-4 px-3 text-center text-[13px] text-text-primary opacity-50 italic">Searching...</div>
        )}

        {workspacePath && !isSearching && error && (
          <div className="py-4 px-3 text-center text-[13px] text-error opacity-80 italic">{error}</div>
        )}

        {workspacePath && !isSearching && !error && query.trim() && results && results.length === 0 && (
          <div className="py-4 px-3 text-center text-[13px] text-text-primary opacity-50 italic">No results found</div>
        )}

        {isTruncated && (
          <div className="py-1 px-3 text-[11px] text-accent text-center shrink-0">
            Showing first 500 results
          </div>
        )}

        {groupedResults.map(group => (
          <div key={group.file} className="mb-0.5">
            <div
              className="flex items-center justify-between py-1 px-3 cursor-pointer text-xs font-semibold text-text-primary bg-white/[0.03] hover:bg-white/[0.07]"
              onClick={() => handleResultClick(group.file)}
              title={group.file}
            >
              <span className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0">{group.file}</span>
              <span className="shrink-0 ml-2 text-[11px] font-normal opacity-60 bg-white/[0.06] px-1.5 rounded-full">{group.matches.length}</span>
            </div>
            {group.matches.map((match, idx) => (
              <div
                key={`${group.file}:${match.line}:${idx}`}
                className="flex items-baseline py-0.5 pr-3 pl-5 cursor-pointer text-xs gap-2 hover:bg-white/5"
                onClick={() => handleResultClick(group.file)}
              >
                <span className="shrink-0 font-mono text-[11px] text-accent min-w-7 text-right">{match.line}</span>
                <span className="font-mono text-xs text-text-primary overflow-hidden text-ellipsis whitespace-nowrap min-w-0">{match.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
