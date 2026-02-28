---
name: dual-runtime-service
description: Pattern for adding backend features that work in both Electron and browser runtimes
triggers:
  - adding new backend API endpoint
  - creating new service module
  - extending existing service with new operations
  - gitService, searchService, fileSystem
---

# Dual-Runtime Service Pattern

Use this skill when adding new backend features (file operations, git commands, search, etc.) to Quipu. Every backend operation must work in both Electron and browser runtimes.

## When to Use

- Adding a new backend API endpoint
- Creating a new service module (like gitService.js or searchService.js)
- Extending an existing service with new operations

## The Pattern

### 1. Go Server Endpoint (`server/main.go`)

Add the HTTP handler:

```go
func handleNewFeature(w http.ResponseWriter, r *http.Request) {
    // 1. Parse request (query params for GET, JSON body for POST)
    // 2. Validate path is within workspace sandbox
    // 3. Execute operation
    // 4. Return JSON response
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(result)
}
```

Register the route in `main()`:
```go
http.HandleFunc("/new-feature", enableCors(handleNewFeature))
```

### 2. Electron IPC Handler (`electron/main.cjs`)

Add the IPC handler:

```javascript
ipcMain.handle('new-feature', async (event, ...args) => {
    // Execute operation using Node.js APIs
    // Return result (will be serialized to renderer)
});
```

### 3. Preload Bridge (`electron/preload.cjs`)

Expose via contextBridge:

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
    // ...existing methods
    newFeature: (...args) => ipcRenderer.invoke('new-feature', ...args),
});
```

### 4. Service Adapter (`src/services/<name>.js`)

```javascript
const GO_SERVER = 'http://localhost:3000';

function isElectron() {
    return !!(window.electronAPI && window.electronAPI.readDirectory);
}

const electronImpl = {
    newFeature: (...args) => window.electronAPI.newFeature(...args),
};

const browserImpl = {
    newFeature: async (...args) => {
        const res = await fetch(`${GO_SERVER}/new-feature`, { /* ... */ });
        if (!res.ok) throw new Error(`Failed: ${res.statusText}`);
        return res.json();
    },
};

const service = isElectron() ? electronImpl : browserImpl;
export default service;
```

## Checklist

- [ ] Go server endpoint added with workspace path validation
- [ ] Electron IPC handler added in main.cjs
- [ ] Preload bridge method added in preload.cjs
- [ ] Service adapter created/updated with both implementations
- [ ] Both implementations return the same data shape
- [ ] Error handling returns meaningful messages (not raw stack traces)

## Security Rules

- **Always validate paths** are within the workspace root before any file/git/search operation
- **Use `exec.Command` with argument arrays** for shell commands (never string concatenation)
- **Never pass user input directly** into shell command strings
