# 🎫 JWT (JSON Web Token) Authentication — POC

## What is JWT?

JWT is a **self-contained token** that encodes identity and claims directly inside the token itself. The server signs the token with a secret (HMAC) or private key (RSA/ECDSA). Any server with the public key can verify the token **without a database lookup**.

### Token Structure
```
header.payload.signature
  ↓        ↓          ↓
Base64  Base64    Cryptographic
JSON    JSON      Signature
```

**Example decoded payload:**
```json
{
  "sub": "user-123",
  "name": "Alice",
  "role": "admin",
  "iat": 1700000000,
  "exp": 1700003600
}
```

---

## ✅ When to Use JWT

| Scenario | JWT is a Good Fit? |
|---|---|
| Stateless REST API authentication | ✅ Yes |
| Microservices — pass identity between services | ✅ Yes |
| Short-lived access tokens (minutes/hours) | ✅ Yes |
| Mobile app auth | ✅ Yes |
| Long-lived sessions (weeks/months) | ❌ No (use sessions or refresh tokens) |
| Revocation needed immediately | ⚠️ Hard — tokens are valid until expiry |
| Very sensitive roles (need instant revoke) | ❌ Use session-based or OIDC |

### Key Characteristics
- **Stateless** — server doesn't store sessions; the token IS the session
- **Self-contained** — payload carries user identity + claims
- **Expiry built-in** — `exp` claim makes tokens auto-expire
- **Portable** — easily passed between services (Authorization header)
- **Cannot be revoked easily** — once issued, valid until expired (use short TTL + refresh tokens)

---

## 🗂️ Project Structure

```
jwt/
├── server.js        # Express server — issue & verify JWTs
├── package.json
└── README.md
```

---

## 🚀 Running the POC

```bash
cd jwt
npm install
npm start
```

Server runs on **http://localhost:3002**

---

## 🧪 Testing Flow

### 1. Login — Get a JWT
```bash
curl -s -X POST http://localhost:3002/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "password123"}' | jq
```

### 2. Use the Token — Access Protected Route
```bash
TOKEN="<paste token here>"
curl -H "Authorization: Bearer $TOKEN" http://localhost:3002/api/profile
```

### 3. One-liner (login + use token)
```bash
TOKEN=$(curl -s -X POST http://localhost:3002/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "password123"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3002/api/profile
```

### 4. Decode the Token (see payload)
```bash
curl -s -X POST http://localhost:3002/auth/decode \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$TOKEN\"}"
```

### ❌ Test Error Cases
```bash
# Missing token
curl http://localhost:3002/api/profile

# Tampered/invalid token
curl -H "Authorization: Bearer fake.token.here" http://localhost:3002/api/profile

# Access admin endpoint as regular user
curl -H "Authorization: Bearer $TOKEN" http://localhost:3002/api/admin
```

---

## 🔐 Security Considerations

1. **Use HTTPS always** — tokens are visible in transit
2. **Short expiry** — 15min–1hr for access tokens; use refresh tokens for longer sessions
3. **Strong secret** — use 256-bit random secret for HMAC; RSA/EdDSA for distributed systems
4. **Don't store in localStorage** for web apps — prefer httpOnly cookies
5. **Validate ALL claims** — `exp`, `iss`, `aud`
6. **Revocation** — maintain a blocklist or use short TTL + refresh token rotation
