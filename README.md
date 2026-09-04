# Kora

**Ask your course notes.**

A question-answering assistant over the Next Kode School course notes — and the application you
will clone, configure, and deploy yourself, end to end, across the DevOps curriculum.

Ask a normal question and Kora answers from the session notes, naming the session it drew on so
you can go and read the original. If a topic was never covered in class, it says so rather than
inventing an answer.

You will run it locally under Docker Compose, then on a VM with Ansible, then on ECS Fargate,
then on Kubernetes with Helm. Same application every time. The point is that the application is
deliberately non-trivial: it has a database, an external dependency that can fail, streaming
responses, and state worth preserving. Those are what make connection pooling, secret injection,
ephemeral filesystems, readiness probes, and rollout ordering mean something.

---

> ## Status
>
> **The app works.** Sign in, ask a question, get an answer streamed back with its sources, and
> your history survives the containers being destroyed and rebuilt. Run the Quickstart below.
>
> Two things are not finished. The three bundled notes in `seed/` are **samples, not the real
> course notes** — they were written from curriculum material so the app is useful out of the
> box. And `KB_MODE=hosted` has a working client but nothing on the other end yet, so everything
> currently runs in local mode.
>
> Still to come: production containers, CI, Terraform, Ansible, ECS and Kubernetes. The
> application does not change; only where it runs does.

---

## Execution model

**This codebase is fully async.** `async def` endpoints, SQLAlchemy 2.0 async, `asyncpg`.

This is stated here because it is a rule you have to follow, not a detail. The most common
FastAPI mistake is calling a synchronous database driver inside an `async def` endpoint, which
blocks the event loop for every other request in the process. With SSE streaming and a slow LLM
call in the same request, that degrades badly under even light load. FastAPI supports both models
well; mixing them is the trap.

So, in this repository:

- Every route handler is `async def`.
- Every database call is awaited through the async session.
- **Anything CPU-bound or blocking goes through `anyio.to_thread.run_sync`.** Choosing async
  does not make everything safe to `await`. `argon2id` password hashing is the live example —
  it is deliberately expensive, around 100ms, and calling it directly in a handler stalls the
  event loop for every concurrent user.

If you fork this and add a library that only has a blocking client, that call goes in a thread.

## Quickstart

Three commands, under fifteen minutes:

```bash
git clone <this-repo> && cd kora
```

```bash
cp .env.example .env
```

```bash
docker compose up
```

The app comes up at http://localhost:8080. First run creates the database schema and indexes the
bundled sample notes automatically.

Before the first run, generate a session secret — the app refuses to start while `SESSION_SECRET`
is still the placeholder:

```bash
openssl rand -hex 32
```

Paste the result into `SESSION_SECRET` in your `.env`.

### Prerequisites

Docker with Compose v2, and about 2GB of free RAM for the three containers. `scripts/check-prereqs.sh`
will verify this and tell you what is missing.

## Choosing an LLM

The app talks to anything that speaks the OpenAI-compatible protocol. You supply the credentials;
they never leave your own machine and are never sent to NKS.

### Ollama — the default, free, no card required

This is the documented path and what `.env.example` is configured for. Nothing to sign up for,
no billing, works offline.

```bash
ollama pull llama3.1:8b
ollama pull nomic-embed-text
```

`nomic-embed-text` is the second model — it is what indexes the notes for local knowledge-base
mode. You need both.

```dotenv
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=llama3.1:8b
```

### Groq — optional, much faster

If you want faster responses and are willing to create an account, Groq's free tier is generous.

```dotenv
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=gsk_...
LLM_MODEL=llama-3.1-8b-instant
```

> **Groq and Grok are different products.** Groq (`api.groq.com`) is an inference provider that
> runs open models very fast. Grok is xAI's own model, a different company and a different API.
> You want **Groq**. Searching for the other one will waste your afternoon.

Anything else OpenAI-compatible works too — OpenAI, Together, OpenRouter, llama.cpp's server.
Set the three `LLM_*` variables and it should just work.

## Knowledge base modes

`KB_MODE` switches where the course notes come from. One variable, no code change.

| `KB_MODE` | Source | Needs |
|---|---|---|
| `local` (default) | Three sample sessions bundled in `seed/knowledge-base-sample/`, embedded locally with Ollama into pgvector | Nothing. No internet, no NKS key. |
| `hosted` | The full 44-session corpus, via the NKS Retrieval Service | An NKS API key, issued by your instructor |

Local mode is the default so the app works the moment you clone it. It is also your fallback: if
the NKS service is down during a session, switch to `local` and keep working.

Your NKS key is issued per student per batch and **hard-expires at the end of the batch**. There
is no grace period and no self-serve signup.

## Configuration

All configuration is environment variables. No config file, no hardcoded values, nothing baked
into the images.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `KB_MODE` | yes | `local` | `local` or `hosted` |
| `KB_API_URL` | if hosted | — | NKS retrieval endpoint |
| `KB_API_KEY` | if hosted | — | Per student per batch; hard-expires |
| `LLM_BASE_URL` | yes | `http://localhost:11434/v1` | Ollama by default |
| `LLM_API_KEY` | provider-dependent | — | Not needed for local Ollama |
| `LLM_MODEL` | yes | — | e.g. `llama3.1:8b` |
| `EMBEDDING_BASE_URL` | no | same as `LLM_BASE_URL` | Local mode only |
| `EMBEDDING_MODEL` | no | `nomic-embed-text` | Local mode only |
| `DATABASE_URL` | yes | — | Postgres, `postgresql+asyncpg://` scheme |
| `SESSION_SECRET` | yes | — | App refuses to boot on the placeholder |
| `APP_ENV` | no | `development` | `development` or `production` |
| `LOG_LEVEL` | no | `info` | |

These names are frozen. See [`CONTRACT.md`](CONTRACT.md#5-environment-variable-names).

**Never commit your `.env`.** It is in `.gitignore` for a reason, and a meaningful number of
students push one anyway every batch. If you do, tell your instructor immediately — the key gets
revoked and reissued, and nobody is annoyed with you. Quietly leaving it there is the only wrong
move.

## Layout

```
apps/api/                FastAPI service
apps/web/                React + Vite SPA, served by nginx
infra/                   Terraform — modules and per-environment roots
ansible/                 VM provisioning and deployment
charts/                  Helm chart
scripts/                 check-prereqs.sh, entrypoint.sh, migrate.sh
.github/workflows/       CI
assignments/             Jenkins and Azure DevOps porting briefs
seed/                    Sample notes for KB_MODE=local
CONTRACT.md              Frozen interface. Read before changing anything shared.
```

## A note on the auth code

The app has email/password login with server-side sessions. **It protects nothing** — you own the
database, so you can grant yourself anything with a single `UPDATE`. It exists to teach session
state, secret injection, and persistence across restarts.

There is deliberately no role or permission model, no password reset, no email verification, and
no OAuth. Those are not omissions to fix later. Role-based access control inside an application
the user owns and runs would look like security and provide none.

The parts that *are* real — argon2id hashing, server-side session revocation, cookie flags — are
the parts worth reading closely, because that is the code most likely to end up copied into
something that does matter.

## Licence

Two different things with two different rights, deliberately separated:

- **The code** is MIT. Fork it, put it in your portfolio, show it to employers, build on it.
- **The course notes** are not. See [`NOTICE.md`](NOTICE.md).

The sample notes in `seed/` are included so the app works out of the box. They are course content,
not code, and the same restriction applies to them.
