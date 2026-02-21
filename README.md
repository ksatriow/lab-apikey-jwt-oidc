# Authentication POC Lab — API Key, JWT & OIDC

Repo ini adalah lab sederhana untuk memahami tiga mekanisme autentikasi yang paling sering dibahas tapi jarang benar-benar dipahami perbedaannya secara praktis: **API Key**, **JWT**, dan **OIDC**. Setiap folder adalah implementasi mandiri yang bisa langsung dijalankan — baik via Node.js langsung maupun Docker Compose.

Tujuannya bukan bikin production-ready code, tapi supaya kamu bisa *lihat sendiri* alurnya, baca log-nya, dan pahami kapan harus pakai yang mana.

---

## Struktur Project

```
lab-apikey-jwt-oidc/
│
├── apikey/                  # POC API Key (port 3001)
│   ├── server.js            #   Express server + middleware validasi key
│   ├── keys.js              #   Simulasi key store (ganti dengan DB/Redis di prod)
│   ├── Dockerfile
│   └── README.md
│
├── jwt/                     # POC JWT (port 3002)
│   ├── server.js            #   Login endpoint, sign & verify token
│   ├── Dockerfile
│   └── README.md
│
├── oidc/                    # POC OIDC (port 3003 + 4000)
│   ├── mock-idp.js          #   Simulasi Identity Provider (IdP)
│   ├── server.js            #   Relying Party — app yang pakai IdP
│   ├── Dockerfile.idp
│   ├── Dockerfile.app
│   └── README.md
│
├── docker-compose.yml       # Jalankan semua sekaligus
└── README.md
```

---

## Cara Menjalankan

### Opsi 1 — Docker Compose (paling mudah)

```bash
# Build dan jalankan semua service
docker compose up --build

# Kalau mau di background
docker compose up --build -d

# Matikan semua
docker compose down
```

Setelah semua container up:

| Service | URL |
|---|---|
| API Key | http://localhost:3001 |
| JWT | http://localhost:3002 |
| Mock IdP (OIDC) | http://localhost:4000 |
| OIDC App | http://localhost:3003 |

> **Catatan Docker untuk OIDC:** Ada dua URL yang perlu dibedakan — URL yang diakses browser (`localhost:4000`) dan URL yang dipakai antar container (`mock-idp:4000` via Docker internal DNS). Ini sudah dihandle otomatis di `docker-compose.yml` lewat env var `IDP_INTERNAL_URL`.

---

### Opsi 2 — Node.js Langsung

```bash
# Terminal 1
cd apikey && npm install && npm start

# Terminal 2
cd jwt && npm install && npm start

# Terminal 3 — IdP dulu
cd oidc && npm install && node mock-idp.js

# Terminal 4 — baru app-nya
cd oidc && node server.js
```

---

## Penjelasan Masing-masing Metode

### 🔑 API Key

Cara kerja paling sederhana. Server punya daftar key yang valid. Client kirim key di header atau query param, server tinggal cek apakah key ada di daftar.

```
Client ──[x-api-key: abc123]──► Server
Server ──[cek di DB/store]────► Valid? Lanjut : Tolak
```

**Kapan pakai ini:**
- Komunikasi antar service (machine-to-machine) di jaringan internal
- Public API yang perlu rate limiting per client
- Situasi di mana kesederhanaan lebih penting daripada fitur

**Kekurangannya:**
- Tidak ada identitas user — key hanya identifikasi service/client, bukan siapa yang memakai
- Tidak ada expiry bawaan, kamu yang harus kelola lifecycle-nya
- Kalau key bocor, perlu revoke manual

**Coba langsung:**
```bash
# Request valid
curl -H "x-api-key: secret-key-alice" http://localhost:3001/api/data

# Coba tanpa key
curl http://localhost:3001/api/data

# Coba key salah
curl -H "x-api-key: ngawurbro" http://localhost:3001/api/data

# Coba endpoint yang butuh scope 'write' padahal bob cuma punya 'read'
curl -X POST http://localhost:3001/api/data \
  -H "x-api-key: secret-key-bob" \
  -H "Content-Type: application/json" \
  -d '{"name": "test"}'
```

---

### 🎫 JWT (JSON Web Token)

JWT adalah token yang *membawa data di dalamnya*. Setelah login, server mengeluarkan token yang berisi informasi user (id, nama, role, waktu expired) dan ditandatangani secara kriptografis. Untuk verifikasi selanjutnya, server tinggal cek tanda tangannya — **tidak perlu query database sama sekali**.

```
Client ──[POST /login + credentials]──────► Server
Server ──[sign JWT dengan secret/key]─────► Client terima token

Client ──[GET /api + Bearer token]────────► Server
Server ──[verify signature saja]──────────► Data dari token langsung dipakai
```

Token JWT punya tiga bagian yang dipisah titik:
```
eyJhbGciOiJIUzI1NiJ9   ← header (algoritma)
.eyJzdWIiOiJ1c2VyLTAwMSIsIm5hbWUiOiJBbGljZSJ9  ← payload (data user)
.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c   ← signature (tanda tangan)
```

**Kapan pakai ini:**
- REST API stateless yang butuh membawa identitas user
- Microservice yang butuh forward identitas dari satu service ke service lain
- Mobile app — token disimpan di device, tidak perlu session di server
- Saat kamu mau serverless/scalable tanpa shared session store

**Kekurangannya:**
- Token tidak bisa di-revoke sebelum expired (kecuali pakai blocklist, yang membuat stateless jadi stateful lagi)
- Kalau secret bocor, semua token yang pernah diterbitkan bisa diverifikasi oleh siapa saja
- Payload-nya bisa dibaca siapa saja (hanya signature yang dilindungi, bukan kontennya)

**Coba langsung:**
```bash
# 1. Login dan ambil token
TOKEN=$(curl -s -X POST http://localhost:3002/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"password123"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 2. Akses protected endpoint
curl -H "Authorization: Bearer $TOKEN" http://localhost:3002/api/profile

# 3. Lihat isi token tanpa verifikasi (educational)
curl -s -X POST http://localhost:3002/auth/decode \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\"}" | python3 -m json.tool

# 4. Coba akses admin endpoint pakai token si Bob (role 'user', bukan 'admin')
TOKEN_BOB=$(curl -s -X POST http://localhost:3002/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"bob","password":"password123"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
curl -H "Authorization: Bearer $TOKEN_BOB" http://localhost:3002/api/admin
```

---

### 🌐 OIDC (OpenID Connect)

OIDC adalah standar autentikasi yang dibangun di atas OAuth 2.0. Yang membedakannya dari API Key dan JWT adalah: **kamu tidak perlu mengelola autentikasi sendiri**. Ada pihak ketiga yang disebut Identity Provider (IdP) — bisa Google, Okta, Keycloak, Auth0, atau apapun yang OIDC-compliant — yang menangani login, password, MFA, dan segalanya. Aplikasimu hanya *mempercayai* token yang dikeluarkan IdP.

```
User ──[klik Login]──────────────────────────────────────────────────► App
App  ──[redirect ke IdP + client_id, scope, state]──────────────────► IdP
User ──[login di IdP]────────────────────────────────────────────────► IdP
IdP  ──[redirect balik ke app + auth code]───────────────────────────► App
App  ──[tukar code → ID Token + Access Token (back-channel)]─────────► IdP
App  ──[verifikasi ID Token, buat session]───────────────────────────► User login!
```

Di POC ini, kita jalankan **mock IdP sendiri** di port 4000. Ini mensimulasikan persis alur yang akan terjadi kalau kamu pakai Google atau Keycloak — bedanya cuma URL-nya.

**Kapan pakai ini:**
- Aplikasi web yang punya user login (bukan service-to-service)
- Butuh SSO — satu login untuk banyak aplikasi
- Ingin pakai existing identity system perusahaan (Active Directory, Google Workspace)
- Tidak mau pegang password user sama sekali
- Butuh MFA, social login, audit trail dari IdP

**Kekurangannya:**
- Paling kompleks dari ketiganya — ada banyak moving parts (IdP, endpoint, token validation)
- Bergantung pada ketersediaan IdP eksternal
- Perlu dipahami dengan benar atau mudah implementasinya salah (state, nonce, audience validation)

**Coba langsung:**
1. Buka http://localhost:3003 di browser
2. Klik "Login with Mock IdP"
3. Pilih user (Alice atau Bob) dan klik login
4. Kamu akan diredirect balik ke app dalam kondisi login
5. Buka http://localhost:3003/profile untuk lihat data dari ID Token

Atau via curl untuk lihat discovery document IdP:
```bash
# Ini yang dipakai app untuk tahu endpoint-endpoint IdP secara otomatis
curl http://localhost:4000/.well-known/openid-configuration | python3 -m json.tool

# Public keys untuk verifikasi token
curl http://localhost:4000/.well-known/jwks.json
```

---

## Perbandingan

| | API Key | JWT | OIDC |
|---|---|---|---|
| **Kompleksitas setup** | Rendah | Sedang | Tinggi |
| **Identitas user** | Tidak | Ya (dalam token) | Ya (dari IdP) |
| **Stateless** | Tidak (butuh lookup) | Ya | Ya (setelah login) |
| **Expiry bawaan** | Tidak | Ya (`exp` claim) | Ya |
| **Revoke token** | Mudah (hapus key) | Sulit | Bisa (via IdP) |
| **SSO** | Tidak | Tidak | Ya |
| **Kelola password sendiri** | Ya | Ya | Tidak (IdP yang pegang) |
| **Cocok untuk** | M2M, internal API | REST API, microservice | User login, enterprise SSO |
| **Standard** | Tidak ada | RFC 7519 | OpenID Connect 1.0 |

---

## Panduan Memilih

Kalau masih bingung mau pakai yang mana, ikuti alur berikut:

```
Ada user manusia yang login?
├── Tidak → Komunikasi antar service?
│   ├── Perlu identitas + scope detail? → JWT (Client Credentials flow)
│   └── Cukup identifikasi service?     → API Key
│
└── Ya → Butuh SSO atau pakai IdP perusahaan?
    ├── Ya → OIDC
    └── Tidak → Kamu kelola auth sendiri?
        ├── Ya, butuh stateless → JWT
        └── Ya, butuh revoke mudah → Session + Cookie (di luar scope lab ini)
```

---

## Catatan Untuk Konteks Nyata

Beberapa hal yang perlu diingat sebelum pakai ini sebagai referensi production:

- **Hash API key** sebelum disimpan di database — jangan simpan raw key, sama seperti password
- **JWT secret harus kuat** — minimal 256-bit random string, bukan string literal seperti di contoh ini
- **Pakai RS256 bukan HS256** untuk JWT di sistem terdistribusi — dengan asymmetric key, service yang perlu verifikasi token tidak perlu tahu secret key-nya, cukup punya public key
- **Validasi semua claim JWT** — jangan skip pengecekan `iss`, `aud`, dan `exp`
- **HTTPS wajib di production** — semua token di atas berjalan plaintext kalau tidak pakai TLS
- **OIDC butuh PKCE** untuk SPA dan mobile app — hindari Implicit Flow yang sudah deprecated

---

## Dependencies

| Package | Dipakai di | Fungsi |
|---|---|---|
| `express` | Semua | HTTP framework |
| `jsonwebtoken` | jwt, oidc | Sign dan verify JWT |
| `bcryptjs` | jwt | Hash dan compare password |
| `express-session` | oidc | Simpan session setelah login |
| `node-fetch` | oidc | HTTP client untuk back-channel token exchange |
| `uuid` | oidc | Generate state, nonce, dan authorization code |
