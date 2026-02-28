const GO_SERVER = 'http://localhost:3000';

function isElectron() {
  return !!(window.electronAPI && window.electronAPI.searchFiles);
}

const electronSearch = {
  search: (dirPath, query, options) => window.electronAPI.searchFiles(dirPath, query, options),
  listFilesRecursive: (dirPath, limit) => window.electronAPI.listFilesRecursive(dirPath, limit),
};

const browserSearch = {
  search: async (dirPath, query, options = {}) => {
    const params = new URLSearchParams({
      path: dirPath,
      q: query,
      regex: options.regex || false,
      caseSensitive: options.caseSensitive || false,
    });
    const res = await fetch(`${GO_SERVER}/search?${params}`);
    if (!res.ok) throw new Error(`Search failed: ${res.statusText}`);
    return res.json();
  },
  listFilesRecursive: async (dirPath, limit = 5000) => {
    const res = await fetch(`${GO_SERVER}/files-recursive?path=${encodeURIComponent(dirPath)}&limit=${limit}`);
    if (!res.ok) throw new Error(`File listing failed: ${res.statusText}`);
    return res.json();
  },
};

const searchService = isElectron() ? electronSearch : browserSearch;
export default searchService;
