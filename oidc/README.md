# 🌐 OIDC (OpenID Connect) Authentication — POC

## What is OIDC?

OpenID Connect is an **identity layer built on top of OAuth 2.0**. While OAuth 2.0 handles *authorization* ("can this app access my data?"), OIDC handles *authentication* ("who is this user?").

A central **Identity Provider (IdP)** — like Google, Keycloak, Okta, or Auth0 — manages user authentication. Your app (the **Relying Party**) trusts the IdP and never handles passwords.

### The 3 Key Tokens
| Token | Purpose | Lifetime |
|---|---|---|
| **ID Token** (JWT) | Proves who the user is | Short (use once) |
| **Access Token** | Authorizes API calls | Short (15min–1hr) |
| **Refresh Token** | Get new access tokens | Longer (days/weeks) |

---

## ✅ When to Use OIDC

| Scenario | OIDC is a Good Fit? |
|---|---|
| User-facing login (SSO) | ✅ Yes — this is OIDC's primary purpose |
| "Login with Google/GitHub" | ✅ Yes |
| Enterprise SSO (Active Directory, Keycloak) | ✅ Yes |
| Centralizing auth across many apps | ✅ Yes |
| Mobile/SPA OAuth flows | ✅ Yes (use PKCE) |
| Server-to-server (M2M) with no user | ❌ Use Client Credentials flow instead |
| Simple API key style auth | ❌ Overkill — use API Key or JWT |

### Key Characteristics
- **Delegated authentication** — IdP owns password/MFA; your app never sees credentials
- **Standardized** — uses well-known endpoints (`.well-known/openid-configuration`)
- **Federated** — one IdP can serve many applications (SSO)
- **ID Token** is a verified JWT containing user identity claims
- **Most complex** of the three — but handles real-world auth richly

---

## 🔄 Authorization Code Flow (Standard Web App)

```
User                  Your App              Identity Provider (IdP)
 |                       |                          |
 |-- click "Login" ------>|                          |
 |                       |-- redirect to IdP ------->|
 |                       |   (with client_id,        |
 |                       |    redirect_uri, scope)   |
 |<------- browser redirected to IdP login page -----|
 |-- enter credentials -------------------------------->|
 |                       |<---- auth code ------------|
 |                       |                          |
 |                       |-- exchange code for tokens->|
 |                       |   (POST /token)           |
 |                       |<--- ID Token + Access Token|
 |                       |                          |
 |<-- logged in! ---------|                          |
```

---

## 🗂️ Project Structure

```
oidc/
├── server.js           # Express app acting as OIDC Relying Party
├── mock-idp.js         # Simulated Identity Provider (IdP) server
├── package.json
└── README.md
```

> **Note:** This POC runs a **mock IdP** locally to simulate the flow without needing Google/Okta/Keycloak. The mock IdP issues real JWTs signed with RS256 (asymmetric key).

---

## 🚀 Running the POC

You need **two terminals**:

```bash
# Terminal 1 — Start Mock IdP (runs on port 4000)
cd oidc
npm install
node mock-idp.js

# Terminal 2 — Start Your App (runs on port 3003)
node server.js
```

Then open: **http://localhost:3003**

---

## 🧪 Testing Flow

1. Open **http://localhost:3003** in your browser
2. Click **"Login with Mock IdP"**
3. You'll be redirected to the Mock IdP login page
4. Choose a user (Alice or Bob) and click Login
5. You'll be redirected back to your app — now authenticated!
6. Visit **/profile** to see your identity from the ID Token
7. Visit **/logout** to clear the session

### API Testing (curl)
```bash
# Check your app's OIDC config
curl http://localhost:3003/

# Check Mock IdP's discovery document
curl http://localhost:4000/.well-known/openid-configuration | jq

# Check Mock IdP's JWKS (public keys for verifying tokens)
curl http://localhost:4000/.well-known/jwks.json | jq
```

---

## 🔐 Security Considerations

1. **State parameter** — prevents CSRF attacks on the callback
2. **PKCE** (for SPAs/mobile) — prevents authorization code interception
3. **Validate ID Token** — check `iss`, `aud`, `exp`, `nonce`
4. **Use HTTPS** in production — all redirects must be HTTPS
5. **Never trust the ID Token from the frontend** — always verify server-side
6. **Short session lifetime** — use refresh tokens responsibly
