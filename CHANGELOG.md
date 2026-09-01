# CHANGELOG

## v2.0.0 — BREAKING CHANGE

**Jangan deploy di atas database lama tanpa persiapan.**

### Breaking Changes

#### 1. Secret environment variables sekarang wajib

Server **tidak akan start** tanpa:

```
OLLAMA_PROXY_ENCRYPTION_KEY=   # min 16 karakter
OLLAMA_PROXY_ADMIN_SECRET=     # min 8 karakter
```

Generate encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Default `"ollama"` untuk admin secret sudah dihapus. Default dev encryption key sudah dihapus.

#### 2. Encryption key derivation berubah (SHA-256 → scrypt)

Semua `encrypted_api_key` di tabel `upstream_accounts` yang dienkripsi dengan v1 (SHA-256) **tidak bisa didekripsi** oleh v2 (scrypt) tanpa migrasi.

**Proses upgrade:**

1. **Backup database** (otomatis saat startup, atau manual):
   ```bash
   cp data/ollama-proxy.db data/ollama-proxy.db.backup
   cp data/ollama-proxy.db-wal data/ollama-proxy.db-wal.backup  # jika ada
   ```

2. **Set env vars** di `.env`:
   ```
   OLLAMA_PROXY_ENCRYPTION_KEY=<gunakan key yang sama dengan v1>
   OLLAMA_PROXY_ADMIN_SECRET=<secret baru, min 8 chars>
   ```

3. **Start server** — re-encryption otomatis:
   - Startup membuat backup `ollama-proxy.db.bak.<timestamp>`
   - Startup men-decrypt setiap API key dengan legacy SHA-256 KDF
   - Startup men-re-encrypt dengan scrypt KDF
   - Log menampilkan jumlah key yang berhasil dimigrasi
   - Idempotent — jalankan ulang aman, key yang sudah scrypt diskip

4. **Verifikasi** — cek log startup:
   ```
   [startup] Database backed up to data/ollama-proxy.db.bak.2026-09-01T...
   [startup] Re-encrypted 5 API key(s) from legacy KDF
   ```

   Jika ada yang gagal:
   ```
   [startup] WARNING: 2 API key(s) failed re-encryption — check logs
   ```
   Artinya encryption key yang digunakan berbeda dari yang dipakai saat encrypt di v1. Hapus account tersebut dan tambahkan ulang.

#### 3. Routing key sekarang di-hash

`resolveRoutingKey()` sekarang mengembalikan SHA-256 hash, bukan raw value. Ini berarti:
- `X-Proxy-Session-ID` dan `request.user` tidak tersimpan dalam bentuk cleartext
- Sticky lease yang sudah ada di-memory akan reset saat restart (ini sudah terjadi sebelumnya — in-memory only)

### Security Fixes

| Fix | Detail |
|-----|--------|
| Admin brute-force protection | 10 gagal login → 15 menit lockout per IP |
| Timing-safe secret comparison | `timingSafeEqual` untuk admin auth |
| CORS restricted | Non-localhost mode menolak cross-origin |
| Security headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` |
| Request body limit | 1 MiB max |
| Rate limit enforcement | RPM + concurrency limit sekarang benar-benar di-enforce (sebelumnya hanya disimpan di DB, tidak dicek) |
| Retry protection | Exponential backoff + jitter, global deadline, Retry-After header dihormati |
| Timeout classification fix | Custom timeout error sekarang diklasifikasi sebagai `UPSTREAM_TIMEOUT` (retryable), bukan `INTERNAL_ERROR` |

### Reliability Fixes

| Fix | Detail |
|-----|--------|
| Readiness probe diperbaiki | `/health/ready` sekarang cek DB + encryption + shutdown state, return 503 on failure |
| SSE error event | Stream error sekarang mengirim `data: {"error": ...}` sebelum close, bukan silent close |
| Graceful shutdown timeout | 30 detik max drain, lalu force exit |
| Startup validation | Encryption key divalidasi sebelum listener dibuka |

### Known Limitations

#### Single-instance only

Routing state (sticky lease, active request counter, cooldown, health state) disimpan **in-memory**. Artinya:

- **Tidak bisa multi-instance / cluster.** Dua instance akan punya routing state terpisah dan saling tidak tahu.
- **Restart menghapus semua lease.** Sticky session hilang saat proses restart — client akan di-route ke account baru.
- **Crash menghapus active request counter.** Counter akan reset ke 0 saat restart, tapi ini tidak menyebabkan masalah karena counter in-memory selalu dimulai dari 0.

Jika multi-instance diperlukan: simpan routing state di Redis atau shared SQLite. Belum diimplementasi.

#### TLS wajib melalui reverse proxy

Ollama Proxy **tidak menyediakan TLS termination sendiri**. Untuk production:

```
Client → [TLS] → nginx/Caddy/Traefik → [HTTP] → Ollama Proxy (127.0.0.1:11435)
```

Contoh nginx minimal:
```nginx
server {
    listen 443 ssl;
    server_name proxy.example.com;
    ssl_certificate     /etc/ssl/cert.pem;
    ssl_certificate_key /etc/ssl/key.pem;

    location / {
        proxy_pass http://127.0.0.1:11435;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;  # penting untuk SSE streaming
    }
}
```

**Jangan expose port 11435 langsung ke internet.** API key dan admin secret dikirim sebagai Bearer token — tanpa TLS, credentials terekspos.

---

### Migration Checklist

- [ ] Backup database (`cp data/ollama-proxy.db data/ollama-proxy.db.manual-backup`)
- [ ] Set `OLLAMA_PROXY_ENCRYPTION_KEY` (gunakan key yang sama dengan v1)
- [ ] Set `OLLAMA_PROXY_ADMIN_SECRET` (min 8 chars)
- [ ] Start server, cek log re-encryption
- [ ] Verifikasi semua account bisa di-list di admin dashboard
- [ ] Test 1 request non-streaming
- [ ] Test 1 request streaming
- [ ] Siapkan reverse proxy dengan TLS jika belum ada
