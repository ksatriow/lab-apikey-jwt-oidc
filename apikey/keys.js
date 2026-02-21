/**
 * keys.js — Simulated API Key Store
 *
 * In production, these would be stored in a DB (hashed).
 * Format: { key: { owner, scopes, createdAt } }
 */

const API_KEYS = {
  'secret-key-alice': {
    owner: 'Alice (Service A)',
    scopes: ['read', 'write'],
    createdAt: '2024-01-01',
  },
  'secret-key-bob': {
    owner: 'Bob (Service B)',
    scopes: ['read'],
    createdAt: '2024-02-15',
  },
  'secret-key-admin': {
    owner: 'Admin Service',
    scopes: ['read', 'write', 'admin'],
    createdAt: '2024-01-01',
  },
};

module.exports = { API_KEYS };
