---
session_number: 4
session_title: Linux processes and signals
topic: linux
---

## What a process actually is

A process is a running program with its own memory, its own file descriptors, and a
number called a PID. Every process except the first one has a parent. When you run a
command in a shell, the shell forks itself and the copy becomes your command, so the
shell is the parent.

`ps aux` lists processes. `ps -ef --forest` draws the parent-child tree, which is far
more useful when you are trying to work out who started what.

## PID 1 is special

The first process the kernel starts gets PID 1. On a normal Linux machine that is an
init system such as systemd. PID 1 has two jobs beyond running: it adopts orphaned
processes, and it reaps them when they exit so they do not linger as zombies.

PID 1 also has one behaviour that surprises almost everybody: **the kernel does not
give it default signal handlers.** For any other process, a signal it has not handled
falls back to a kernel default, and for SIGTERM that default is "die". PID 1 gets no
such default. If PID 1 has not explicitly installed a handler for SIGTERM, the signal
arrives and is simply ignored.

This matters enormously in containers, where your application usually is PID 1.

## Signals

A signal is a small asynchronous message sent to a process. The ones worth knowing:

- `SIGTERM` (15) — please shut down. Can be caught, handled, and cleaned up after.
  This is what `kill` sends by default, and what `docker stop` sends first.
- `SIGKILL` (9) — stop existing, right now. Cannot be caught, blocked, or handled.
  The kernel removes the process. No cleanup runs.
- `SIGINT` (2) — what Ctrl-C sends.
- `SIGHUP` (1) — historically "the terminal went away". Many daemons repurpose it to
  mean "reload your configuration".

Send them with `kill -TERM <pid>` or `kill -9 <pid>`. The number and the name are
interchangeable.

## Why SIGTERM then SIGKILL is the standard pattern

Shutdown almost everywhere follows the same shape. Send SIGTERM, wait a grace period,
then send SIGKILL if the process is still alive.

`docker stop` does exactly this, with a default grace period of ten seconds.
Kubernetes does the same and lets you set the wait with
`terminationGracePeriodSeconds`.

The grace period exists so the application can finish what it is doing: stop accepting
new work, finish requests already in flight, flush buffers, close database connections
cleanly. An application that ignores SIGTERM gets none of that. It is killed outright
after the grace period, mid-request, with no cleanup.

## Graceful shutdown in practice

A well-behaved server does roughly this on SIGTERM:

1. Stop accepting new connections
2. Let in-flight requests finish, up to some deadline
3. Close database connections and flush anything buffered
4. Exit with status 0

For an application that streams responses, this is the difference between a user's
answer completing and it stopping mid-sentence on every deployment.

## Exit codes

A process exits with a number. Zero means success; anything else means failure. Shell
scripts and CI pipelines branch on this, so returning a meaningful code matters.

`echo $?` prints the exit code of the last command.

By convention, a process killed by signal N exits with 128 + N. So a process killed by
SIGKILL (9) reports 137, and one killed by SIGTERM (15) reports 143. When a container
exits with code 137, that is the signature of it being force-killed — very often
because it ignored SIGTERM and ran out its grace period, or because it hit a memory
limit.

## Foreground, background, and the shell

`command &` runs something in the background. `jobs` lists background jobs, `fg` brings
one forward.

Worth knowing: when a shell runs a command, whether it stays as a parent or replaces
itself matters. `exec command` replaces the shell process entirely, so the command
inherits the shell's PID. Without `exec`, the shell stays alive as the parent and the
command is a child — and signals sent to the shell are not automatically passed on to
that child.

That single detail is the cause of a whole category of container shutdown bugs.
