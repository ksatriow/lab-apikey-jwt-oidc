# 🔑 API Key Authentication — POC

## What is API Key Auth?

API Key authentication is the **simplest** form of authentication. A client is issued a secret string (key) that must be included with every request — typically in an HTTP header or query parameter. The server validates the key on every request.

---

## ✅ When to Use API Key

| Scenario | API Key is a Good Fit? |
|---|---|
| Server-to-server communication (M2M) | ✅ Yes |
| Public API with rate limiting per client | ✅ Yes |
| Internal microservices (trusted network) | ✅ Yes |
| User-facing login / sessions | ❌ No |
| Fine-grained permission control needed | ❌ No (use JWT/OIDC) |
| Key rotation + audit trail needed | ⚠️ With extra work |

### Key Characteristics
- **Stateless** on the client side, but **stateful** lookup on the server (DB or in-memory check)
- No expiry by default — you manage lifecycle
- No built-in user identity — a key represents a *client/service*, not a user
- Easy to implement; no crypto complexity

---

## 🗂️ Project Structure

```
apikey/
├── server.js        # Express server with API key middleware
├── keys.js          # In-memory API key store (simulates a DB)
├── package.json
└── README.md
```

---

## 🚀 Running the POC

```bash
cd apikey
npm install
npm start
```

Server runs on **http://localhost:3001**

---

## 🧪 Testing

### ✅ Valid Request (key in Header)
```bash
curl -H "x-api-key: secret-key-alice" http://localhost:3001/api/data
```

### ✅ Valid Request (key in Query Param)
```bash
curl "http://localhost:3001/api/data?api_key=secret-key-bob"
```

### ❌ Missing Key
```bash
curl http://localhost:3001/api/data
```

### ❌ Invalid Key
```bash
curl -H "x-api-key: wrong-key" http://localhost:3001/api/data
```

### 📊 Admin — List All Keys
```bash
curl http://localhost:3001/admin/keys
```

---

## 🔐 Security Considerations

1. **Always use HTTPS** — API keys in headers/params are plaintext
2. **Hash keys in storage** — store `SHA256(key)`, not the raw key
3. **Rotate keys** — provide a mechanism to revoke/reissue keys
4. **Rate limit per key** — prevent abuse
5. **Scope keys** — grant minimum required permissions
