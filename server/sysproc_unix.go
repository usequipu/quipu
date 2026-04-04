//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// setSysProcAttr configures the subprocess to run in its own process group
// so that killing it also kills any child processes it spawns (e.g. jupyter kernels).
func setSysProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killJupyterProcess kills the process group to ensure all child processes
// (kernel managers, kernels) are also terminated.
func killJupyterProcess(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	// Negative PID kills the entire process group
	syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	cmd.Wait()
}
