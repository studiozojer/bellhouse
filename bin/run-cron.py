#!/usr/bin/env python3
"""Run one cron handler with a host-local lock and a process-group timeout."""
import argparse
import fcntl
import os
from pathlib import Path
import signal
import subprocess
import time


def run(lock_path, timeout, grace, command):
    path = Path(lock_path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(fd, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 75
        stopped = [None]
        def stop(sig, frame):
            if stopped[0] is None:
                stopped[0] = sig
        previous = {sig: signal.signal(sig, stop) for sig in (signal.SIGTERM, signal.SIGINT)}
        try:
            child = subprocess.Popen(command, start_new_session=True, pass_fds=(fd,))
            deadline = time.monotonic() + timeout
            while stopped[0] is None and time.monotonic() < deadline:
                try:
                    return child.wait(timeout=min(0.2, max(0.001, deadline-time.monotonic())))
                except subprocess.TimeoutExpired:
                    pass
            outcome = 128 + stopped[0] if stopped[0] is not None else 124
            def kill_group(sig):
                try:
                    os.killpg(child.pid, sig)
                except ProcessLookupError:
                    pass
                except PermissionError:
                    # macOS can deny a signal to a group containing only zombies.
                    # Verify that no live group member remains; do not mask a real
                    # permission failure involving a running descendant.
                    states = subprocess.run(['ps', '-axo', 'pgid=,stat='], capture_output=True, text=True, check=True)
                    members = [line.split() for line in states.stdout.splitlines() if line.split() and line.split()[0] == str(child.pid)]
                    if any(len(parts) < 2 or not parts[1].startswith('Z') for parts in members):
                        raise
            kill_group(signal.SIGTERM)
            deadline = time.monotonic() + grace
            # Keep the group leader unreaped during grace so its process-group
            # ID cannot be reused while descendants are being terminated.
            while time.monotonic() < deadline:
                time.sleep(min(0.05, max(0, deadline-time.monotonic())))
            kill_group(signal.SIGKILL)
            child.wait()
            return outcome
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)
    finally:
        os.close(fd)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lock', required=True)
    parser.add_argument('--timeout', type=float, required=True)
    parser.add_argument('--grace', type=float, default=10)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or not 0 < args.timeout <= 86400 or not 0 <= args.grace <= 60:
        parser.error('A bounded timeout and a command are required')
    try:
        raise SystemExit(run(args.lock, args.timeout, args.grace, command))
    except (OSError, ValueError):
        # Never print command arguments, environment, payloads or provider errors.
        raise SystemExit(125)
