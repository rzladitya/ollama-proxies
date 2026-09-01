# Ollama Proxies (v2.0.0)

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5.3-black.svg)](https://fastify.dev/)
[![React](https://img.shields.io/badge/React-19-cyan.svg)](https://react.dev/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](#license)

**Ollama Proxies** adalah enterprise-grade self-hosted LLM gateway dan admission controller yang mengekspos endpoint tunggal yang **100% kompatibel dengan OpenAI API** (`/v1/chat/completions`, `/v1/models`), dengan mendistribusikan beban secara cerdas ke dalam **pool akun Ollama Cloud**.

Cocok digunakan sebagai gateway upstream untuk aplikasi seperti **Dify**, **OpenCode**, **LangChain**, **LibreChat**, atau klien OpenAI SDK lainnya.

---

## ⚡ Fitur Utama

- **OpenAI-Compatible Drop-In Replacement**: Mendukung streaming (Server-Sent Events), non-streaming, `tools/tool_calling`, JSON mode, dan model catalog listing.
- **Per-Account Concurrency Semaphore**: Menghormati batas kapasitas resmi Ollama Cloud:
  - `Free Tier`: 1 concurrent slot
  - `Pro Tier`: 3 concurrent slots
  - `Max / Team`: 10 concurrent slots
  - *Mencegah antrean tersembunyi upstream yang menyebabkan TTFT lambat (20–40s).*
- **Bounded Admission Controller**: Menahan lonjakan request di proxy queue internal dengan deadline yang jelas (`queueMs`) alih-alih membiarkan request macet di upstream.
- **Intelligent Load Balancing & Failover**:
  - Soft-sticky sessions dengan fallback dinamis saat akun terikat sedang penuh.
  - Automatic retry dengan exponential backoff + jitter & penghormatan header `Retry-After` upstream (HTTP 429).
  - Health state machine (`ACTIVE` → `DEGRADED` → `COOLDOWN` → `INVALID`).
- **Security & Data Isolation**:
  - Enkripsi kredensial akun menggunakan **AES-256-GCM** dengan KDF **scrypt**.
  - Kunci API downstream (`sk-proxy-...`) disimpan dalam bentuk **SHA-256 hash**.
  - Identitas user/session selalu di-hash sebelum dijadikan lease key (tidak ada PII tersimpan di state routing).
  - Rate limiting (RPM) dan concurrency limit yang di-enforce secara aktif per API key.
- **Modern Admin Dashboard**:
  - Web SPA terintegrasi (React 19 + Tailwind CSS) untuk manajemen akun, proxy keys, model testing 1-klik, dan telemetri performa (TTFT, tokens/sec, latency).

---

## 🏗️ Arsitektur Request Flow

```mermaid
flowchart LR
    A["Client / Dify / SDK"] --> B["Auth & Validation"]
    B --> C["Proxy Rate Limiter"]
    C --> D["Admission Queue (Bounded)"]
    D --> E["Pool Scheduler & Soft Sticky"]
    E --> F["Per-Account Semaphore"]
    F --> G["Ollama Cloud Upstream"]
    G --> H["SSE Stream / JSON Response"]
```

---

## 🚀 Quick Start (Docker Compose)

### 1. Clone Repository
```bash
git clone https://github.com/rzladitya/ollama-proxies.git
cd ollama-proxies
```

### 2. Konfigurasi Environment
Salin file `.env.example` ke `.env`:
```bash
cp .env.example .env
```

Generate **Encryption Key** (32-byte hex) dan tentukan **Admin Secret**:
```bash
# Generate encryption key acak
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Isi ke dalam `.env`:
```env
OLLAMA_PROXY_HOST=0.0.0.0
OLLAMA_PROXY_PORT=11435
OLLAMA_PROXY_DATA_DIR=./data

# Wajib (min 16 karakter atau 64 hex chars)
OLLAMA_PROXY_ENCRYPTION_KEY=your-generated-32-byte-hex-key-here

# Secret untuk login Admin Dashboard & Admin API (min 8 karakter)
OLLAMA_PROXY_ADMIN_SECRET=your-secure-admin-secret-here

OLLAMA_PROXY_LOG_LEVEL=info
OLLAMA_PROXY_REQUEST_TIMEOUT_SECONDS=120
OLLAMA_PROXY_MAX_ATTEMPTS=3
```

### 3. Jalankan dengan Docker
```bash
docker compose up -d --build
```

Buka dashboard di browser: `http://localhost:11435` dan login menggunakan `OLLAMA_PROXY_ADMIN_SECRET` Anda.

---

## 💻 Menjalankan Secara Lokal (Development)

### Prasyarat
- Node.js `>= 20.0.0`
- npm `>= 9.0.0`

### Langkah-langkah
```bash
# 1. Install dependencies di seluruh workspace
npm install

# 2. Build semua shared packages
npm run build

# 3. Jalankan server backend & frontend web concurrent
npm run dev
```

- **Backend Gateway**: `http://localhost:11435`
- **Frontend Vite Dev**: `http://localhost:5173`

### Menjalankan Test Suite
```bash
npm test
```
*Total 124 unit, contract, dan smoke test mencakup failover, concurrency semaphore, timeout classification, dan re-encryption.*

---

## 🔌 Menggunakan API di Klien / Dify

### 1. Buat API Key di Dashboard
1. Masuk ke menu **API Keys** di Admin Dashboard.
2. Klik **Generate New Key**.
3. Simpan secret key `sk-proxy-...` (hanya ditampilkan sekali).

### 2. Hubungkan ke Klien OpenAI / Dify
- **Base URL**: `http://<ip-server>:11435/v1`
- **API Key**: `sk-proxy-...`

#### Contoh cURL Chat Completions:
```bash
curl http://localhost:11435/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-proxy-your-key-here" \
  -d '{
    "model": "gpt-oss:120b",
    "messages": [
      { "role": "user", "content": "Jelaskan konsep zero-knowledge proof secara singkat." }
    ],
    "stream": true
  }'
```

#### Contoh cURL List Models:
```bash
curl http://localhost:11435/v1/models \
  -H "Authorization: Bearer sk-proxy-your-key-here"
```

---

## 🔒 Production & Reverse Proxy (Nginx)

Ollama Proxy dirancang untuk dijalankan di balik Reverse Proxy dengan enkripsi TLS.

Contoh konfigurasi Nginx:
```nginx
server {
    listen 443 ssl http2;
    server_name proxy-ollama.domainanda.com;

    ssl_certificate     /etc/letsencrypt/live/proxy-ollama.domainanda.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/proxy-ollama.domainanda.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:11435;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Sangat penting untuk Server-Sent Events (SSE) streaming:
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_read_timeout 300s;
    }
}
```

---

## 📂 Struktur Monorepo

```
proxy-ollama/
├── apps/
│   ├── server/          # Fastify proxy gateway, auth middleware, scheduler, telemetry
│   └── web/             # React 19 SPA dashboard dengan Tailwind CSS 4
├── packages/
│   ├── shared/          # Enkripsi AES-256 scrypt, hashing, redaction, common types
│   ├── storage/         # SQLite Drizzle schema, automated backup, migrations, bootstrap
│   ├── routing-core/    # Per-account semaphore, bounded wait queue, health state machine
│   └── ollama-client/   # HTTP client Ollama Cloud API & error classifier
├── data/                # SQLite storage volume (WAL mode)
├── tests/               # Smoke tests, contract tests & phase verification
├── Dockerfile           # Multi-stage production container
└── docker-compose.yml   # Ready-to-run container deployment
```

---

## 📄 Lisensi

Proyek ini dilisensikan di bawah [MIT License](LICENSE).
