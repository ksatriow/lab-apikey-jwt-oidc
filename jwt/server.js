/**
 * ============================================================
 * POC: JWT (JSON Web Token) Authentication
 * ============================================================
 *
 * HOW IT WORKS:
 * 1. Client sends credentials (username + password) to /auth/login.
 * 2. Server verifies credentials, then signs a JWT containing:
 *      - sub (subject / user ID)
 *      - name, role
 *      - iat (issued at), exp (expiry)
 * 3. Client stores the JWT and sends it with every subsequent request:
 *      Authorization: Bearer <token>
 * 4. Server verifies the JWT signature — NO database lookup needed!
 *    The token itself proves the identity.
 *
 * FLOW:
 *   Client --[POST /login + credentials]--> Server
 *   Server --[sign JWT]------------------> Client receives token
 *   Client --[GET /api + Bearer token]---> Server
 *   Server --[verify signature only]-----> Grant access
 *
 * KEY BENEFIT: Stateless — server doesn't need to store sessions.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = 3002;

// ─── Configuration ────────────────────────────────────────────
// In production: use a long random secret from env variable
// e.g. JWT_SECRET=$(openssl rand -hex 32)
const JWT_SECRET = 'super-secret-key-change-in-production-use-256bit';
const JWT_EXPIRES_IN = '1h'; // Token valid for 1 hour

// ─── Fake User Database ───────────────────────────────────────
// Passwords are hashed with bcrypt (never store plaintext!)
// Hash generated with: bcrypt.hashSync('password123', 10)
const USERS = [
    {
        id: 'user-001',
        username: 'alice',
        // plaintext: password123
        passwordHash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        name: 'Alice',
        role: 'admin',
        email: 'alice@example.com',
    },
    {
        id: 'user-002',
        username: 'bob',
        // plaintext: password123
        passwordHash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        name: 'Bob',
        role: 'user',
        email: 'bob@example.com',
    },
];

app.use(express.json());

// ─── Middleware: Verify JWT ───────────────────────────────────
function requireAuth(req, res, next) {
    // Step 1: Extract token from Authorization header
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Missing or malformed Authorization header.',
            expected: 'Authorization: Bearer <your-jwt-token>',
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        // Step 2: Verify signature + expiry (no DB lookup!)
        const decoded = jwt.verify(token, JWT_SECRET);

        // Step 3: Attach decoded payload to request
        req.user = decoded;

        console.log(`[AUTH] ✅ JWT valid — User: ${decoded.name} (${decoded.role}), expires: ${new Date(decoded.exp * 1000).toISOString()}`);
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'TokenExpired',
                message: 'Your token has expired. Please log in again.',
                expiredAt: err.expiredAt,
            });
        }
        return res.status(403).json({
            error: 'InvalidToken',
            message: 'Token signature is invalid or token is malformed.',
        });
    }
}

// ─── Middleware: Role-Based Access Control ────────────────────
function requireRole(role) {
    return (req, res, next) => {
        if (req.user.role !== role) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `This endpoint requires role: "${role}". Your role: "${req.user.role}"`,
            });
        }
        next();
    };
}

// ─── Routes ──────────────────────────────────────────────────

app.get('/', (req, res) => {
    res.json({
        message: '🎫 JWT Authentication POC',
        endpoints: {
            'POST /auth/login': 'Exchange credentials for a JWT',
            'POST /auth/decode': 'Decode a JWT (no verification — educational only)',
            'GET /api/profile': 'Protected — requires valid JWT',
            'GET /api/admin': 'Protected — requires JWT + admin role',
        },
        testUsers: USERS.map(u => ({
            username: u.username,
            password: 'password123',
            role: u.role,
        })),
    });
});

// ─── POST /auth/login — Issue a JWT ──────────────────────────
app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'username and password are required' });
    }

    // Find user
    const user = USERS.find(u => u.username === username);
    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password (bcrypt compare)
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Sign JWT — payload becomes the token itself (no session stored)
    const payload = {
        sub: user.id,           // Subject: unique user ID
        name: user.name,
        username: user.username,
        role: user.role,
        email: user.email,
        // iat (issued at) and exp (expiry) are added automatically by jsonwebtoken
    };

    const token = jwt.sign(payload, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN,
        issuer: 'poc-jwt-server',   // iss claim
        audience: 'poc-client',     // aud claim
    });

    console.log(`[LOGIN] ✅ Token issued for: ${user.name} (${user.role})`);

    res.json({
        message: '✅ Login successful!',
        token,
        tokenType: 'Bearer',
        expiresIn: JWT_EXPIRES_IN,
        usage: `curl -H "Authorization: Bearer ${token}" http://localhost:${PORT}/api/profile`,
    });
});

// ─── POST /auth/decode — Show token internals (educational) ──
app.post('/auth/decode', (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token is required in body' });

    // Decode WITHOUT verification — for educational display only
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) {
        return res.status(400).json({ error: 'Could not decode token — malformed JWT' });
    }

    res.json({
        warning: '⚠️  This endpoint decodes WITHOUT verifying the signature. Do not trust unverified data!',
        header: decoded.header,
        payload: {
            ...decoded.payload,
            iat_human: new Date(decoded.payload.iat * 1000).toISOString(),
            exp_human: new Date(decoded.payload.exp * 1000).toISOString(),
        },
        signature: decoded.signature,
        structure: 'A JWT is: base64(header) + "." + base64(payload) + "." + signature',
    });
});

// ─── GET /api/profile — Protected Route ──────────────────────
app.get('/api/profile', requireAuth, (req, res) => {
    res.json({
        message: '✅ Token verified — here is your profile from the JWT payload!',
        note: 'No database query was needed — all data came from the token itself.',
        profile: {
            id: req.user.sub,
            name: req.user.name,
            username: req.user.username,
            role: req.user.role,
            email: req.user.email,
        },
        tokenMeta: {
            issuedAt: new Date(req.user.iat * 1000).toISOString(),
            expiresAt: new Date(req.user.exp * 1000).toISOString(),
            issuer: req.user.iss,
        },
    });
});

// ─── GET /api/admin — Protected + Role Check ─────────────────
app.get('/api/admin', requireAuth, requireRole('admin'), (req, res) => {
    res.json({
        message: '✅ Admin access granted!',
        accessedBy: req.user.name,
        adminData: {
            totalUsers: USERS.length,
            users: USERS.map(u => ({ id: u.id, name: u.name, role: u.role })),
        },
    });
});

// ─── Start Server ─────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🎫 JWT Auth POC running on http://localhost:${PORT}`);
    console.log('\nTest Accounts (password: password123):');
    USERS.forEach(u => {
        console.log(`  → ${u.username.padEnd(10)} | role: ${u.role}`);
    });
    console.log('\nQuick Start:');
    console.log(`  1. Login:   curl -s -X POST http://localhost:${PORT}/auth/login -H "Content-Type: application/json" -d '{"username":"alice","password":"password123"}'`);
    console.log(`  2. Use token in: Authorization: Bearer <token>\n`);
});
