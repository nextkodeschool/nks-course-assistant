---
session_number: 18
session_title: Docker images, layers and build caching
topic: docker
---

## An image is a stack of layers

A Docker image is not one blob. It is an ordered stack of read-only layers, each one
the filesystem changes made by a single instruction in the Dockerfile. `RUN`, `COPY`
and `ADD` each create a layer. `ENV`, `WORKDIR`, `EXPOSE` and `CMD` only change
metadata and add nothing.

When you start a container, Docker adds one thin writable layer on top. Everything the
running container writes goes there, and that layer is destroyed when the container is
removed. This is exactly why databases keep their data in a volume instead.

`docker history <image>` shows the layers and what each one cost.

## The build cache, and why instruction order matters

Docker caches layers. On a rebuild it walks the instructions in order and reuses a
cached layer as long as the instruction and its inputs have not changed. **The moment
one layer misses the cache, every layer after it is rebuilt**, whether or not it needed
to be.

That single rule dictates how you order a Dockerfile: things that rarely change go
first, things that change constantly go last.

The classic mistake:

```dockerfile
COPY . .
RUN pip install -r requirements.txt
```

Your source code changes on every commit, so `COPY . .` misses the cache every time,
so the install below it reruns every time. Every build reinstalls every dependency.

The fix is to copy the dependency manifest on its own, install, and only then copy the
source:

```dockerfile
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
```

Now editing your code only invalidates the last layer. The install is reused. Builds
drop from minutes to seconds.

## Layers are additive — deleting does not shrink

A file added in one layer and deleted in a later one is still in the image. The later
layer only records the deletion; the bytes remain in the earlier layer, and anyone with
the image can recover them.

```dockerfile
RUN apt-get update && apt-get install -y build-essential
RUN rm -rf /var/lib/apt/lists/*
```

That does not save anything. Both operations must be in the same `RUN`, so the files
never get committed to a layer at all:

```dockerfile
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*
```

The security consequence is the important one: **a secret copied into an image and then
deleted is still in the image.** Deleting it in a later layer hides it from `ls` and
from nothing else.

## Multi-stage builds

The build-time toolchain is usually far bigger than the runtime needs. Compilers,
headers, dev packages, npm's entire `node_modules` — all needed to build, none needed
to run.

A multi-stage build compiles in one stage and copies only the result into a clean final
stage:

```dockerfile
FROM node:20 AS build
WORKDIR /src
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /src/dist /usr/share/nginx/html
```

The final image contains nginx and the built files. Node, npm and `node_modules` never
reach it. This routinely turns a 1.2GB image into 40MB.

Smaller images are not only about disk. They pull faster, which means faster
deployments and faster autoscaling, and they carry fewer packages, which means a
smaller surface for vulnerability scanners to find things in.

## Do not run as root

By default a container process runs as root. If someone escapes the process, they are
root inside the container, and that is a much better starting position than it should
be.

```dockerfile
RUN useradd --create-home --uid 10001 appuser
USER appuser
```

Put `USER` after everything that needs to install packages, and make sure the files
your app reads are readable by that user.

## exec form versus shell form

This is the single most consequential detail in the whole Dockerfile.

```dockerfile
CMD python app.py            # shell form
CMD ["python", "app.py"]     # exec form
```

Shell form runs your command as `/bin/sh -c "python app.py"`. So `sh` becomes PID 1 and
your application is its child. When the container is stopped, SIGTERM goes to `sh` —
which does not forward it — and your application never hears about it. Ten seconds
later everything is SIGKILLed, and the container exits 137.

Exec form runs your command directly, so your application is PID 1 and receives SIGTERM
itself. Combined with an application that actually handles it, you get clean shutdown.

If you need an entrypoint script, end it with `exec "$@"`. That replaces the shell with
your command rather than leaving the shell sitting there as a parent that swallows
signals.

## .dockerignore

The build context — everything in the directory — is sent to the daemon before the
build starts. Without a `.dockerignore`, that includes `.git`, `node_modules`, local
virtualenvs, and any `.env` you happen to have.

That is both slow and dangerous: `COPY . .` will happily copy your `.env` into the
image. Treat `.dockerignore` as a security control, not tidiness.
