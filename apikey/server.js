/**
 * ============================================================
 * POC: API Key Authentication
 * ============================================================
 *
 * HOW IT WORKS:
 * 1. Server stores a set of valid API keys (usually in a DB).
 * 2. Client includes the key in every request — either via:
 *      - Header:       x-api-key: <key>
 *      - Query param:  ?api_key=<key>
 * 3. Server looks up the key, grants or denies access.
 *
 * FLOW:
 *   Client --[x-api-key: secret]--> Server
 *   Server --[lookup in DB]------> valid? grant : reject
 */

const express = require('express');
const { API_KEYS } = require('./keys');

const app = express();
const PORT = 3001;

app.use(express.json());

// ─── Middleware: API Key Auth ────────────────────────────────
function requireApiKey(req, res, next) {
    // Step 1: Extract key from header OR query param
    const apiKey = req.headers['x-api-key'] || req.query.api_key;

    if (!apiKey) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'API key is missing. Provide it via header "x-api-key" or query param "api_key".',
            example: 'curl -H "x-api-key: secret-key-alice" http://localhost:3001/api/data',
        });
    }

    // Step 2: Look up the key in the store
    const keyData = API_KEYS[apiKey];

    if (!keyData) {
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Invalid API key.',
        });
    }

    // Step 3: Attach client info to request object
    req.client = keyData;

    console.log(`[AUTH] ✅ Key valid — Owner: ${keyData.owner}, Scopes: [${keyData.scopes.join(', ')}]`);
    next();
}

// ─── Middleware: Scope/Permission Check ─────────────────────
function requireScope(scope) {
    return (req, res, next) => {
        if (!req.client.scopes.includes(scope)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `Your API key does not have the required scope: "${scope}"`,
                yourScopes: req.client.scopes,
            });
        }
        next();
    };
}

// ─── Routes ─────────────────────────────────────────────────

// Public route — no auth needed
app.get('/', (req, res) => {
    res.json({
        message: '🔑 API Key Authentication POC',
        endpoints: {
            'GET /api/data': 'Protected — requires valid API key (read scope)',
            'POST /api/data': 'Protected — requires valid API key (write scope)',
            'GET /admin/keys': 'Admin — list all registered keys',
        },
        howToTest: {
            header: 'curl -H "x-api-key: secret-key-alice" http://localhost:3001/api/data',
            queryParam: 'curl "http://localhost:3001/api/data?api_key=secret-key-bob"',
        },
    });
});

// Protected: READ
app.get('/api/data', requireApiKey, requireScope('read'), (req, res) => {
    res.json({
        message: '✅ Access granted — here is your data!',
        authenticatedAs: req.client.owner,
        scopes: req.client.scopes,
        data: [
            { id: 1, name: 'Item Alpha', value: 100 },
            { id: 2, name: 'Item Beta', value: 200 },
        ],
    });
});

// Protected: WRITE
app.post('/api/data', requireApiKey, requireScope('write'), (req, res) => {
    const body = req.body;
    res.status(201).json({
        message: '✅ Write access granted — data created!',
        authenticatedAs: req.client.owner,
        created: body,
    });
});

// Admin: list all keys (no auth for demo — in real life, protect this!)
app.get('/admin/keys', (req, res) => {
    const keySummary = Object.entries(API_KEYS).map(([key, info]) => ({
        // In production, NEVER expose raw keys — only masked versions
        key: key.slice(0, 10) + '***',
        owner: info.owner,
        scopes: info.scopes,
        createdAt: info.createdAt,
    }));
    res.json({ keys: keySummary });
});

// ─── Start Server ────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🔑 API Key Auth POC running on http://localhost:${PORT}`);
    console.log('\nValid Test Keys:');
    Object.entries(API_KEYS).forEach(([key, info]) => {
        console.log(`  → ${key.padEnd(25)} (${info.owner}) | scopes: [${info.scopes.join(', ')}]`);
    });
    console.log('\nTry:');
    console.log(`  curl -H "x-api-key: secret-key-alice" http://localhost:${PORT}/api/data`);
    console.log(`  curl "http://localhost:${PORT}/api/data?api_key=secret-key-bob"\n`);
});
