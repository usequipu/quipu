//go:build windows

package main

import (
	"io"
	"os"

	"github.com/UserExistsError/conpty"
)

// ptySession wraps a Windows ConPTY process.
type ptySession struct {
	cpty *conpty.ConPty
}

// startPTY spawns a shell in a ConPTY with the given working directory and size.
func startPTY(shell string, dir string, cols, rows uint16) (*ptySession, error) {
	opts := []conpty.ConPtyOption{
		conpty.ConPtyDimensions(int(cols), int(rows)),
		conpty.ConPtyEnv(os.Environ()),
	}

	if dir != "" {
		opts = append(opts, conpty.ConPtyWorkDir(dir))
	}

	cpty, err := conpty.Start(shell, opts...)
	if err != nil {
		return nil, err
	}

	return &ptySession{cpty: cpty}, nil
}

func (p *ptySession) Read(buf []byte) (int, error) {
	return p.cpty.Read(buf)
}

func (p *ptySession) Write(data []byte) (int, error) {
	return p.cpty.Write(data)
}

func (p *ptySession) Resize(cols, rows uint16) error {
	return p.cpty.Resize(int(cols), int(rows))
}

func (p *ptySession) Close() error {
	return p.cpty.Close()
}

var _ io.ReadWriteCloser = (*ptySession)(nil)
