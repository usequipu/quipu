---
name: go-server-endpoint
description: Pattern for adding new HTTP endpoints to the Go backend server
triggers:
  - adding Go endpoint
  - server/main.go changes
  - new REST API
  - Go server
---

# Go Server Endpoint Pattern

Use this skill when adding new HTTP endpoints to `server/main.go`.

## Endpoint Template

```go
func handleFeature(w http.ResponseWriter, r *http.Request) {
    // 1. Set content type
    w.Header().Set("Content-Type", "application/json")

    // 2. Parse input
    if r.Method == "GET" {
        path := r.URL.Query().Get("path")
        // validate...
    } else if r.Method == "POST" {
        var req struct {
            Path    string `json:"path"`
            // other fields...
        }
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
            http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
            return
        }
    }

    // 3. Validate workspace sandbox
    absPath, err := filepath.Abs(path)
    if err != nil || !isWithinWorkspace(absPath) {
        http.Error(w, `{"error":"path outside workspace"}`, http.StatusForbidden)
        return
    }

    // 4. Execute operation
    result, err := doSomething(absPath)
    if err != nil {
        http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
        return
    }

    // 5. Return JSON response
    json.NewEncoder(w).Encode(result)
}
```

## Registration

```go
func main() {
    // ...existing routes...
    http.HandleFunc("/feature", enableCors(handleFeature))
    // ...
}
```

## Security: Workspace Sandbox

Every endpoint that accepts a file path MUST validate it:

```go
func isWithinWorkspace(absPath string) bool {
    rel, err := filepath.Rel(workspaceRoot, absPath)
    if err != nil {
        return false
    }
    // Reject paths that escape via ".."
    return !strings.HasPrefix(rel, "..")
}
```

## Shell Commands (for git, grep, etc.)

Always use `exec.Command` with argument arrays:

```go
// CORRECT - arguments as separate strings
cmd := exec.Command("git", "status", "--porcelain", "-z")
cmd.Dir = workspacePath

// WRONG - string concatenation (command injection risk)
cmd := exec.Command("bash", "-c", "git status " + userInput)
```

Set the working directory and capture output:

```go
cmd := exec.Command("git", "diff", "--", filePath)
cmd.Dir = workspacePath
output, err := cmd.Output()
if err != nil {
    if exitErr, ok := err.(*exec.ExitError); ok {
        // stderr available in exitErr.Stderr
        return nil, fmt.Errorf("git error: %s", string(exitErr.Stderr))
    }
    return nil, err
}
```

## CORS

All endpoints are wrapped with `enableCors()`. CORS is restricted to localhost origins only.

## Response Conventions

- Success: `200 OK` with JSON body
- Client error: `400 Bad Request` with `{"error": "message"}`
- Sandbox violation: `403 Forbidden` with `{"error": "path outside workspace"}`
- Server error: `500 Internal Server Error` with `{"error": "message"}`
- Directory listings return entries sorted: directories first, then alphabetical
- Hidden files (starting with `.`) are filtered from file listings (but NOT from git operations)
