//go:build windows

package main

import (
	"os/exec"
)

// setSysProcAttr is a no-op on Windows; process isolation is handled differently.
func setSysProcAttr(cmd *exec.Cmd) {}

// killJupyterProcess kills the jupyter process on Windows.
func killJupyterProcess(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	cmd.Process.Kill()
	cmd.Wait()
}
