# Build context is the repository root, not this directory, so that the shared
# scripts/ folder is reachable. See docker-compose.yml:
#
#     build:
#       context: .
#       dockerfile: apps/api/Dockerfile
#
# A Dockerfile can only COPY from inside its build context. "../scripts" does
# not work and is one of the more confusing errors Docker produces.

FROM python:3.12-slim

WORKDIR /app

# postgresql-client provides pg_isready, which the entrypoint uses to wait for
# the database before starting the app.
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Requirements are copied before the source. Docker caches each layer, so as
# long as requirements.txt has not changed, editing your Python code does not
# reinstall every dependency. Copy the code first and every rebuild takes
# minutes instead of seconds.
COPY apps/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/api/ .
# The bundled sample notes, indexed on first run when KB_MODE=local.
COPY seed/ ./seed/

COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# 0.0.0.0, not 127.0.0.1. Inside a container, 127.0.0.1 means "this container
# only" -- the port mapping would connect to nothing and you would spend an
# hour wondering why.
CMD uvicorn app.main:app --host 0.0.0.0 --port 8000
