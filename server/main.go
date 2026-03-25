package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// workspaceRoot is the directory that all file operations are restricted to.
// Set via -workspace flag or auto-detected on the first /files request.
var workspaceRoot string

// workspaceExplicit is true when -workspace was passed on the command line.
// When false (auto-detected), path sandboxing is relaxed to allow browsing
// parent directories (e.g., folder picker).
var workspaceExplicit bool

// isLocalOrigin returns true for origins that are localhost, 127.0.0.1,
// [::1] (IPv6 loopback), or file:// / null (Electron loads from disk).
func isLocalOrigin(origin string) bool {
	if origin == "" || origin == "null" || origin == "file://" {
		return true
	}
	for _, prefix := range []string{
		"http://localhost", "http://127.0.0.1", "http://[::1]",
		"https://localhost", "https://127.0.0.1", "https://[::1]",
	} {
		if strings.HasPrefix(origin, prefix) {
			return true
		}
	}
	return false
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		ok := isLocalOrigin(origin)
		if !ok {
			log.Printf("WebSocket origin rejected: %q", origin)
		}
		return ok
	},
}

type WindowSize struct {
	Cols int `json:"cols"`
	Rows int `json:"rows"`
}

// File system types
type FileEntry struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	IsDirectory bool   `json:"isDirectory"`
}

type WriteFileRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type CreateFolderRequest struct {
	Path string `json:"path"`
}

type RenameRequest struct {
	OldPath string `json:"oldPath"`
	NewPath string `json:"newPath"`
}

type UploadImageRequest struct {
	Path string `json:"path"`
	Data string `json:"data"` // base64-encoded image data
}

// CORS middleware
func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isLocalOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		} else if origin != "" {
			log.Printf("CORS: non-local origin %q for %s %s", origin, r.Method, r.URL.Path)
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func jsonResponse(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// isWithinWorkspace checks whether absPath is contained within the workspace root.
// When the workspace was auto-detected (not set via -workspace flag), this is
// permissive and allows any absolute path — the user needs to browse parent
// directories for the folder picker.
func isWithinWorkspace(absPath string) bool {
	if !workspaceExplicit {
		// No explicit sandbox — allow any path
		return true
	}
	if workspaceRoot == "" {
		return false
	}
	// Resolve to clean absolute path
	resolved, err := filepath.Abs(absPath)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(workspaceRoot, resolved)
	if err != nil {
		return false
	}
	// Reject if the relative path escapes the workspace
	if strings.HasPrefix(rel, "..") {
		return false
	}
	return true
}

// GET /files?path=<dir>
func handleListFiles(w http.ResponseWriter, r *http.Request) {
	dirPath := r.URL.Query().Get("path")
	if dirPath == "" {
		jsonError(w, "path parameter required", http.StatusBadRequest)
		return
	}

	// Resolve to absolute path
	absPath, err := filepath.Abs(dirPath)
	if err != nil {
		jsonError(w, "invalid path", http.StatusBadRequest)
		return
	}

	// Auto-set workspace root on the first /files request
	if workspaceRoot == "" {
		workspaceRoot = absPath
		log.Printf("Workspace root set to: %s", workspaceRoot)
	}

	// Validate the path is within the workspace
	if !isWithinWorkspace(absPath) {
		log.Printf("403 /files: path %q outside workspace %q (explicit=%v)", absPath, workspaceRoot, workspaceExplicit)
		jsonError(w, "path outside workspace", http.StatusForbidden)
		return
	}

	entries, err := os.ReadDir(absPath)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	files := []FileEntry{}
	for _, e := range entries {
		if hiddenDirs[e.Name()] {
			continue
		}
		files = append(files, FileEntry{
			Name:        e.Name(),
			Path:        filepath.Join(absPath, e.Name()),
			IsDirectory: e.IsDir(),
		})
	}

	// Sort: directories first, then alphabetical
	sort.Slice(files, func(i, j int) bool {
		if files[i].IsDirectory != files[j].IsDirectory {
			return files[i].IsDirectory
		}
		return strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name)
	})

	jsonResponse(w, files)
}

// GET /file?path=<file>
func handleReadFile(w http.ResponseWriter, r *http.Request) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		jsonError(w, "path parameter required", http.StatusBadRequest)
		return
	}

	absPath, err := filepath.Abs(filePath)
	if err != nil {
		jsonError(w, "invalid path", http.StatusBadRequest)
		return
	}

	if !isWithinWorkspace(absPath) {
		jsonError(w, "path outside workspace", http.StatusForbidden)
		return
	}

	content, err := os.ReadFile(absPath)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	ext := filepath.Ext(absPath)
	mimeType := mime.TypeByExtension(ext)
	if mimeType != "" {
		w.Header().Set("Content-Type", mimeType)
	} else {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	}
	w.Write(content)
}

// POST /file  { path, content }
func handleWriteFile(w http.ResponseWriter, r *http.Request) {
	var req WriteFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	absPath, err := filepath.Abs(req.Path)
	if err != nil {
		jsonError(w, "invalid path", http.StatusBadRequest)
		return
	}

	if !isWithinWorkspace(absPath) {
		jsonError(w, "path outside workspace", http.StatusForbidden)
		return
	}

	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := os.WriteFile(absPath, []byte(req.Content), 0644); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]bool{"success": true})
}

// DELETE /file?path=<path>
func handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	targetPath := r.URL.Query().Get("path")
	if targetPath == "" {
		jsonError(w, "path parameter required", http.StatusBadRequest)
		return
	}

	absPath, err := filepath.Abs(targetPath)
	if err != nil {
		jsonError(w, "invalid path", http.StatusBadRequest)
		return
	}

	if !isWithinWorkspace(absPath) {
		jsonError(w, "path outside workspace", http.StatusForbidden)
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if info.IsDir() {
		err = os.RemoveAll(absPath)
	} else {
		err = os.Remove(absPath)
	}

	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]bool{"success": true})
}

// POST /folder  { path }
func handleCreateFolder(w http.ResponseWriter, r *http.Request) {
	var req CreateFolderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	absPath, err := filepath.Abs(req.Path)
	if err != nil {
		jsonError(w, "invalid path", http.StatusBadRequest)
		return
	}

	if !isWithinWorkspace(absPath) {
		jsonError(w, "path outside workspace", http.StatusForbidden)
		return
	}

	if err := os.MkdirAll(absPath, 0755); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]bool{"success": true})
}

// PUT /rename  { oldPath, newPath }
func handleRename(w http.ResponseWriter, r *http.Request) {
	var req RenameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	absOldPath, err := filepath.Abs(req.OldPath)
	if err != nil {
		jsonError(w, "invalid old path", http.StatusBadRequest)
		return
	}

	absNewPath, err := filepath.Abs(req.NewPath)
	if err != nil {
		jsonError(w, "invalid new path", http.StatusBadRequest)
		return
	}

	if !isWithinWorkspace(absOldPath) || !isWithinWorkspace(absNewPath) {
		jsonError(w, "path outside workspace", http.StatusForbidden)
		return
	}

	if err := os.Rename(absOldPath, absNewPath); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]bool{"success": true})
}

// POST /upload  { path, data }  — write base64-encoded binary (image) to disk
func handleUploadImage(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req UploadImageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" || req.Data == "" {
		jsonError(w, "path and data required", http.StatusBadRequest)
		return
	}

	absPath, err := filepath.Abs(req.Path)
	if err != nil {
		jsonError(w, "invalid path", http.StatusBadRequest)
		return
	}

	if !isWithinWorkspace(absPath) {
		jsonError(w, "path outside workspace", http.StatusForbidden)
		return
	}

	decoded, err := base64.StdEncoding.DecodeString(req.Data)
	if err != nil {
		jsonError(w, "invalid base64 data: "+err.Error(), http.StatusBadRequest)
		return
	}

	dir := filepath.Dir(absPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		jsonError(w, "failed to create directory: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := os.WriteFile(absPath, decoded, 0644); err != nil {
		jsonError(w, "failed to write image: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]interface{}{
		"success": true,
		"path":    absPath,
	})
}

// activeTerminals tracks the number of concurrent terminal WebSocket connections.
var activeTerminals int32
const maxTerminals = 5

func handleTerminal(w http.ResponseWriter, r *http.Request) {
	// Enforce connection limit
	current := atomic.AddInt32(&activeTerminals, 1)
	if current > int32(maxTerminals) {
		atomic.AddInt32(&activeTerminals, -1)
		http.Error(w, "maximum number of terminals reached", http.StatusServiceUnavailable)
		return
	}
	defer atomic.AddInt32(&activeTerminals, -1)

	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Print("upgrade:", err)
		return
	}
	defer c.Close()

	// Determine shell
	shell := "bash"
	if runtime.GOOS == "windows" {
		shell = "powershell.exe"
	}

	dir := workspaceRoot
	if cwd := r.URL.Query().Get("cwd"); cwd != "" {
		dir = cwd
	}

	// Start platform-specific PTY
	sess, err := startPTY(shell, dir, 80, 30)
	if err != nil {
		log.Print("pty start:", err)
		c.WriteMessage(websocket.TextMessage, []byte("Error starting PTY: "+err.Error()))
		return
	}
	defer sess.Close()

	// Read from WebSocket, write to PTY (handles resize + input)
	go func() {
		for {
			_, message, err := c.ReadMessage()
			if err != nil {
				return
			}

			// Check if it's a resize message (JSON) or raw input
			if len(message) > 0 && message[0] == '{' {
				var size WindowSize
				if err := json.Unmarshal(message, &size); err == nil {
					_ = sess.Resize(uint16(size.Cols), uint16(size.Rows))
					continue
				}
			}

			if _, err := sess.Write(message); err != nil {
				return
			}
		}
	}()

	// Copy PTY output to WebSocket
	buf := make([]byte, 1024)
	for {
		n, err := sess.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Println("read from pty:", err)
			}
			break
		}
		if err = c.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
			log.Println("write to ws:", err)
			break
		}
	}
}

// Search types
type SearchResult struct {
	File string `json:"file"`
	Line int    `json:"line"`
	Text string `json:"text"`
}

type SearchResponse struct {
	Results   []SearchResult `json:"results"`
	Truncated bool           `json:"truncated"`
}

// File listing types
type FileListEntry struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

type FilesRecursiveResponse struct {
	Files     []FileListEntry `json:"files"`
	Truncated bool            `json:"truncated"`
}

// hiddenDirs are never shown in the file explorer (readdir).
var hiddenDirs = map[string]bool{".git": true, ".quipu": true}

// Directories to exclude from recursive file listing and search
var excludeDirs = map[string]bool{
	"node_modules": true,
	".git":         true,
	".quipu":       true,
	"build":        true,
	"dist":         true,
}

// GET /search?path=<workspace>&q=<query>&regex=false&caseSensitive=false
func handleSearch(w http.ResponseWriter, r *http.Request) {
	dirPath := r.URL.Query().Get("path")
	query := r.URL.Query().Get("q")
	regexStr := r.URL.Query().Get("regex")
	caseSensitiveStr := r.URL.Query().Get("caseSensitive")

	if dirPath == "" || query == "" {
		jsonError(w, "path and q parameters required", http.StatusBadRequest)
		return
	}

	absPath, err := filepath.Abs(dirPath)
	if err != nil {
		jsonError(w, "invalid path", http.StatusBadRequest)
		return
	}

	if !isWithinWorkspace(absPath) {
		jsonError(w, "path outside workspace", http.StatusForbidden)
		return
	}

	isRegex := regexStr == "true"
	isCaseSensitive := caseSensitiveStr == "true"

	const maxResults = 500

	// Try ripgrep first, fallback to grep
	results, truncated, err := searchWithRipgrep(absPath, query, isRegex, isCaseSensitive, maxResults)
	if err != nil {
		// Fallback to grep
		results, truncated, err = searchWithGrep(absPath, query, isRegex, isCaseSensitive, maxResults)
		if err != nil {
			jsonError(w, "search failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	jsonResponse(w, SearchResponse{
		Results:   results,
		Truncated: truncated,
	})
}

func searchWithRipgrep(dir, query string, isRegex, isCaseSensitive bool, maxResults int) ([]SearchResult, bool, error) {
	args := []string{
		"--no-heading",
		"--line-number",
		"--color", "never",
		"--max-count", strconv.Itoa(maxResults),
	}

	if !isCaseSensitive {
		args = append(args, "--ignore-case")
	}

	if !isRegex {
		args = append(args, "--fixed-strings")
	}

	// Exclude directories
	for d := range excludeDirs {
		args = append(args, "--glob", "!"+d)
	}

	args = append(args, query, dir)

	cmd := exec.Command("rg", args...)
	output, err := cmd.Output()
	if err != nil {
		// rg returns exit code 1 for no matches, which is not an error
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			return []SearchResult{}, false, nil
		}
		return nil, false, err
	}

	return parseSearchOutput(string(output), dir, maxResults)
}

func searchWithGrep(dir, query string, isRegex, isCaseSensitive bool, maxResults int) ([]SearchResult, bool, error) {
	args := []string{"-rn", "--color=never"}

	if !isCaseSensitive {
		args = append(args, "-i")
	}

	if !isRegex {
		args = append(args, "-F")
	}

	// Exclude directories
	for d := range excludeDirs {
		args = append(args, fmt.Sprintf("--exclude-dir=%s", d))
	}

	args = append(args, query, dir)

	cmd := exec.Command("grep", args...)
	output, err := cmd.Output()
	if err != nil {
		// grep returns exit code 1 for no matches
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			return []SearchResult{}, false, nil
		}
		return nil, false, err
	}

	return parseSearchOutput(string(output), dir, maxResults)
}

func parseSearchOutput(output, baseDir string, maxResults int) ([]SearchResult, bool, error) {
	var results []SearchResult
	truncated := false

	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		// Format: file:line:text
		// Find first colon (file path may contain colons on Windows, but we handle Unix-style)
		firstColon := strings.Index(line, ":")
		if firstColon < 0 {
			continue
		}
		rest := line[firstColon+1:]
		secondColon := strings.Index(rest, ":")
		if secondColon < 0 {
			continue
		}

		filePath := line[:firstColon]
		lineNumStr := rest[:secondColon]
		text := rest[secondColon+1:]

		lineNum, err := strconv.Atoi(lineNumStr)
		if err != nil {
			continue
		}

		// Make path relative to baseDir for cleaner output
		relPath, err := filepath.Rel(baseDir, filePath)
		if err != nil {
			relPath = filePath
		}

		results = append(results, SearchResult{
			File: relPath,
			Line: lineNum,
			Text: strings.TrimRight(text, "\r\n"),
		})

		if len(results) >= maxResults {
			truncated = true
			break
		}
	}

	if results == nil {
		results = []SearchResult{}
	}

	return results, truncated, nil
}

// GET /files-recursive?path=<workspace>&limit=5000
func handleFilesRecursive(w http.ResponseWriter, r *http.Request) {
	dirPath := r.URL.Query().Get("path")
	if dirPath == "" {
		jsonError(w, "path parameter required", http.StatusBadRequest)
		return
	}

	absPath, err := filepath.Abs(dirPath)
	if err != nil {
		jsonError(w, "invalid path", http.StatusBadRequest)
		return
	}

	if !isWithinWorkspace(absPath) {
		jsonError(w, "path outside workspace", http.StatusForbidden)
		return
	}

	limitStr := r.URL.Query().Get("limit")
	limit := 5000
	if limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	var files []FileListEntry
	truncated := false

	err = filepath.WalkDir(absPath, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // Skip entries with errors
		}

		// Skip excluded directories
		if d.IsDir() && excludeDirs[d.Name()] {
			return filepath.SkipDir
		}

		// Only include files, not directories
		if d.IsDir() {
			return nil
		}

		if len(files) >= limit {
			truncated = true
			return filepath.SkipAll
		}

		relPath, err := filepath.Rel(absPath, path)
		if err != nil {
			relPath = path
		}

		files = append(files, FileListEntry{
			Path: relPath,
			Name: d.Name(),
		})

		return nil
	})

	if err != nil {
		jsonError(w, "failed to list files: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if files == nil {
		files = []FileListEntry{}
	}

	jsonResponse(w, FilesRecursiveResponse{
		Files:     files,
		Truncated: truncated,
	})
}

// Git request types
type GitFilesRequest struct {
	Files []string `json:"files"`
}

type GitCommitRequest struct {
	Message string `json:"message"`
}

type GitCheckoutRequest struct {
	Branch string `json:"branch"`
}

// runGitCommand executes a git command in the workspace directory with a 30s timeout.
// Returns stdout and stderr strings. If the command fails, returns an error.
func runGitCommand(args ...string) (string, string, error) {
	if workspaceRoot == "" {
		return "", "", fmt.Errorf("no workspace open")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = workspaceRoot

	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	return stdout.String(), stderr.String(), err
}

// GET /git/status
func handleGitStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if workspaceRoot == "" {
		jsonError(w, "no workspace open", http.StatusBadRequest)
		return
	}

	stdout, stderr, err := runGitCommand("status", "--porcelain", "-z")
	if err != nil {
		// Check if it's not a git repo
		if strings.Contains(stderr, "not a git repository") {
			jsonError(w, "not a git repository", http.StatusBadRequest)
			return
		}
		jsonError(w, "git status failed: "+stderr, http.StatusInternalServerError)
		return
	}

	type FileStatus struct {
		Path   string `json:"path"`
		Status string `json:"status"`
	}

	staged := []FileStatus{}
	unstaged := []FileStatus{}
	untracked := []string{}

	// Parse NUL-separated output from git status --porcelain -z
	// Each entry: XY<space>path\0  (renamed entries: XY<space>old\0new\0)
	entries := strings.Split(stdout, "\x00")
	i := 0
	for i < len(entries) {
		entry := entries[i]
		if len(entry) < 3 {
			i++
			continue
		}

		x := entry[0]   // staged status
		y := entry[1]   // unstaged status
		path := entry[3:] // skip "XY "

		// Handle untracked files
		if x == '?' && y == '?' {
			untracked = append(untracked, path)
			i++
			continue
		}

		// Handle renames/copies - next entry is the new name
		if x == 'R' || x == 'C' {
			newPath := ""
			if i+1 < len(entries) {
				newPath = entries[i+1]
				i++ // skip the extra entry
			}
			staged = append(staged, FileStatus{Path: newPath, Status: string(x)})
		} else if x != ' ' && x != '?' {
			staged = append(staged, FileStatus{Path: path, Status: string(x)})
		}

		if y == 'R' || y == 'C' {
			newPath := ""
			if i+1 < len(entries) {
				newPath = entries[i+1]
				i++
			}
			unstaged = append(unstaged, FileStatus{Path: newPath, Status: string(y)})
		} else if y != ' ' && y != '?' {
			unstaged = append(unstaged, FileStatus{Path: path, Status: string(y)})
		}

		i++
	}

	jsonResponse(w, map[string]interface{}{
		"staged":    staged,
		"unstaged":  unstaged,
		"untracked": untracked,
	})
}

// GET /git/diff?file=<path>&staged=true/false
func handleGitDiff(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if workspaceRoot == "" {
		jsonError(w, "no workspace open", http.StatusBadRequest)
		return
	}

	file := r.URL.Query().Get("file")
	isStaged := r.URL.Query().Get("staged") == "true"

	args := []string{"diff"}
	if isStaged {
		args = append(args, "--cached")
	}
	if file != "" {
		// Validate file path is within workspace
		absFile := filepath.Join(workspaceRoot, file)
		if !isWithinWorkspace(absFile) {
			jsonError(w, "path outside workspace", http.StatusForbidden)
			return
		}
		args = append(args, "--", file)
	}

	stdout, stderr, err := runGitCommand(args...)
	if err != nil {
		jsonError(w, "git diff failed: "+stderr, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte(stdout))
}

// POST /git/stage  { files: [...] }
func handleGitStage(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if workspaceRoot == "" {
		jsonError(w, "no workspace open", http.StatusBadRequest)
		return
	}

	var req GitFilesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.Files) == 0 {
		jsonError(w, "no files specified", http.StatusBadRequest)
		return
	}

	// Validate all file paths
	for _, f := range req.Files {
		absFile := filepath.Join(workspaceRoot, f)
		if !isWithinWorkspace(absFile) {
			jsonError(w, "path outside workspace: "+f, http.StatusForbidden)
			return
		}
	}

	args := append([]string{"add"}, req.Files...)
	_, stderr, err := runGitCommand(args...)
	if err != nil {
		jsonError(w, "git add failed: "+stderr, http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]bool{"success": true})
}

// POST /git/unstage  { files: [...] }
func handleGitUnstage(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if workspaceRoot == "" {
		jsonError(w, "no workspace open", http.StatusBadRequest)
		return
	}

	var req GitFilesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.Files) == 0 {
		jsonError(w, "no files specified", http.StatusBadRequest)
		return
	}

	// Validate all file paths
	for _, f := range req.Files {
		absFile := filepath.Join(workspaceRoot, f)
		if !isWithinWorkspace(absFile) {
			jsonError(w, "path outside workspace: "+f, http.StatusForbidden)
			return
		}
	}

	args := append([]string{"reset", "HEAD", "--"}, req.Files...)
	_, stderr, err := runGitCommand(args...)
	if err != nil {
		jsonError(w, "git reset failed: "+stderr, http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]bool{"success": true})
}

// POST /git/commit  { message: "..." }
func handleGitCommit(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if workspaceRoot == "" {
		jsonError(w, "no workspace open", http.StatusBadRequest)
		return
	}

	var req GitCommitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Message == "" {
		jsonError(w, "commit message required", http.StatusBadRequest)
		return
	}

	stdout, stderr, err := runGitCommand("commit", "-m", req.Message)
	if err != nil {
		jsonError(w, "git commit failed: "+stderr, http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]string{"output": stdout})
}

// POST /git/push
func handleGitPush(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if workspaceRoot == "" {
		jsonError(w, "no workspace open", http.StatusBadRequest)
		return
	}

	stdout, stderr, err := runGitCommand("push")
	if err != nil {
		jsonError(w, "git push failed: "+stderr, http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]string{"output": stdout + stderr})
}

// POST /git/pull
func handleGitPull(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if workspaceRoot == "" {
		jsonError(w, "no workspace open", http.StatusBadRequest)
		return
	}

	stdout, stderr, err := runGitCommand("pull")
	if err != nil {
		jsonError(w, "git pull failed: "+stderr, http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]string{"output": stdout + stderr})
}

// GET /git/branches
func handleGitBranches(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if workspaceRoot == "" {
		jsonError(w, "no workspace open", http.StatusBadRequest)
		return
	}

	// Get current branch
	currentOut, stderr, err := runGitCommand("branch", "--show-current")
	if err != nil {
		jsonError(w, "git branch failed: "+stderr, http.StatusInternalServerError)
		return
	}
	current := strings.TrimSpace(currentOut)

	// Get all branches
	listOut, stderr, err := runGitCommand("branch", "--list")
	if err != nil {
		jsonError(w, "git branch --list failed: "+stderr, http.StatusInternalServerError)
		return
	}

	branches := []string{}
	for _, line := range strings.Split(listOut, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Remove the "* " prefix from current branch
		line = strings.TrimPrefix(line, "* ")
		branches = append(branches, line)
	}

	jsonResponse(w, map[string]interface{}{
		"branches": branches,
		"current":  current,
	})
}

// POST /git/checkout  { branch: "..." }
func handleGitCheckout(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if workspaceRoot == "" {
		jsonError(w, "no workspace open", http.StatusBadRequest)
		return
	}

	var req GitCheckoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Branch == "" {
		jsonError(w, "branch name required", http.StatusBadRequest)
		return
	}

	_, stderr, err := runGitCommand("checkout", req.Branch)
	if err != nil {
		jsonError(w, "git checkout failed: "+stderr, http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]bool{"success": true})
}

// GET /git/log
func handleGitLog(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if workspaceRoot == "" {
		jsonError(w, "no workspace open", http.StatusBadRequest)
		return
	}

	stdout, stderr, err := runGitCommand("log", "--oneline", "-20")
	if err != nil {
		// Empty repo with no commits
		if strings.Contains(stderr, "does not have any commits") || strings.Contains(stderr, "bad default revision") {
			jsonResponse(w, map[string]interface{}{"entries": []interface{}{}})
			return
		}
		jsonError(w, "git log failed: "+stderr, http.StatusInternalServerError)
		return
	}

	type LogEntry struct {
		Hash    string `json:"hash"`
		Message string `json:"message"`
	}

	entries := []LogEntry{}
	for _, line := range strings.Split(stdout, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Format: <hash> <message>
		spaceIdx := strings.Index(line, " ")
		if spaceIdx < 0 {
			entries = append(entries, LogEntry{Hash: line, Message: ""})
			continue
		}
		entries = append(entries, LogEntry{
			Hash:    line[:spaceIdx],
			Message: line[spaceIdx+1:],
		})
	}

	jsonResponse(w, map[string]interface{}{"entries": entries})
}

// handleWatch upgrades to a WebSocket and pushes file-change events by polling
// the watched directory. Each event is JSON: {"eventType":"change","filename":"..."}
func handleWatch(w http.ResponseWriter, r *http.Request) {
	dirPath := r.URL.Query().Get("path")
	if dirPath == "" {
		jsonError(w, "path parameter required", http.StatusBadRequest)
		return
	}

	absPath, err := filepath.Abs(dirPath)
	if err != nil {
		jsonError(w, "invalid path", http.StatusBadRequest)
		return
	}

	if workspaceRoot != "" && !isWithinWorkspace(absPath) {
		jsonError(w, "path outside workspace", http.StatusForbidden)
		return
	}

	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Print("watch upgrade:", err)
		return
	}
	defer c.Close()

	// Build initial snapshot of modification times
	snapshot := buildSnapshot(absPath)

	// Read from WebSocket to detect close
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := c.ReadMessage(); err != nil {
				return
			}
		}
	}()

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			newSnapshot := buildSnapshot(absPath)
			changes := diffSnapshots(snapshot, newSnapshot, absPath)
			snapshot = newSnapshot

			for _, change := range changes {
				msg, _ := json.Marshal(change)
				if err := c.WriteMessage(websocket.TextMessage, msg); err != nil {
					return
				}
			}
		}
	}
}

type fileSnapshot map[string]time.Time

type watchEvent struct {
	EventType string `json:"eventType"`
	Filename  string `json:"filename"`
}

func buildSnapshot(root string) fileSnapshot {
	snap := make(fileSnapshot)
	filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if excludeDirs[name] || hiddenDirs[name] {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		snap[path] = info.ModTime()
		return nil
	})
	return snap
}

func diffSnapshots(old, current fileSnapshot, root string) []watchEvent {
	var events []watchEvent

	// Check for modified or new files
	for path, modTime := range current {
		oldTime, exists := old[path]
		if !exists || !modTime.Equal(oldTime) {
			relPath, err := filepath.Rel(root, path)
			if err != nil {
				relPath = path
			}
			eventType := "change"
			if !exists {
				eventType = "rename"
			}
			events = append(events, watchEvent{
				EventType: eventType,
				Filename:  relPath,
			})
		}
	}

	// Check for deleted files
	for path := range old {
		if _, exists := current[path]; !exists {
			relPath, err := filepath.Rel(root, path)
			if err != nil {
				relPath = path
			}
			events = append(events, watchEvent{
				EventType: "rename",
				Filename:  relPath,
			})
		}
	}

	return events
}

// GET /file/stat?path=<file> — returns mtime for polling-based change detection
func handleFileStat(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		jsonError(w, "path parameter required", http.StatusBadRequest)
		return
	}

	absPath, err := filepath.Abs(filePath)
	if err != nil {
		jsonError(w, "invalid path", http.StatusBadRequest)
		return
	}

	if !isWithinWorkspace(absPath) {
		jsonError(w, "path outside workspace", http.StatusForbidden)
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			jsonError(w, "file not found", http.StatusNotFound)
			return
		}
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]interface{}{
		"mtime": info.ModTime().UnixMilli(),
		"size":  info.Size(),
	})
}

func main() {
	var addr = flag.String("addr", "localhost:3000", "http service address")
	var workspace = flag.String("workspace", "", "workspace root directory (auto-detected from first /files request if not set)")
	flag.Parse()
	log.SetFlags(0)

	if *workspace != "" {
		abs, err := filepath.Abs(*workspace)
		if err != nil {
			log.Fatalf("Invalid workspace path: %v", err)
		}
		workspaceRoot = abs
		workspaceExplicit = true
		log.Printf("Workspace root set to: %s (sandboxed)", workspaceRoot)
	}

	// File system endpoints
	http.HandleFunc("/files", corsMiddleware(handleListFiles))
	http.HandleFunc("/file", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			handleReadFile(w, r)
		case "POST":
			handleWriteFile(w, r)
		case "DELETE":
			handleDeleteFile(w, r)
		default:
			jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}))
	http.HandleFunc("/folder", corsMiddleware(handleCreateFolder))
	http.HandleFunc("/rename", corsMiddleware(handleRename))
	http.HandleFunc("/upload", corsMiddleware(handleUploadImage))
	http.HandleFunc("/homedir", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		home, err := os.UserHomeDir()
		if err != nil {
			home = "/"
		}
		jsonResponse(w, map[string]string{"path": home})
	}))

	// Search endpoints
	http.HandleFunc("/search", corsMiddleware(handleSearch))
	http.HandleFunc("/files-recursive", corsMiddleware(handleFilesRecursive))

	// Git endpoints
	http.HandleFunc("/git/status", corsMiddleware(handleGitStatus))
	http.HandleFunc("/git/diff", corsMiddleware(handleGitDiff))
	http.HandleFunc("/git/stage", corsMiddleware(handleGitStage))
	http.HandleFunc("/git/unstage", corsMiddleware(handleGitUnstage))
	http.HandleFunc("/git/commit", corsMiddleware(handleGitCommit))
	http.HandleFunc("/git/push", corsMiddleware(handleGitPush))
	http.HandleFunc("/git/pull", corsMiddleware(handleGitPull))
	http.HandleFunc("/git/branches", corsMiddleware(handleGitBranches))
	http.HandleFunc("/git/checkout", corsMiddleware(handleGitCheckout))
	http.HandleFunc("/git/log", corsMiddleware(handleGitLog))

	// File watch endpoint (WebSocket) — corsMiddleware for preflight, upgrader for WS origin
	http.HandleFunc("/watch", corsMiddleware(handleWatch))

	// File stat endpoint (for browser polling — returns mtime)
	http.HandleFunc("/file/stat", corsMiddleware(handleFileStat))

	// Terminal endpoint — corsMiddleware for preflight, upgrader for WS origin
	http.HandleFunc("/term", corsMiddleware(handleTerminal))

	// Health check endpoint (used by thin Electron shell to wait for server readiness)
	http.HandleFunc("/health", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))

	if !workspaceExplicit {
		log.Printf("No -workspace flag: path sandboxing disabled (any path allowed)")
	}
	log.Printf("Listening on %s (GOOS=%s)", *addr, runtime.GOOS)
	log.Fatal(http.ListenAndServe(*addr, nil))
}
