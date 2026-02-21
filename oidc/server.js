/**
 * ============================================================
 * POC: OIDC Relying Party (Your Application)
 * ============================================================
 *
 * HOW IT WORKS (Authorization Code Flow):
 *
 * 1. User clicks "Login" → browser redirects to IdP /authorize
 * 2. User authenticates at IdP (logs in with Google/Keycloak/etc)
 * 3. IdP redirects back to /callback with a one-time "auth code"
 * 4. Your server (back-channel) POSTs the code to IdP /token
 * 5. IdP returns:
 *      - ID Token (JWT): proves user identity
 *      - Access Token: for calling APIs on behalf of user
 * 6. Your server validates the ID Token and creates a session
 * 7. User is now authenticated!
 *
 * NETWORKING NOTE (important for Docker):
 *   - IDP_PUBLIC_URL  = URL the *browser* uses to reach the IdP (always localhost:4000 from host)
 *   - IDP_INTERNAL_URL = URL *this server* uses to reach IdP (docker service name inside container)
 *   Both are the same when running locally without Docker.
 *
 * WHAT MAKES OIDC SPECIAL:
 *   - Your app NEVER sees the user's password
 *   - One IdP can serve many apps (SSO)
 *   - Industry standard — works with Google, Okta, Keycloak, Auth0
 *   - ID Token is a verified JWT with rich identity claims
 */

const express = require('express');
const session = require('express-session');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3003;

// ─── OIDC Configuration ───────────────────────────────────────
// Supports environment variables for Docker deployment.
//
// IDP_PUBLIC   = URL the browser sees (default: http://localhost:4000)
// IDP_INTERNAL = URL used for server-to-server calls (default: same as public)
//                    In Docker, this is the service name, e.g. http://mock-idp:4000
// APP_PUBLIC   = This app's public URL (default: http://localhost:3003)
//
const IDP_PUBLIC = process.env.IDP_PUBLIC_URL || 'http://localhost:4000';
const IDP_INTERNAL = process.env.IDP_INTERNAL_URL || IDP_PUBLIC;
const APP_PUBLIC = process.env.APP_PUBLIC_URL || `http://localhost:${PORT}`;

const OIDC_CONFIG = {
  // issuer must match what's in the ID Token (iss claim) — always the public URL
  issuer: IDP_PUBLIC,

  // Browser-facing: where users are redirected to login
  authorizationEndpoint: `${IDP_PUBLIC}/authorize`,

  // Server-to-server: used in back-channel token exchange
  // In Docker: uses internal DNS (service name), not localhost
  tokenEndpoint: `${IDP_INTERNAL}/token`,
  userinfoEndpoint: `${IDP_INTERNAL}/userinfo`,

  // Your app's registered credentials with the IdP
  clientId: process.env.OIDC_CLIENT_ID || 'my-app-client-id',
  clientSecret: process.env.OIDC_CLIENT_SECRET || 'my-app-client-secret',

  // Where IdP redirects after login — must be pre-registered with IdP
  redirectUri: `${APP_PUBLIC}/callback`,

  // What user info we want:
  // openid = required, profile = name/picture, email = email address
  scope: 'openid profile email',

  // Signing secret (must match the IdP's, or use JWKS for RS256)
  signingSecret: process.env.IDP_SIGNING_SECRET || 'mock-idp-signing-secret-would-be-rsa-private-key',
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session to store user info after login
app.use(session({
  secret: 'session-secret-for-poc',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600_000 }, // 1 hour
}));

// ─── Middleware: Require Login ────────────────────────────────
function requireLogin(req, res, next) {
  if (!req.session.user) {
    // Redirect to login — preserving the original URL they wanted
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

// ─── Routes ──────────────────────────────────────────────────

// Home page
app.get('/', (req, res) => {
  const user = req.session.user;
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>OIDC POC App</title>
      <style>
        body { font-family: system-ui; max-width: 700px; margin: 60px auto; padding: 20px; }
        h1 { color: #4a6cf7; }
        .card { background: #f9f9f9; border-radius: 12px; padding: 24px; margin: 16px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        a { color: #4a6cf7; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .btn { display: inline-block; padding: 10px 20px; background: #4a6cf7; color: white; border-radius: 6px; margin: 4px; }
        .btn.danger { background: #e74c3c; }
        .btn.secondary { background: #6c757d; }
        code { background: #eee; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
        pre { background: #1e1e2e; color: #cdd6f4; padding: 16px; border-radius: 8px; overflow: auto; font-size: 13px; }
        .flow { background: #fff8e1; border-left: 4px solid #ffc107; padding: 12px; margin: 8px 0; border-radius: 4px; }
      </style>
    </head>
    <body>
      <h1>🌐 OIDC Authentication POC</h1>

      ${user ? `
        <div class="card">
          <h2>✅ You are logged in!</h2>
          <p><strong>Name:</strong> ${user.name}</p>
          <p><strong>Email:</strong> ${user.email}</p>
          <p><strong>Sub (ID):</strong> <code>${user.sub}</code></p>
          <p><strong>Roles:</strong> ${(user.roles || []).map(r => `<code>${r}</code>`).join(', ')}</p>
          <br/>
          <a href="/profile" class="btn">👤 View Full Profile</a>
          <a href="/logout" class="btn danger">🚪 Logout</a>
        </div>
      ` : `
        <div class="card">
          <h2>You are not logged in</h2>
          <p>Click below to authenticate via the Mock IdP (simulates Google/Keycloak/Okta).</p>
          <a href="/login" class="btn">🔐 Login with Mock IdP</a>
        </div>
      `}

      <div class="card">
        <h2>🔄 How OIDC Works (This POC)</h2>
        <div class="flow">1️⃣  <strong>/login</strong> → Redirects your browser to Mock IdP</div>
        <div class="flow">2️⃣  IdP shows login page → you select a user</div>
        <div class="flow">3️⃣  IdP redirects back to <strong>/callback?code=...</strong></div>
        <div class="flow">4️⃣  App exchanges code for ID Token (back-channel, secure)</div>
        <div class="flow">5️⃣  App validates ID Token signature, creates session</div>
        <div class="flow">6️⃣  You are authenticated! 🎉</div>
      </div>

      <div class="card">
        <h2>📡 Endpoints</h2>
        <p><a href="/login">/login</a> — Start OIDC login flow</p>
        <p><a href="/profile">/profile</a> — Protected: view identity (requires login)</p>
        <p><a href="/logout">/logout</a> — Clear session</p>
        <hr/>
        <p><strong>Mock IdP Endpoints:</strong></p>
        <p><a href="http://localhost:4000/.well-known/openid-configuration" target="_blank">IdP Discovery Document</a></p>
        <p><a href="http://localhost:4000/.well-known/jwks.json" target="_blank">IdP JWKS (public keys)</a></p>
      </div>
    </body>
    </html>
  `);
});

// ─── GET /login — Start OIDC Authorization Code Flow ─────────
app.get('/login', (req, res) => {
  // Generate state (CSRF protection) and nonce (replay protection)
  const state = uuidv4();
  const nonce = uuidv4();

  // Store in session to verify on callback
  req.session.oidcState = state;
  req.session.oidcNonce = nonce;

  // Build the IdP authorization URL
  const authUrl = new URL(OIDC_CONFIG.authorizationEndpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', OIDC_CONFIG.clientId);
  authUrl.searchParams.set('redirect_uri', OIDC_CONFIG.redirectUri);
  authUrl.searchParams.set('scope', OIDC_CONFIG.scope);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('nonce', nonce);

  console.log(`\n[APP] 🔀 Starting OIDC flow — redirecting to IdP`);
  console.log(`[APP]    state: ${state}`);
  console.log(`[APP]    Authorization URL: ${authUrl.toString()}`);

  // Redirect user to IdP login page
  res.redirect(authUrl.toString());
});

// ─── GET /callback — Handle IdP Redirect ─────────────────────
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  // Handle IdP errors
  if (error) {
    return res.status(400).send(`IdP returned error: ${error}`);
  }

  // Step 1: Validate state (prevents CSRF attacks)
  if (!state || state !== req.session.oidcState) {
    console.log('[APP] ❌ State mismatch! Possible CSRF attack.');
    return res.status(400).send('State validation failed. Possible CSRF attack.');
  }
  delete req.session.oidcState; // consumed

  console.log(`\n[APP] ✅ Received auth code from IdP`);
  console.log(`[APP]    Code: ${code}`);

  try {
    // Step 2: Exchange auth code for tokens (back-channel — secure!)
    console.log(`[APP] 🔄 Exchanging code for tokens at: ${OIDC_CONFIG.tokenEndpoint}`);

    const tokenResponse = await fetch(OIDC_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: OIDC_CONFIG.redirectUri,
        client_id: OIDC_CONFIG.clientId,
        client_secret: OIDC_CONFIG.clientSecret,
      }),
    });

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok || !tokens.id_token) {
      console.log('[APP] ❌ Token exchange failed:', tokens);
      return res.status(500).send(`Token exchange failed: ${JSON.stringify(tokens)}`);
    }

    console.log(`[APP] ✅ Received tokens from IdP`);

    // Step 3: Validate the ID Token
    // This is the critical security step — verify the signature!
    let idTokenPayload;
    try {
      idTokenPayload = jwt.verify(tokens.id_token, OIDC_CONFIG.signingSecret, {
        issuer: OIDC_CONFIG.issuer,    // Validate iss claim
        audience: OIDC_CONFIG.clientId, // Validate aud claim
      });
    } catch (verifyErr) {
      console.log('[APP] ❌ ID Token validation failed:', verifyErr.message);
      return res.status(401).send(`ID Token validation failed: ${verifyErr.message}`);
    }

    // Step 4: Validate nonce (prevents replay attacks)
    if (idTokenPayload.nonce !== req.session.oidcNonce) {
      console.log('[APP] ❌ Nonce mismatch!');
      return res.status(401).send('Nonce validation failed.');
    }
    delete req.session.oidcNonce;

    console.log(`[APP] ✅ ID Token valid — User: ${idTokenPayload.name} (${idTokenPayload.sub})`);

    // Step 5: Create session — user is now authenticated!
    req.session.user = {
      sub: idTokenPayload.sub,
      name: idTokenPayload.name,
      email: idTokenPayload.email,
      picture: idTokenPayload.picture,
      roles: idTokenPayload.roles,
      // Store raw tokens for API calls (in prod — be careful where you store these)
      accessToken: tokens.access_token,
      idToken: tokens.id_token,
    };

    // Redirect to original destination or home
    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(returnTo);

  } catch (err) {
    console.error('[APP] ❌ Callback error:', err);
    res.status(500).send(`Authentication error: ${err.message}`);
  }
});

// ─── GET /profile — Protected Route ─────────────────────────
app.get('/profile', requireLogin, async (req, res) => {
  const user = req.session.user;

  // Optionally call /userinfo with the access token to get fresh user data
  let userinfoData = null;
  try {
    const userinfoResponse = await fetch(OIDC_CONFIG.userinfoEndpoint, {
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    userinfoData = await userinfoResponse.json();
  } catch (e) {
    userinfoData = { error: 'Could not fetch userinfo' };
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Profile — OIDC POC</title>
      <style>
        body { font-family: system-ui; max-width: 700px; margin: 60px auto; padding: 20px; }
        h1 { color: #4a6cf7; }
        .card { background: #f9f9f9; border-radius: 12px; padding: 24px; margin: 16px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        img { border-radius: 50%; width: 80px; height: 80px; }
        a { color: #4a6cf7; }
        .btn { display: inline-block; padding: 10px 20px; background: #4a6cf7; color: white; border-radius: 6px; margin: 4px; text-decoration: none; }
        .btn.danger { background: #e74c3c; }
        pre { background: #1e1e2e; color: #cdd6f4; padding: 16px; border-radius: 8px; overflow: auto; font-size: 13px; }
        code { background: #eee; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
      </style>
    </head>
    <body>
      <h1>👤 Your Profile</h1>
      <div class="card">
        <img src="${user.picture || ''}" alt="avatar" onerror="this.style.display='none'"/>
        <h2>${user.name}</h2>
        <p>📧 ${user.email}</p>
        <p>🆔 Sub: <code>${user.sub}</code></p>
        <p>🏷️ Roles: ${(user.roles || []).map(r => `<code>${r}</code>`).join(', ')}</p>
      </div>

      <div class="card">
        <h3>📋 Data from Session (from ID Token)</h3>
        <pre>${JSON.stringify({ sub: user.sub, name: user.name, email: user.email, roles: user.roles }, null, 2)}</pre>
      </div>

      <div class="card">
        <h3>📡 Data from /userinfo Endpoint (using Access Token)</h3>
        <pre>${JSON.stringify(userinfoData, null, 2)}</pre>
      </div>

      <a href="/" class="btn">🏠 Home</a>
      <a href="/logout" class="btn danger">🚪 Logout</a>
    </body>
    </html>
  `);
});

// ─── GET /logout — Clear Session ─────────────────────────────
app.get('/logout', (req, res) => {
  const userName = req.session.user?.name;
  req.session.destroy(() => {
    console.log(`[APP] 🚪 ${userName || 'User'} logged out`);
    res.redirect('/');
  });
});

// ─── Start App ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌐 OIDC POC App running on http://localhost:${PORT}`);
  console.log(`\n⚠️  Make sure Mock IdP is also running:`);
  console.log(`   node mock-idp.js\n`);
  console.log(`Open: http://localhost:${PORT}\n`);
});
