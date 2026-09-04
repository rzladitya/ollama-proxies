# CHANGELOG

## v2.1.0 — Embedding Router, Reset Password, Perbaikan Build

Tidak ada breaking change pada `/v1/chat/completions` maupun skema database yang
sudah ada. Upgrade cukup dengan pull + build + restart; migrasi tabel baru jalan
otomatis saat startup.

> **Catatan versi:** `package.json` masih `2.0.0`. Naikkan ke `2.1.0` saat siap
> rilis — badge versi di UI sekarang membaca dari `package.json`, jadi ikut
> otomatis tanpa perlu diedit terpisah.

---

### Fitur Baru

#### Media Providers → Embedding

Menu baru **SYSTEM → Media Providers** di sidebar, berisi enam submenu. Baru
**Embedding** yang aktif; Text to Image, Text To Speech, Speech To Text, Video,
dan Web Fetch & Search tampil bergembok dan tidak bisa diklik.

Provider yang didukung baru **OpenRouter**. 13 provider lain tampil sebagai kartu
redup "Coming soon" — dan penguncian ditegakkan di server, bukan sekadar CSS:

```
POST /api/admin/embedding/connections {"providerId":"openai"}
→ 400 "Provider 'OpenAI' is not available yet"
```

**Endpoint publik baru:**

| Endpoint | Guna |
|----------|------|
| `POST /v1/embeddings` | OpenAI-compatible, dijaga proxy key `sk-proxy-…` yang sama dengan chat |
| `GET /v1/embeddings/models` | Katalog model embedding yang dilayani gateway |

Satu base URL dan satu kredensial untuk chat maupun embedding.

```bash
curl http://localhost:11435/v1/embeddings \
  -H "Authorization: Bearer sk-proxy-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"openrouter/openai/text-embedding-3-small","input":"halo"}'
```

**Routing.** Koneksi dipilih berurutan prioritas, atau bergilir bila Round Robin
menyala. Koneksi yang dijawab 401/403 ditandai `INVALID` (pesan errornya tampil di
kartu) lalu koneksi berikutnya dicoba; error 400 menghentikan percobaan karena
akan gagal sama saja di semua koneksi.

**Katalog model dikurasi manual.** `GET /api/v1/models` milik OpenRouter
mengembalikan **nol** model embedding, jadi tidak ada yang bisa disinkronkan
otomatis. Katalog di-seed 4 model saat boot pertama, setelah itu milik operator.

Seeding hanya jalan kalau katalog provider **kosong sama sekali**. Artinya
menghapus sebagian model bersifat permanen, tapi menghapus **semuanya** akan
memunculkan kembali 4 model bawaan pada restart berikutnya — anggap itu jalan
pintas "reset ke default", bukan bug.

**Testing.** Tombol **Test** per model (1-klik) dan **Test Console** untuk input
dan `dimensions` kustom. Keduanya lewat pool koneksi sungguhan, jadi hasil hijau
berarti jalur routing-nya benar — bukan cuma kredensialnya valid.

**Tabel baru:** `embedding_connections`, `embedding_models`.
**Settings key baru:** `embedding_config:<providerId>`.

#### Reset password admin

**Settings → Admin Password** — ganti password tanpa mengedit `.env` dan restart.
Butuh password lama, minimal 8 karakter, dengan konfirmasi.

Disimpan sebagai hash **scrypt bersalt** (bukan SHA-256): proxy key itu 32 byte
acak sehingga SHA-256 memadai, tapi password pilihan manusia beruntropi rendah dan
harus tahan serangan kamus.

> **Penting — kredensial pemulihan.** Nilai `OLLAMA_PROXY_ADMIN_SECRET` di `.env`
> **tetap berfungsi** setelah password diganti. Ini disengaja: tanpanya, password
> dashboard yang terlupa hanya bisa dipulihkan dengan mengedit SQLite langsung.
> Untuk benar-benar mencabut yang lama, ubah nilai di `.env` lalu restart.

**Settings key baru:** `admin_secret_hash`.

---

### Perbaikan Build & Deployment

Tiga hal ini membuat clone segar dan CI gagal total di langkah pertama. Tidak
pernah terlihat di mesin yang sudah pernah build, karena `dist/` sudah ada.

| Fix | Detail |
|-----|--------|
| Urutan build salah | `package.json` membangun `routing-core` **sebelum** `ollama-client`, padahal `routing-core` mengimpornya → `TS2307` di clone segar |
| `tsc -b` tidak pernah berfungsi | Root `tsconfig.json` punya `references` tapi tidak ada paket yang `composite: true`, jadi `npm run typecheck`/`lint` gagal dari nol. Sekarang `composite` aktif + graf `references` per paket |
| Dockerfile membuang hasil build | Stage `builder` menjalankan `npm run build` lalu hasilnya **dibuang** — tidak ada `COPY --from=builder`. Image hanya berisi aplikasi kalau host kebetulan sudah build. Ditambah `.dockerignore` supaya `dist/` dan `node_modules` host tidak mencemari image |
| Container `healthy` tapi tak terjangkau | `env_file` menimpa `ENV` Dockerfile, jadi server bind ke `127.0.0.1` **di dalam** namespace container. Healthcheck lolos karena diprobe dari dalam. `docker-compose.yml` kini memaksa `OLLAMA_PROXY_HOST=0.0.0.0` |
| `rm -rf dist` merusak build berikutnya | Efek samping `composite`: `tsconfig.tsbuildinfo` yang tertinggal membuat `tsc` melewatkan emit. `tsBuildInfoFile` kini di dalam `dist/`, jadi keduanya selalu terhapus bersamaan |

---

### Security Fixes

| Fix | Detail |
|-----|--------|
| Endpoint login tanpa rate-limit | `/api/admin/auth/login` dikecualikan dari brute-force check — terukur **60 tebakan dalam 214 ms tanpa satu pun ditolak**. Lockout kini ditegakkan di dalam route login itu sendiri |
| Lockout mengunci admin yang sah | Setelah 10 kegagalan, secret yang **benar** pun ditolak 429. Urutan dibalik: secret benar selalu lolos, lockout hanya berlaku untuk yang salah |
| `request.ip` salah di balik reverse proxy | `trustProxy` tidak pernah dikonfigurasi, jadi seluruh klien berbagi satu penghitung lockout. Env baru `OLLAMA_PROXY_TRUST_PROXY` (default `false`) |
| Panjang secret bocor | `safeEqual` melakukan `if (a.length !== b.length) return false` sebelum `timingSafeEqual`. Kedua sisi kini di-hash dulu |
| Password default diiklankan | Fallback `"ollama"` di route login (kode mati — zod mewajibkan min 8 karakter) dan teks "Default password: ollama" di halaman login, keduanya dihapus |

> `OLLAMA_PROXY_TRUST_PROXY` sengaja default `false`. Mengaktifkannya saat **tidak**
> di balik reverse proxy justru membuat klien bisa memalsukan IP sendiri lewat
> `X-Forwarded-For`.

---

### Perbaikan Telemetri & Data

| Fix | Detail |
|-----|--------|
| Token streaming tidak terhitung | Setiap request streaming tercatat `in=null, out=null`. Ollama Cloud tidak mengirim `usage` di chunk SSE kecuali diminta — proxy kini mengirim `stream_options: {include_usage: true}`. Chunk usage-nya hanya diteruskan ke klien bila klien sendiri memintanya |
| Test embedding tidak muncul di Console Log | Test dari dashboard tidak menulis `request_logs`, jadi baris terbaru yang terlihat adalah request lama — terbaca seolah model yang salah yang jalan |
| Embedding tanpa atribusi koneksi | `/v1/embeddings` tidak mencatat koneksi mana yang melayani |
| Console Log mengarang nama akun | `finalAccountId` kosong dirender sebagai literal `"Ollama Acc 1"`, mengaitkan request ke akun yang tidak pernah menyentuhnya. Sekarang `—` |
| Cached tokens fiktif | `cachedTokens = inputTokens × 0.85` ditampilkan sebagai data terukur. Dihapus; kartunya diganti **TOTAL TOKENS** |
| Email akun dikarang | Quota Tracker menyusun `<nama>@ollama.cloud` dari nama akun. Dihapus; diganti tier + jumlah slot konkuren |
| Waktu reset statis | `"in 3h 30m"` / `"in 5d 12h"` adalah string mati. Kini dihitung dari request tertua di dalam rolling window |
| Limit kuota & tarif biaya hardcoded | Pindah ke settings key `usage_config`, bisa diatur di **Settings → Usage Accounting** |
| Daftar model kuota hardcoded | Diganti model yang benar-benar dimiliki akun, dengan hitungan request nyata |

---

### Perubahan Perilaku

Bentuk response admin API berubah. Hanya dikonsumsi SPA bawaan, tapi kalau kamu
punya skrip yang membacanya:

| Endpoint | Perubahan |
|----------|-----------|
| `GET /api/admin/analytics` | `cachedTokens` **dihapus**; `totalTokens` dan `costRatesConfigured` ditambahkan. `modelUsageList[]` kehilangan `cachedTokens` dan `cachedCost` |
| `GET /api/admin/quota` | `accounts[].email` **dihapus**; `maxConcurrency` ditambahkan. `accounts[].models[]` kini hanya `{modelId, name, used}` — `limit`, `remaining`, `remainingPercent`, `status` dihapus. Response menambah `limitsSource` dan `window` |

**Estimasi biaya sekarang `$0.00` sampai kamu isi tarifnya.** Sebelumnya memakai
$0.50/$1.50 per juta token — angka yang bukan harga Ollama Cloud. Isi di
**Settings → Usage Accounting** kalau butuh estimasi.

---

### Perbaikan UI

| Fix | Detail |
|-----|--------|
| Badge versi melenceng | Menampilkan `v1.0` sementara `package.json` sudah `2.0.0`. Kini disuntik dari `package.json` saat build, jadi tidak bisa melenceng lagi |
| Halaman login berantakan | Subjudul campur bahasa, placeholder `Default: ollama`, catatan `.env`, dan footer "Secured with AES-256 and Bearer Tokens" dihapus. Kini hanya judul, field Password, dan tombol Sign In |
| Tooltip mati di seluruh aplikasi | `Button` di `components/ui` menerima prop `title` tapi tidak pernah meneruskannya ke elemen `<button>` |

---

### Testing

Suite e2e sebelumnya **0 dari 6 lolos** — rusak di tiga sisi sekaligus: tidak ada
langkah login, judul/label halaman sudah berganti nama sejak spec ditulis, dan tes
API tidak mengirim header admin. Sekarang **22 tes lolos**, mencakup pengerasan
auth, kejujuran data quota/analytics, dan seluruh alur embedding.

Unit test tetap 124 lolos.

---

### Known Limitations

#### Katalog model tier masih hardcoded

`FREE_TIER_MODELS` di `routes/admin/accounts.ts` membuang model upstream yang
tidak ada di allowlist-nya — pada akun uji, **13 dari 19 model** dibuang diam-diam
tanpa log. Logikanya juga hanya mengecek `tier === "pro"`, jadi akun `max` dan
`team` ikut terkena filter free. **Belum diperbaiki.**

#### Round-robin embedding masih in-memory

Kursor round-robin per provider disimpan di memori satu proses, sama seperti
sticky lease dan counter chat. Multi-instance akan memutar sendiri-sendiri.

#### Restart wajib setelah build ulang web

`@fastify/static` dipakai dengan `wildcard: false`, jadi daftar berkas didaftarkan
saat startup. Setelah `npm run build` yang mengubah bundle web, **server harus
di-restart** — kalau tidak, aset ber-hash baru jatuh ke SPA fallback dan halaman
tampil kosong.

#### `npm run dev` butuh paket ter-build lebih dulu

Server dev (`tsx watch`) tetap mengimpor workspace package lewat `dist`-nya. Dari
clone segar, jalankan `npm run build` dulu (atau minimal build lima paket di
`packages/`), baru `npm run dev`.

---

### Upgrade dari Instalasi Lama (data lama tetap utuh)

Untuk server yang sudah jalan dan punya `data/ollama-proxy.db` berisi akun, proxy
key, dan riwayat request.

#### Apa yang terjadi otomatis

Migrasi berjalan sendiri saat startup dan **tidak menghapus apa pun**:

1. `backupDatabase()` menyalin DB ke `ollama-proxy.db.bak.<timestamp>` **sebelum**
   migrasi disentuh.
2. `runMigrations()` hanya menjalankan `CREATE TABLE IF NOT EXISTS` dan
   `ALTER TABLE … ADD COLUMN`. Tidak ada `DROP`, tidak ada `ALTER … DROP COLUMN`,
   tidak ada perubahan tipe kolom. Tabel lama tidak disentuh sama sekali.
3. Tabel baru `embedding_connections` dan `embedding_models` dibuat.
4. Katalog embedding di-seed 4 model OpenRouter (hanya kalau kosong).
5. `bootstrapDefaults()` dan `reencryptApiKeys()` idempotent — aman diulang.

**Sudah diuji.** Sebuah DB v2.0.0 (1 akun, 16 proxy key, 6 model, 6 account_models,
7 baris log) dijalankan dengan build v2.1.0:

```
[startup] Database backed up to data/ollama-proxy.db.bak.2026-09-04T09-14-40-020Z
[startup] Seeded 4 embedding model(s) for OpenRouter
```

Hasil sesudahnya: seluruh baris lama utuh (1 / 16 / 6 / 6 / 7), dua tabel baru
muncul, dan **API key upstream lama masih bisa didekripsi** — dites dengan panggilan
sungguhan ke Ollama Cloud, 19 model, 371 ms. Tidak ada data yang hilang.

#### ⚠️ Backup manual: jangan salin file `.db` saja

Database berjalan dalam **mode WAL**. Perubahan terbaru ada di `-wal`, belum tentu
di `.db`. Menyalin `.db` saja saat server masih jalan menghasilkan backup rusak.

Ini bukan teori — diukur pada instalasi uji di atas:

```
.db       122.880 bytes
.db-wal   152.472 bytes   <- lebih besar dari .db-nya sendiri

salinan yang hanya .db  ->  tabel embedding_models bahkan tidak ada
```

**Cara benar — hentikan server dulu, baru salin ketiganya:**

```bash
# 1. hentikan dulu supaya WAL ter-checkpoint
sudo systemctl stop ollama-proxy      # atau: docker compose down

# 2. salin ketiga file, bukan hanya .db
cp data/ollama-proxy.db      /backup/ollama-proxy.db
cp data/ollama-proxy.db-wal  /backup/ 2>/dev/null || true
cp data/ollama-proxy.db-shm  /backup/ 2>/dev/null || true
```

**Atau, tanpa menghentikan server** — `VACUUM INTO` menulis satu file utuh (isi WAL
sudah ikut) dan tidak menyentuh database sumber:

```bash
sqlite3 data/ollama-proxy.db "VACUUM INTO '/backup/ollama-proxy-$(date +%F).db'"
```

Kalau `sqlite3` CLI tidak terpasang, Node di server sudah punya drivernya:

```bash
node -e "require('better-sqlite3')('data/ollama-proxy.db',{readonly:true})\
  .prepare(\"VACUUM INTO ?\").run('/backup/ollama-proxy.db')"
```

Hasilnya diuji: satu file 122.880 bytes berisi 11 tabel lengkap dengan seluruh
barisnya — tanpa perlu file `-wal` pendamping.

Simpan juga `.env` — **tanpa `OLLAMA_PROXY_ENCRYPTION_KEY` yang sama, semua API key
upstream di database tidak bisa didekripsi lagi.** Backup database saja tidak cukup.

#### Cara A — deploy langsung (systemd / pm2 / manual)

```bash
# 1. backup (lihat bagian di atas) — lakukan dulu, jangan dilewat
sqlite3 data/ollama-proxy.db ".backup '/backup/ollama-proxy-$(date +%F).db'"
cp .env /backup/.env.bak

# 2. hentikan service
sudo systemctl stop ollama-proxy

# 3. ambil kode baru
git pull

# 4. install + build
#    build sekarang berhasil dari clone segar; kalau pernah gagal, hapus dist dulu:
#    rm -rf packages/*/dist apps/*/dist
npm install
npm run build

# 5. (opsional) hanya kalau di balik reverse proxy
echo "OLLAMA_PROXY_TRUST_PROXY=true" >> .env

# 6. jalankan — migrasi + backup otomatis terjadi di sini
sudo systemctl start ollama-proxy
sudo journalctl -u ollama-proxy -n 30
```

`.env` yang lama **dipakai apa adanya**. Tidak ada variabel wajib yang baru;
`OLLAMA_PROXY_TRUST_PROXY` opsional dan default `false`.

#### Cara B — Docker Compose

Volume `./data` sudah bind-mount, jadi database ikut selamat lintas rebuild.

```bash
# 1. hentikan dulu — WAL ter-checkpoint saat container berhenti dengan bersih
docker compose down

# 2. backup seluruh folder data (ikut .db, -wal, -shm) plus .env
cp -a data /backup/data-$(date +%F)
cp .env   /backup/.env.bak

# 3. ambil kode baru
git pull

# 4. build ulang image dan jalankan — migrasi terjadi di sini
docker compose up -d --build

# 5. cek migrasi
docker compose logs --tail=40 | grep -E "startup|Seeded|backed up"
```

Dua hal yang berubah di sisi Docker dan **tidak perlu kamu kerjakan manual lagi**:

- `docker-compose.yml` sekarang memaksa `OLLAMA_PROXY_HOST=0.0.0.0` di dalam
  container. Kalau dulu kamu mengakalinya dengan mengedit `.env`, nilai itu boleh
  dikembalikan ke `127.0.0.1` — pengaturan lokal jadi aman lagi.
- Image sekarang benar-benar dibangun di dalam stage `builder`. Tidak perlu lagi
  `npm run build` di host sebelum `docker compose build`.

#### Verifikasi setelah upgrade

```bash
curl -s localhost:11435/health/ready
# {"status":"ok","checks":{"db":"ok","encryption":"ok","accepting_requests":"ok"}}
```

Di dashboard:

- **Providers** — semua akun lama masih ada; klik **Test** pada satu akun. Hijau
  berarti kunci enkripsi masih cocok dan kredensial lama terbaca.
- **API Keys** — jumlah key sama seperti sebelum upgrade. Key lama tetap berlaku,
  klien yang sudah ada tidak perlu diubah.
- **Console Log** — riwayat lama masih ada.
- **Media Providers → Embedding** — 4 model bawaan muncul; tambahkan koneksi
  OpenRouter lalu klik **Test**.

#### Kalau perlu rollback

v2.1.0 tidak mengubah satu pun tabel lama, jadi database hasil upgrade **masih bisa
dibaca versi sebelumnya**. Tabel dan settings key baru akan diabaikan begitu saja.

```bash
sudo systemctl stop ollama-proxy
git checkout <tag-atau-commit-lama>
npm install && npm run build
sudo systemctl start ollama-proxy
```

Satu catatan: kalau kamu sudah mengganti password lewat **Settings → Admin
Password**, versi lama tidak mengenal `admin_secret_hash` dan hanya menerima
`OLLAMA_PROXY_ADMIN_SECRET` dari `.env`. Pastikan kamu masih tahu nilainya.

Restore penuh dari backup, kalau memang diperlukan:

```bash
sudo systemctl stop ollama-proxy
rm -f data/ollama-proxy.db data/ollama-proxy.db-wal data/ollama-proxy.db-shm
cp /backup/ollama-proxy-<tanggal>.db data/ollama-proxy.db
sudo systemctl start ollama-proxy
```

---

### Migration Checklist

- [ ] **Backup database dengan benar** — `sqlite3 … ".backup"`, atau hentikan server lalu salin `.db` + `-wal` + `-shm`. Menyalin `.db` saja **tidak cukup**
- [ ] **Backup `.env`** — `OLLAMA_PROXY_ENCRYPTION_KEY` yang hilang = semua API key upstream tidak bisa dipulihkan
- [ ] Hentikan service lama sebelum menarik kode baru
- [ ] `npm install && npm run build` — sekarang berhasil dari clone segar
- [ ] `npm test` (124) dan `npx playwright test` (22) hijau
- [ ] Tambahkan `OLLAMA_PROXY_TRUST_PROXY=true` di `.env` **hanya** kalau di balik reverse proxy
- [ ] Start server; cek log memuat `Database backed up to …` dan `Seeded 4 embedding model(s)`
- [ ] `curl localhost:11435/health/ready` → `db`, `encryption`, `accepting_requests` semuanya `ok`
- [ ] Buka **Providers**, klik **Test** pada akun lama — memastikan kunci enkripsi masih cocok
- [ ] Cek jumlah **API Keys** sama seperti sebelum upgrade
- [ ] Docker: `.env` tidak perlu lagi diakali untuk `HOST`; boleh dikembalikan ke `127.0.0.1`
- [ ] Isi **Settings → Usage Accounting** kalau butuh estimasi biaya (default 0)
- [ ] Tambahkan koneksi OpenRouter di **Media Providers → Embedding**, lalu klik Test

---

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
