---
session_number: 31
session_title: Kubernetes health probes and rollout ordering
topic: kubernetes
---

## Three probes, three different questions

Kubernetes offers three probes, and they are not interchangeable. Each answers a
different question, and each has a different consequence when it fails.

- **Liveness** — "is this process broken and in need of a restart?"
  On failure, the kubelet **kills the container** and restarts it.
- **Readiness** — "should traffic be sent to this pod right now?"
  On failure, the pod is **removed from the Service endpoints**. It keeps running.
- **Startup** — "has this slow-starting application finished booting yet?"
  While it is failing, liveness and readiness are suspended.

Getting liveness and readiness the wrong way round is the most common and most damaging
probe mistake in Kubernetes.

## Liveness should check almost nothing

A liveness probe should answer whether the process itself is wedged. That is it.

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 8000
  periodSeconds: 10
  failureThreshold: 3
```

`/healthz` should return 200 without touching the database, the cache, or any other
service.

The reason is blunt: **restarting your container does not fix someone else's database.**
If liveness checks the database and the database has a blip, Kubernetes restarts every
pod you have. The database is still down, so the restarted pods fail too, and you enter
a crash loop that adds a thundering herd of reconnections to an already struggling
database. You have converted a small dependency problem into a full outage of your own
making.

## Readiness should check what you need to serve

Readiness checks the dependencies you genuinely cannot serve a request without.

```yaml
readinessProbe:
  httpGet:
    path: /readyz
    port: 8000
  periodSeconds: 5
  failureThreshold: 2
```

For a typical application, that means the database and nothing else.

The intuitive readiness probe checks everything the application talks to. It is wrong,
and the failure mode is worth understanding properly.

Say your app also calls a third-party API, and `/readyz` checks it. That API goes down.
Every one of your pods reports not-ready. Kubernetes removes every pod from the Service.
Now there are no endpoints, so **all** traffic fails — including every request that had
nothing to do with that API and would have been served perfectly well.

An external dependency being down took your entire service offline, when it should have
degraded to serving everything else normally.

The rule: readiness answers "can I serve traffic?", not "is everything healthy?" If you
can still serve most requests, you are ready. Handle the broken dependency inside the
request that needs it, and return a sensible error for that request only.

## Startup probes exist for slow starts

Some applications take a long time to boot — a JVM loading a large heap, a service
warming a cache. A liveness probe with a short threshold will kill them mid-boot, over
and over.

```yaml
startupProbe:
  httpGet:
    path: /healthz
    port: 8000
  failureThreshold: 30
  periodSeconds: 5
```

That grants 150 seconds to start. Liveness only begins once the startup probe passes,
so you can keep liveness aggressive without punishing a slow boot.

## Rolling updates and terminationGracePeriodSeconds

A rolling update starts new pods, waits for them to become ready, then terminates old
ones. When a pod is terminated, two things happen at once:

1. It is removed from the Service endpoints
2. Its containers are sent SIGTERM

Then Kubernetes waits `terminationGracePeriodSeconds` (default 30) and SIGKILLs
anything still alive.

Two consequences that catch people out.

**Your app must handle SIGTERM.** If it is PID 1 and has no handler, the signal is
ignored, and it is force-killed after the grace period — cutting off every in-flight
request. For an application that streams responses, users see answers stop mid-sentence
on every deploy.

**Endpoint removal is not instant.** It propagates to kube-proxy and to ingress
controllers asynchronously, so requests can still arrive for a second or two after
SIGTERM. A `preStop` hook that simply sleeps covers the gap:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["sleep", "5"]
```

The pod stops receiving new traffic, sleeps while the endpoint removal propagates, and
only then gets SIGTERM. Set `terminationGracePeriodSeconds` comfortably above the sleep
plus your longest request.

## Migrations and rollout ordering

If your application runs database migrations at startup, a rolling update runs them from
several pods simultaneously, in an order nobody chose.

Run migrations as a separate step instead — a Kubernetes `Job`, or an init container, or
a pre-deploy task — and make it complete before the new pods roll out.

This forces the question that matters: is this migration safe for the old code that is
still running? During a rollout both versions are live at once. Adding a nullable column
is safe. Renaming or dropping one is not — it breaks every old pod instantly. The safe
pattern is expand, migrate, contract: add the new thing, move the code across, remove the
old thing in a later deploy.
