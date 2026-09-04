# Frozen contract — v1.0.0

**Status:** FROZEN as of Phase 1. Do not change anything in this file.

Everything here becomes permanent the moment the first student clones this repository. Some
students will return eight months later to demo this project in a job interview, running
whatever version they cloned. A change here breaks their clone silently.

Additive changes that old clients can ignore are permitted (see [Change policy](#change-policy)).
Renames, removals, and meaning changes are not.

---

## 1. Retrieval endpoint

Exactly one public route exists on the NKS Retrieval Service. There is no second route, and
there will never be one.

### Request

```http
POST /v1/retrieve
Authorization: Bearer nks_live_<key>
X-Client-Version: 1.0.0
Content-Type: application/json

{
  "query": "string, max 500 characters",
  "top_k": 5,
  "session_range": [1, 40]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `query` | string | yes | Max 500 characters. Over that is `413`. |
| `top_k` | integer | no | Default 5. **Capped server-side at 5** regardless of what is sent. A larger value is not an error; it is silently clamped. |
| `session_range` | `[int, int]` \| null | no | Inclusive lower and upper session number. Omit or send `null` for the whole corpus. |

`session_range` is in this contract from day one even though the UI that uses it
(`FR-22`) is first in the cut order. Shipping without the UI is fine. Adding the field to a
frozen contract later is not.

### Response

```http
200 OK
Content-Type: application/json

{
  "chunks": [
    {
      "id": "string",
      "text": "string, max 800 characters",
      "session_number": 17,
      "session_title": "string",
      "score": 0.82
    }
  ],
  "request_id": "string",
  "kb_version": "string"
}
```

| Field | Type | Notes |
|---|---|---|
| `chunks` | array | Length 0 to 5. An empty array is a valid `200`, not an error — it means nothing cleared the relevance threshold. |
| `chunks[].text` | string | **Truncated to 800 characters** server-side. |
| `chunks[].score` | float | Fused relevance score. Ordering is by descending score. Absolute values are not comparable across `kb_version` changes. |
| `request_id` | string | Echo this in bug reports. |
| `kb_version` | string | Changes when the corpus is re-indexed. Clients may use it for cache invalidation. |

`kb_version` is in this contract from day one even though populating it meaningfully
(`FR-50`) is P1. Until then it is the literal string `"1"`.

### Guarantees

- `top_k` is clamped to 5 server-side. `FR-45`
- `text` is truncated to 800 characters server-side. `FR-46`
- Query embedding happens server-side. Clients never need a matching embedding model. `FR-48`
- The service returns `503` rather than hanging, so clients fail over quickly. `NFR-7`

---

## 2. Error codes

Every error response carries this shape:

```json
{
  "error": {
    "code": "invalid_key",
    "message": "human-readable, written for a student reading their terminal",
    "request_id": "string"
  }
}
```

| Status | `code` | Meaning |
|---|---|---|
| 400 | `invalid_request` | Malformed body |
| 401 | `invalid_key` | Key not recognised |
| 403 | `key_expired` | Past `expires_at` |
| 403 | `key_revoked` | Deliberately disabled |
| 413 | `query_too_long` | Over 500 characters |
| 426 | `client_too_old` | Below `MIN_CLIENT_VERSION` |
| 429 | `rate_limited` | Carries a `Retry-After` header |
| 503 | `service_unavailable` | Client should fall back to local mode |

`FR-68`: `message` is written for a student reading their terminal, not for a developer
reading a spec. "Your NKS key expired on 12 March, at the end of batch 2026-A. Ask your
instructor for a new one." — not "key_expired".

The `code` field is the stable identifier. Client code branches on `code`, never on `message`,
and `message` wording may change at any time.

---

## 3. API key format

```
nks_live_<32 bytes, base62>
```

- Displayed **exactly once**, at creation. Stored hashed. `FR-55`
- No interface can ever redisplay a key. A student who loses theirs gets a
  revoke-and-reissue, not a lookup.
- Keys hard-expire at batch end. No grace period. `FR-53`
- Revocation takes effect within 60 seconds. `FR-54`

> The PRD writes this prefix as `ncs_live_`, from the same "Next Code School" error that runs
> through that document. The institute is **Next Kode School**, so the prefix is `nks_live_`.
> This was corrected before the freeze. It cannot be corrected after one.

---

## 4. Client version policy

Clients send `X-Client-Version`. The service rejects anything below `MIN_CLIENT_VERSION`
with `426 client_too_old`.

**`MIN_CLIENT_VERSION` will not be raised except to mitigate a security problem.**

That is the whole policy, and it is stated here so the `426` code has a meaning. Raising the
floor bricks every clone below it, including the ones sitting in students' portfolios. A
feature is never a good enough reason. If a security problem does force it, the `message`
tells the student exactly which line of their `.env` or which git tag to move to.

`MIN_CLIENT_VERSION` is `1.0.0` at launch.

---

## 5. Environment variable names

Renaming any of these breaks every existing clone. Names only — defaults and semantics live
in `.env.example` and the README.

```
KB_MODE                 local | hosted
KB_API_URL
KB_API_KEY
LLM_BASE_URL
LLM_API_KEY
LLM_MODEL
EMBEDDING_BASE_URL      local mode only; defaults to LLM_BASE_URL
EMBEDDING_MODEL         local mode only; defaults to nomic-embed-text
DATABASE_URL
SESSION_SECRET
APP_ENV                 development | production
LOG_LEVEL
```

These names are brand-neutral, so the NKS/NCS correction above does not touch them.

---

## 6. What does not exist, and will never exist

This section is as binding as the ones above. Each of these will look harmless and convenient
at some point during development, and must still be refused.

| Never exists | Why |
|---|---|
| Any endpoint that lists, dumps, enumerates, or paginates the corpus | `FR-49`. A permanent architectural commitment, not a v1 limitation. Together with the `top_k` cap, the 800-character truncation, and per-key rate limits, it is what makes systematic reconstruction of the notes economically unattractive. |
| A generation endpoint on NKS infrastructure | `NFR-10`. NKS retrieves; the student's own LLM generates. Adding one means NKS either pays for inference (killing G3) or proxies student credentials (creating liability). |
| Any admin route on the retrieval service | §13. Key issuance is a CLI writing to DynamoDB with the operator's own IAM credentials. Nothing to discover, nothing to brute-force, nothing to leave unauthenticated. |
| A `role` or permission field anywhere in the student app | `FR-15`. The student owns the database. RBAC there is theatre. |

A test asserts the deployed route table contains exactly one path.

---

## Change policy

**Permitted** without a version bump, because an old client ignores them:

- New optional fields in the **response**
- New optional fields in the **request** that default to current behaviour
- New `error.code` values under existing HTTP statuses
- Any change to `message` wording

**Forbidden**, at any version:

- Renaming or removing any field
- Changing a field's type or its meaning
- Making an optional request field required
- Tightening `top_k`, the 800-character truncation, or the 500-character query limit in a way
  that turns a previously valid request into an error
- Raising `MIN_CLIENT_VERSION` for anything but a security fix

If something genuinely cannot be expressed under those rules, it is a new path — `/v2/retrieve`
— running alongside `/v1/retrieve`, which keeps serving. It is not an edit to this file.
