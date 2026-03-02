//go:build !windows

package main

import (
	"io"
	"os"
	"os/exec"

	"github.com/creack/pty"
)

// ptySession wraps a Unix PTY process.
type ptySession struct {
	ptmx *os.File
}

// startPTY spawns a shell in a PTY with the given working directory and size.
func startPTY(shell string, dir string, cols, rows uint16) (*ptySession, error) {
	cmd := exec.Command(shell)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	if dir != "" {
		cmd.Dir = dir
	}

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: rows, Cols: cols})
	if err != nil {
		return nil, err
	}

	return &ptySession{ptmx: ptmx}, nil
}

func (p *ptySession) Read(buf []byte) (int, error) {
	return p.ptmx.Read(buf)
}

func (p *ptySession) Write(data []byte) (int, error) {
	return p.ptmx.Write(data)
}

func (p *ptySession) Resize(cols, rows uint16) error {
	return pty.Setsize(p.ptmx, &pty.Winsize{Rows: rows, Cols: cols})
}

func (p *ptySession) Close() error {
	return p.ptmx.Close()
}

var _ io.ReadWriteCloser = (*ptySession)(nil)
