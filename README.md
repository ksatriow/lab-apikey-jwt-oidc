# Authentication POC Lab — API Key, JWT & OIDC

Three auth mechanisms. One repo. The goal here is pretty straightforward: get a working, runnable example of API Key, JWT, and OIDC side by side so you can actually see how each one behaves rather than just reading about them.

Each folder is self-contained — you can run any of them independently without touching the others. Docker Compose is there if you want everything up at once.

---

## Project Layout

```
lab-apikey-jwt-oidc/
│
├── apikey/                  # API Key POC (port 3001)
│   ├── server.js            #   Express server with key validation middleware
│   ├── keys.js              #   In-memory key store (swap for DB/Redis in prod)
│   ├── Dockerfile
│   └── README.md
│
├── jwt/                     # JWT POC (port 3002)
│   ├── server.js            #   Login, sign, verify — the full flow
│   ├── Dockerfile
│   └── README.md
│
├── oidc/                    # OIDC POC (port 3003 + 4000)
│   ├── mock-idp.js          #   A real OIDC-compliant IdP running locally
│   ├── server.js            #   The app (Relying Party) that talks to the IdP
│   ├── Dockerfile.idp
│   ├── Dockerfile.app
│   └── README.md
│
├── docker-compose.yml
└── README.md
```

---

## Running It

### Docker Compose — easiest option

```bash
# Build and start everything
docker compose up --build

# Run in the background
docker compose up --build -d

# Tear it all down
docker compose down
```

Once the containers are up:

| Service | URL |
|---|---|
| API Key | http://localhost:3001 |
| JWT | http://localhost:3002 |
| Mock IdP (OIDC) | http://localhost:4000 |
| OIDC App | http://localhost:3003 |

> **Quick note on OIDC + Docker networking:** The browser hits `localhost:4000` to reach the IdP, but the `oidc-app` container can't use `localhost` for back-channel calls — that would point to itself. So `docker-compose.yml` passes two separate env vars: `IDP_PUBLIC_URL` (what the browser uses) and `IDP_INTERNAL_URL` (what the container uses, resolved via Docker's internal DNS as `mock-idp:4000`). This is handled automatically — you don't need to change anything.

---

### Running with Node.js directly

You'll need four terminal tabs:

```bash
# Tab 1
cd apikey && npm install && npm start

# Tab 2
cd jwt && npm install && npm start

# Tab 3 — start the IdP first
cd oidc && npm install && node mock-idp.js

# Tab 4 — then the app
cd oidc && node server.js
```

---

## How Each Method Works

### 🔑 API Key

The simplest of the three. The server keeps a list of valid keys. The client includes the key on every request — either in a header or a query param — and the server just checks if it exists.

```
Client ──[x-api-key: abc123]──► Server
Server ──[key lookup]─────────► Found? Allow : Reject
```

**Good fit when:**
- You're connecting services internally (machine-to-machine)
- You need a quick way to identify clients on a public API
- You want something running in an afternoon without a lot of infrastructure

**Trade-offs:**
- No concept of user identity — a key represents a client or service, not a person
- You manage the full lifecycle: rotation, expiry, revocation
- If a key leaks, you have to revoke it manually and issue a new one

**Try it:**
```bash
# Happy path
curl -H "x-api-key: secret-key-alice" http://localhost:3001/api/data

# Missing key
curl http://localhost:3001/api/data

# Wrong key
curl -H "x-api-key: notavalidkey" http://localhost:3001/api/data

# Bob only has read scope — this write request should get rejected
curl -X POST http://localhost:3001/api/data \
  -H "x-api-key: secret-key-bob" \
  -H "Content-Type: application/json" \
  -d '{"name": "test"}'
```

---

### 🎫 JWT (JSON Web Token)

A JWT carries the user's data inside the token itself. After login, the server signs a token containing the user's ID, name, role, and expiry time. From that point on, every request just needs the token — the server verifies the signature without hitting the database.

```
Client ──[POST /login]────────────────────► Server signs + returns token
Client ──[GET /api + Bearer token]────────► Server verifies signature only
```

The token is three Base64-encoded sections joined by dots:

```
eyJhbGciOiJIUzI1NiJ9                              ← algorithm info
.eyJzdWIiOiJ1c2VyLTAwMSIsIm5hbWUiOiJBbGljZSJ9   ← user data
.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c    ← signature
```

Anyone can read the first two parts — the signature is what proves it hasn't been tampered with.

**Good fit when:**
- You're building a stateless REST API and don't want session storage
- You have microservices that need to pass user identity between them
- You're building a mobile app and want tokens stored on the device
- You're going serverless and can't rely on sticky sessions

**Trade-offs:**
- Once issued, a token is valid until it expires — you can't revoke it easily without adding a blocklist (which brings back statefulness)
- If the signing secret leaks, every token you've ever issued becomes compromisable
- The payload is readable by anyone — don't put sensitive data in it

**Try it:**
```bash
# Step 1 — log in and grab the token
TOKEN=$(curl -s -X POST http://localhost:3002/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"password123"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Step 2 — use it
curl -H "Authorization: Bearer $TOKEN" http://localhost:3002/api/profile

# Inspect the token contents (no verification — just decoding)
curl -s -X POST http://localhost:3002/auth/decode \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\"}" | python3 -m json.tool

# Try hitting the admin endpoint with Bob's token (Bob is role: user, not admin)
TOKEN_BOB=$(curl -s -X POST http://localhost:3002/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"bob","password":"password123"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
curl -H "Authorization: Bearer $TOKEN_BOB" http://localhost:3002/api/admin
```

---

### 🌐 OIDC (OpenID Connect)

OIDC is an identity layer on top of OAuth 2.0. The key difference from the other two is that your app never handles passwords directly. Instead, you delegate authentication to an Identity Provider (IdP) — Google, Keycloak, Okta, Auth0, whatever — and simply trust the token it issues.

The flow looks like this:

```
User clicks Login
  → App redirects browser to IdP (with client_id, scope, state)
  → User logs in at the IdP
  → IdP redirects back to the app with a one-time auth code
  → App exchanges that code for tokens (back-channel, never touches the browser)
  → App validates the ID Token and creates a session
  → Done
```

This POC runs a **local mock IdP** on port 4000 that behaves exactly like a real one. The flow is identical to what you'd see with Keycloak or Google — just point the config at a different URL and it works the same way.

**Good fit when:**
- You have actual users logging in (not service-to-service)
- You want SSO across multiple apps
- Your company already has an identity system (Active Directory, Google Workspace, etc.)
- You don't want to deal with storing and hashing passwords yourself
- You need MFA or social login without building it from scratch

**Trade-offs:**
- The most complex of the three — there are more moving parts, and getting the security details wrong (state validation, nonce, audience check) is easy to do
- You're dependent on an external service being available
- Overkill if you just need simple service authentication

**Try it — browser flow:**
1. Open http://localhost:3003
2. Click **"Login with Mock IdP"**
3. Pick a user (Alice or Bob) and log in
4. You'll land back on the app, now authenticated
5. Visit http://localhost:3003/profile to see what came back in the ID Token

**Try it — curl:**
```bash
# See what endpoints the IdP exposes (this is how real apps discover the IdP config)
curl http://localhost:4000/.well-known/openid-configuration | python3 -m json.tool

# Public keys used for token verification
curl http://localhost:4000/.well-known/jwks.json
```

---

## Comparison

| | API Key | JWT | OIDC |
|---|---|---|---|
| **Setup complexity** | Low | Medium | High |
| **User identity** | No | Yes (inside token) | Yes (from IdP) |
| **Stateless** | No (needs lookup) | Yes | Yes (after login) |
| **Token expiry** | No (manual) | Yes (`exp` claim) | Yes |
| **Revocation** | Easy (delete key) | Hard | Possible (via IdP) |
| **SSO support** | No | No | Yes |
| **You manage passwords** | Yes | Yes | No (IdP handles it) |
| **Best for** | M2M, internal APIs | REST APIs, mobile | User login, enterprise SSO |
| **Backed by standard** | None | RFC 7519 | OpenID Connect 1.0 |

---

## Picking the Right One

```
Is a human logging in?
├── No → Service-to-service?
│   ├── Need identity + fine-grained scopes? → JWT (Client Credentials flow)
│   └── Just need to identify the caller?    → API Key
│
└── Yes → Need SSO or an existing identity provider?
    ├── Yes → OIDC
    └── No → Managing auth yourself?
        ├── Need stateless + scalable  → JWT
        └── Need easy revocation       → Session + Cookie (outside scope of this lab)
```

---

## Before Using This in Production

A few things worth calling out since this is a POC:

- **Hash your API keys** before storing them — treat them like passwords, don't store the raw value
- **Use a strong JWT secret** — generate a 256-bit random string, not a hardcoded literal like in this example
- **Prefer RS256 over HS256** for JWT in distributed systems — with asymmetric keys, verifying services only need the public key, not the shared secret
- **Validate all JWT claims** — don't skip checking `iss`, `aud`, and `exp`
- **HTTPS is non-negotiable in production** — all three methods send tokens in plaintext without TLS
- **Use PKCE for SPAs and mobile apps** with OIDC — the Implicit Flow is deprecated for good reason

---

## 🛠️ Environment & Secret Setup Checklist

To get the pipeline running, you need to configure **GitHub Environments**. Follow this checklist:

### 1. Create Environments
Go to **Settings > Environments** and create two: `dev` and `prod`.

### 2. Configure Dedicated Secrets & Variables
Add these values **inside each specific environment** (not as global Repository Secrets):

| Environment | Key Type | Variable Name | Value / Description |
| :--- | :--- | :--- | :--- |
| **`dev`** | **Secret** | `AWS_ROLE_ARN` | IAM Role ARN for **Development Account** |
| | **Variable** | `AWS_REGION` | e.g. `ap-southeast-3` |
| | **Variable** | `APIKEY_VERSION` | e.g. `1.0.0` |
| | **Variable** | `JWT_VERSION` | e.g. `1.0.1` |
| | **Variable** | `OIDC_APP_VERSION` | e.g. `1.0.3` |
| | **Variable** | `MOCK_IDP_VERSION` | e.g. `1.0.4` |
| **`prod`** | **Secret** | `AWS_ROLE_ARN` | IAM Role ARN for **Production Account** |
| | **Variable** | `AWS_REGION` | e.g. `ap-southeast-3` |
| | **Variable** | `APIKEY_VERSION` | e.g. `0.0.1` |
| | **Variable** | `JWT_VERSION` | e.g. `0.0.2` |
| | **Variable** | `OIDC_APP_VERSION` | e.g. `0.0.3` |
| | **Variable** | `MOCK_IDP_VERSION` | e.g. `0.0.4` |

### 3. Global Secrets (Repository Level)
Configure these globally as they are shared across environments:
- `SMTP_USERNAME`: For email notifications.
- `SMTP_PASSWORD`: For email notifications.

---

## 🚀 CI/CD & Deployment

This project is equipped with a **Production-Grade CI/CD Pipeline** using GitHub Actions and Amazon ECR.

### Key Features:
- **Multi-Account Ready**: Securely deploy to different AWS accounts (Dev/Prod) using GitHub Environments.
- **Top-Tier Security**: Passwordless authentication via AWS OIDC and automatic **CRITICAL** vulnerability scanning.
- **High Performance**: Optimized Docker builds using `Buildx` and GitHub Actions caching.
- **Hierarchical Versions**: Flexible image tagging that supports environment-level overrides.

For full setup instructions, IAM policies, and architecture details, see:
👉 **[Detailed CI/CD Documentation](CI-CD-PIPELINE.md)**

---

## Dependencies

| Package | Used in | Purpose |
|---|---|---|
| `express` | all | HTTP framework |
| `jsonwebtoken` | jwt, oidc | Sign and verify JWTs |
| `bcryptjs` | jwt | Hash and compare passwords |
| `express-session` | oidc | Server-side session after login |
| `node-fetch` | oidc | Back-channel HTTP calls to the IdP |
| `uuid` | oidc | Generate state, nonce, and auth codes |
