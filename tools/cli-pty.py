#!/usr/bin/env python3
"""Drive a CLI in a real pseudo-terminal, send keystrokes on a timeline, and capture the raw output.

Used by the Night Code verification skill (.opencode/skills/verify-nightcode) and the Phase 9 demo
recorder: the app under test is the real artifact, running the real renderer against a real TTY.

Keystroke escapes in the script: \\r return, \\n newline, \\t tab, \\e escape, \\b backspace,
\\x1b[A up, \\x1b[B down, \\x1b[C right, \\x1b[D left.
"""
import argparse
import fcntl
import json
import os
import pty
import select
import signal
import struct
import termios
import time


def ensure_parent(path):
    parent = os.path.dirname(os.path.abspath(path))
    if parent and not os.path.isdir(parent):
        os.makedirs(parent)


def run(cmd, script, cols=110, rows=32, cast=None, raw=None, idle_after=2.0, timeout=90.0):
    # A ctrl+c byte written into the pty raises SIGINT in the foreground process group. The driver must
    # not join that group, or proving an interrupt kills the driver instead of the child.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    pid, fd = pty.fork()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        os.environ["COLUMNS"] = str(cols)
        os.environ["LINES"] = str(rows)
        os.environ["COLORTERM"] = "truecolor"
        try:
            os.execvp("/bin/sh", ["/bin/sh", "-c", cmd])
        finally:
            os._exit(127)

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    chunks = []
    start = time.time()
    pending = list(script)
    next_at = start
    last_output = start

    while True:
        now = time.time()
        if pending and now >= next_at:
            delay, keys = pending.pop(0)
            if keys:
                os.write(fd, keys.encode() if isinstance(keys, str) else keys)
            next_at = time.time() + delay if delay else 0
        window = 0.2 if pending else idle_after
        ready, _, _ = select.select([fd], [], [], window)
        if ready:
            try:
                data = os.read(fd, 65536)
            except OSError:
                data = b""
            if data:
                chunks.append((time.time() - start, data.decode("utf-8", "replace")))
                last_output = time.time()
                continue
        if not pending and (time.time() - last_output) >= idle_after:
            break
        if time.time() - start > timeout:
            break

    try:
        os.close(fd)
    except OSError:
        pass
    # Reap the child and report how it ended: an exit code, or a signal the kernel delivered.
    status = None
    deadline = time.time() + 5
    while time.time() < deadline:
        waited, raw_status = os.waitpid(pid, os.WNOHANG)
        if waited:
            status = raw_status
            break
        time.sleep(0.05)

    if raw:
        ensure_parent(raw)
        with open(raw, "w") as handle:
            for _, chunk in chunks:
                handle.write(chunk)
    if cast:
        ensure_parent(cast)
        with open(cast, "w") as handle:
            handle.write(
                json.dumps(
                    {
                        "version": 2,
                        "width": cols,
                        "height": rows,
                        "timestamp": int(start),
                        "env": {"TERM": "xterm-256color", "SHELL": "/bin/sh"},
                    }
                )
                + "\n"
            )
            for at, chunk in chunks:
                handle.write(json.dumps([round(at, 3), "o", chunk]) + "\n")
    if status is None:
        exit_report = "never-reaped"
    elif os.WIFSIGNALED(status):
        exit_report = f"signaled signo={os.WTERMSIG(status)}"
    else:
        exit_report = f"code={os.WEXITSTATUS(status)}"

    return chunks, exit_report


def parse_script(spec):
    script = []
    if not spec:
        return script
    for part in spec.split(";"):
        delay, _, keys = part.partition(":")
        keys = (
            keys.replace("\\r", "\r")
            .replace("\\n", "\n")
            .replace("\\t", "\t")
            .replace("\\e", "\x1b")
            .replace("\\b", "\x7f")
        )
        script.append((float(delay), keys))
    return script


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cmd", required=True, help="shell command to run in the pty")
    parser.add_argument("--script", default="", help="delay:KEYS pairs separated by ;")
    parser.add_argument("--cast", help="write an asciinema v2 cast here")
    parser.add_argument("--raw", help="write the raw terminal bytes here")
    parser.add_argument("--cols", type=int, default=110)
    parser.add_argument("--rows", type=int, default=32)
    parser.add_argument("--idle-after", type=float, default=2.0)
    parser.add_argument("--expect", help="fail unless the raw output contains this text")
    args = parser.parse_args()

    chunks, exit_report = run(
        args.cmd,
        parse_script(args.script),
        cols=args.cols,
        rows=args.rows,
        cast=args.cast,
        raw=args.raw,
        idle_after=args.idle_after,
    )
    text = "".join(chunk for _, chunk in chunks)
    print(f"captured {len(chunks)} chunks, {len(text)} bytes, app exit {exit_report}")
    if args.expect:
        if args.expect in text:
            print(f"expect-ok: found {args.expect!r}")
        else:
            print(f"expect-missing: {args.expect!r} not found in output")
            raise SystemExit(1)


if __name__ == "__main__":
    main()
