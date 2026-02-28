import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import searchService from '../services/searchService';
import './SearchPanel.css';

export default function SearchPanel() {
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

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

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
    <div className="search-panel">
      <div className="search-panel-header">
        <span className="search-panel-title">Search</span>
      </div>
      <div className="search-input-container">
        <span className="search-input-icon">&#128269;</span>
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder="Search files..."
          value={query}
          onChange={handleQueryChange}
          spellCheck={false}
        />
        <div className="search-toggles">
          <button
            className={`search-toggle-btn ${isCaseSensitive ? 'search-toggle-active' : ''}`}
            onClick={handleToggleCaseSensitive}
            title="Match Case"
          >
            Aa
          </button>
          <button
            className={`search-toggle-btn ${isRegex ? 'search-toggle-active' : ''}`}
            onClick={handleToggleRegex}
            title="Use Regular Expression"
          >
            .*
          </button>
        </div>
      </div>

      <div className="search-results-container">
        {!workspacePath && (
          <div className="search-message">Open a folder to search</div>
        )}

        {workspacePath && isSearching && (
          <div className="search-message">Searching...</div>
        )}

        {workspacePath && !isSearching && error && (
          <div className="search-message search-error">{error}</div>
        )}

        {workspacePath && !isSearching && !error && query.trim() && results && results.length === 0 && (
          <div className="search-message">No results found</div>
        )}

        {isTruncated && (
          <div className="search-truncated-notice">
            Showing first 500 results
          </div>
        )}

        {groupedResults.map(group => (
          <div key={group.file} className="search-file-group">
            <div
              className="search-file-header"
              onClick={() => handleResultClick(group.file)}
              title={group.file}
            >
              <span className="search-file-name">{group.file}</span>
              <span className="search-match-count">{group.matches.length}</span>
            </div>
            {group.matches.map((match, idx) => (
              <div
                key={`${group.file}:${match.line}:${idx}`}
                className="search-result-item"
                onClick={() => handleResultClick(group.file)}
              >
                <span className="search-result-line">{match.line}</span>
                <span className="search-result-text">{match.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
