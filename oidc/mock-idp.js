/**
 * ============================================================
 * POC: Mock Identity Provider (IdP) — OIDC Compliant
 * ============================================================
 *
 * This simulates a real IdP like Google, Keycloak, Okta, or Auth0.
 * It exposes the standard OIDC endpoints:
 *
 *   GET  /.well-known/openid-configuration  → Discovery document
 *   GET  /.well-known/jwks.json             → Public keys (for token verification)
 *   GET  /authorize                         → Start auth, show login page
 *   POST /authorize                         → Process login, issue auth code
 *   POST /token                             → Exchange code → ID Token + Access Token
 *   GET  /userinfo                          → Return claims for Access Token
 *
 * In a real OIDC setup, this server is Google/Okta/Keycloak.
 * We run it locally so you can see every step of the flow.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 4000;
const IDP_ISSUER = `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── RSA-style: We use HS256 for simplicity in this POC ─────
// In production IdPs use RS256 (asymmetric RSA keys).
// The concept is the same — only the verification mechanism differs.
const IDP_SIGNING_SECRET = 'mock-idp-signing-secret-would-be-rsa-private-key';

// ─── Registered OIDC Clients (your apps) ────────────────────
const OIDC_CLIENTS = {
    'my-app-client-id': {
        clientSecret: 'my-app-client-secret',
        redirectUris: ['http://localhost:3003/callback'],
        name: 'My POC App',
    },
};

// ─── Mock User Store ──────────────────────────────────────────
const USERS = {
    alice: {
        sub: 'user-oidc-001',
        username: 'alice',
        password: 'password123',
        name: 'Alice Smith',
        email: 'alice@example.com',
        picture: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alice',
        roles: ['admin', 'user'],
    },
    bob: {
        sub: 'user-oidc-002',
        username: 'bob',
        password: 'password123',
        name: 'Bob Jones',
        email: 'bob@example.com',
        picture: 'https://api.dicebear.com/7.x/avataaars/svg?seed=bob',
        roles: ['user'],
    },
};

// ─── In-memory stores (prod: use Redis/DB) ───────────────────
const AUTH_CODES = {};     // code → { user, clientId, nonce, scope }
const ACCESS_TOKENS = {};  // token → { user, scope }

// ─── Standard OIDC Discovery Document ────────────────────────
// Your app fetches this to discover all IdP endpoints automatically
app.get('/.well-known/openid-configuration', (req, res) => {
    res.json({
        issuer: IDP_ISSUER,
        authorization_endpoint: `${IDP_ISSUER}/authorize`,
        token_endpoint: `${IDP_ISSUER}/token`,
        userinfo_endpoint: `${IDP_ISSUER}/userinfo`,
        jwks_uri: `${IDP_ISSUER}/.well-known/jwks.json`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['HS256'],
        scopes_supported: ['openid', 'profile', 'email'],
        claims_supported: ['sub', 'name', 'email', 'picture', 'roles'],
    });
});

// ─── JWKS — Public keys for verifying ID Tokens ──────────────
// In RS256, the public key would go here. With HS256 (shared secret),
// this is simplified for the POC.
app.get('/.well-known/jwks.json', (req, res) => {
    res.json({
        note: 'In this POC we use HS256 (shared secret). In production, RS256 public keys go here.',
        keys: [{ kty: 'oct', use: 'sig', alg: 'HS256', kid: 'mock-key-1' }],
    });
});

// ─── GET /authorize — Show Login Page ────────────────────────
app.get('/authorize', (req, res) => {
    const { client_id, redirect_uri, state, nonce, scope, response_type } = req.query;

    // Validate the client
    const client = OIDC_CLIENTS[client_id];
    if (!client) {
        return res.status(400).send('Error: Unknown client_id');
    }
    if (!client.redirectUris.includes(redirect_uri)) {
        return res.status(400).send('Error: redirect_uri not registered for this client');
    }

    // Show the login page — in real IdPs, this is the Google/Okta login UI
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Mock IdP — Login</title>
      <style>
        body { font-family: system-ui; max-width: 400px; margin: 80px auto; padding: 20px; }
        h1 { color: #4a6cf7; }
        .card { background: #f9f9f9; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        input, select { width: 100%; padding: 10px; margin: 8px 0; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
        button { width: 100%; padding: 12px; background: #4a6cf7; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; }
        button:hover { background: #3a5cd7; }
        .meta { font-size: 12px; color: #888; margin-top: 16px; }
        .tag { background: #e8edff; color: #4a6cf7; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
      </style>
    </head>
    <body>
      <h1>🌐 Mock Identity Provider</h1>
      <div class="card">
        <p><strong>App requesting access:</strong> ${client.name}</p>
        <p><strong>Scopes requested:</strong> ${scope || 'openid'}</p>
        <hr/>
        <form method="POST" action="/authorize">
          <input type="hidden" name="client_id" value="${client_id}"/>
          <input type="hidden" name="redirect_uri" value="${redirect_uri}"/>
          <input type="hidden" name="state" value="${state || ''}"/>
          <input type="hidden" name="nonce" value="${nonce || ''}"/>
          <input type="hidden" name="scope" value="${scope || 'openid'}"/>

          <label><strong>Select user to login as:</strong></label>
          <select name="username">
            <option value="alice">Alice Smith (admin)</option>
            <option value="bob">Bob Jones (user)</option>
          </select>
          <label><strong>Password:</strong></label>
          <input type="password" name="password" placeholder="password123" value="password123"/>
          <button type="submit">Login and Authorize</button>
        </form>
        <div class="meta">
          <p>🔒 This is a mock IdP. In production, use Keycloak, Auth0, Google, or Okta.</p>
          <p>All users have password: <span class="tag">password123</span></p>
        </div>
      </div>
    </body>
    </html>
  `);
});

// ─── POST /authorize — Process Login, Issue Auth Code ─────────
app.post('/authorize', (req, res) => {
    const { client_id, redirect_uri, state, nonce, scope, username, password } = req.body;

    // Verify credentials
    const user = USERS[username];
    if (!user || user.password !== password) {
        return res.status(401).send('Invalid credentials');
    }

    // Generate one-time authorization code (short-lived, ~10min in prod)
    const code = uuidv4();
    AUTH_CODES[code] = {
        user,
        clientId: client_id,
        redirectUri: redirect_uri,
        nonce,
        scope: scope || 'openid',
        expiresAt: Date.now() + 120_000, // 2 min for this POC
    };

    console.log(`[IDP] ✅ Auth code issued for ${user.name} → client: ${client_id}`);
    console.log(`[IDP]    Code: ${code}`);

    // Redirect back to the app with the auth code + state
    const callbackUrl = new URL(redirect_uri);
    callbackUrl.searchParams.set('code', code);
    if (state) callbackUrl.searchParams.set('state', state);

    res.redirect(callbackUrl.toString());
});

// ─── POST /token — Exchange Code for Tokens ──────────────────
app.post('/token', (req, res) => {
    const { grant_type, code, redirect_uri, client_id, client_secret } = req.body;

    // Validate client
    const client = OIDC_CLIENTS[client_id];
    if (!client || client.clientSecret !== client_secret) {
        return res.status(401).json({ error: 'invalid_client' });
    }

    if (grant_type !== 'authorization_code') {
        return res.status(400).json({ error: 'unsupported_grant_type' });
    }

    // Validate auth code
    const codeData = AUTH_CODES[code];
    if (!codeData) {
        return res.status(400).json({ error: 'invalid_grant', message: 'Code not found or already used' });
    }
    if (Date.now() > codeData.expiresAt) {
        delete AUTH_CODES[code];
        return res.status(400).json({ error: 'invalid_grant', message: 'Code expired' });
    }
    if (codeData.clientId !== client_id || codeData.redirectUri !== redirect_uri) {
        return res.status(400).json({ error: 'invalid_grant', message: 'Code/client mismatch' });
    }

    // Consume the code (one-time use!)
    delete AUTH_CODES[code];

    const user = codeData.user;
    const now = Math.floor(Date.now() / 1000);

    // Build ID Token — proves IDENTITY (who the user is)
    const idToken = jwt.sign({
        iss: IDP_ISSUER,            // Issuer
        sub: user.sub,              // Subject (user ID)
        aud: client_id,             // Audience (your app must verify this!)
        iat: now,
        exp: now + 3600,            // 1 hour
        nonce: codeData.nonce,      // CSRF protection
        // Standard OIDC claims:
        name: user.name,
        email: user.email,
        picture: user.picture,
        // Custom claims:
        roles: user.roles,
    }, IDP_SIGNING_SECRET);

    // Build Access Token — for calling protected APIs
    const accessToken = uuidv4();
    ACCESS_TOKENS[accessToken] = { user, scope: codeData.scope };

    console.log(`[IDP] ✅ Tokens issued for ${user.name}`);

    res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: idToken,
        scope: codeData.scope,
    });
});

// ─── GET /userinfo — Return user claims for Access Token ──────
app.get('/userinfo', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'unauthorized' });

    const token = authHeader.replace('Bearer ', '');
    const tokenData = ACCESS_TOKENS[token];

    if (!tokenData) return res.status(401).json({ error: 'invalid_token' });

    const user = tokenData.user;
    res.json({
        sub: user.sub,
        name: user.name,
        email: user.email,
        picture: user.picture,
        roles: user.roles,
    });
});

// ─── Start Mock IdP ───────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🏛️  Mock IdP running on http://localhost:${PORT}`);
    console.log(`   Discovery: http://localhost:${PORT}/.well-known/openid-configuration`);
    console.log(`   JWKS:      http://localhost:${PORT}/.well-known/jwks.json`);
    console.log('\n   Now start your app: node server.js\n');
});
