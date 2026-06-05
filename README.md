<div align="center">

<h1 align="center"><samp>🌸 INORI WHATSAPP BOT</samp></h1>
<p align="center"><em>Next-Generation Multi-Session WhatsApp Daemon built with TypeScript</em></p>

![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Baileys](https://img.shields.io/badge/Baileys-WhatsApp%20Web%20API-25D366?logo=whatsapp&logoColor=white)
![License](https://img.shields.io/github/license/Sayskh/Inori-Bot)

**High-performance, multi-session WhatsApp bot** built on [Baileys](https://github.com/WhiskeySockets/Baileys).
<br/>
<img src="https://media1.tenor.com/m/glWRAhtVU5AAAAAC/cry.gif" alt="Inori Bot" width="220"/>
<br/>

Dibangun dengan arsitektur TypeScript modern — mengutamakan stabilitas,
multi-session handling yang efisien untuk banyak bot, dan CLI dashboard.
</div>

> [!CAUTION]
> Bot ini pakai [Baileys](https://github.com/WhiskeySockets/Baileys) (unofficial WhatsApp Web API). Pake bot = risiko kena **ban permanen** dari WhatsApp. Disarankan pakai nomor cadangan, bukan nomor utama. Segala risiko ditanggung pengguna.

---

## Features

| Feature | Deskripsi |
|---|---|
| **Multi-Session** | Jalankan beberapa bot WhatsApp sekaligus dalam satu process Node.js |
| **CLI Dashboard** | Monitor koneksi, memory usage, jumlah pesan, dan uptime secara real-time |
| **SQLite Storage** | Database ringan untuk state & konfigurasi grup (welcome, anti-link, dll) |
| **Dynamic Config** | Config via `.yml` — perubahan langsung apply tanpa restart |
| **Group Moderation** | Anti-link system otomatis, kick member yang melanggar aturan |
| **Sticker Maker** | Generate stiker dari gambar/video via `ffmpeg` + `node-webpmux` |
| **Media Downloader** | Download dari TikTok, Instagram, Twitter/X, Facebook, YouTube (`.dl <url>`) |
| **Structured Logging** | Logging via `pino` — console output + file persist (`data/logs/bot.log`) |
| **Self-Bot Mode** | Bot merespons command dari akunnya sendiri, dengan loop prevention bawaan |

## Requirements

- ![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-339933?logo=node.js&logoColor=white) 
- ![FFmpeg](https://img.shields.io/badge/FFmpeg-required-007808?logo=ffmpeg&logoColor=white) untuk media processing & sticker conversion

## Installation

```bash
# 1. Clone repo
git clone https://github.com/Sayskh/Inori-Bot.git
cd Inori-Bot

# 2. Install dependencies
npm install

# 3. Setup environment
cp .env.example .env
```

Edit file `.env` sesuai kebutuhan:

```env
BOT_NAME=Inori
PREFIX=.
DEV=628xxxxxxxxxx
API_URL=https://apicobalt.mgytr.top/
BLOCK_DMS=true
SELF_BOT=false
```

> [!IMPORTANT]
> **Setup `API_URL` (Fitur Download):**
> Agar fitur download video/media (`.download`) dapat berfungsi, bot memerlukan Cobalt API yang aktif.
> 
> * **Mengapa tidak menggunakan instance resmi (`api.cobalt.tools`)?** Instance resmi menggunakan proteksi Turnstile (anti-bot) sehingga tidak dapat diakses langsung oleh bot WhatsApp.
> * **Panduan Konfigurasi:**
>   1. Cari server alternatif yang aktif melalui **[cobalt.directory](https://cobalt.directory)**.
>   2. Pilih server dengan indikator **hijau (skor 100%)** yang tidak memerlukan autentikasi (tanpa tanda JWT/kunci API).
>   3. Salin URL server tersebut dan gunakan sebagai nilai `API_URL` di file `.env`.
> 
> *Catatan: Nilai default `https://apicobalt.mgytr.top/` sudah diuji dan dapat langsung digunakan. Jika fitur download berhenti berfungsi di kemudian hari, Anda cukup memperbarui variabel tersebut dengan server aktif yang baru dari direktori di atas.*

## Usage

```bash
# Development (hot-reload)
npm run dev

# Production
npm run build
npm start
```

### Menambahkan Session

Setelah bot manager jalan, tambahkan sesi baru lewat CLI:

```
bot> :add <session_name>
```

Scan QR Code yang muncul pakai fitur **Linked devices** di WhatsApp.

Atau langsung saat boot:
```bash
npm start add <session_name>
```

## CLI Commands

| Command | Fungsi |
|---|---|
| `:status` | Dashboard lengkap (memory, sessions, metrics) |
| `:add <name>` | Tambah & pair session WhatsApp baru |
| `:del <name>` | Hapus session permanen + clear state |
| `:restart <name>` | Restart session tertentu |
| `:clean` | Bersihkan semua session `Disconnected` |
| `:logs [n]` | Lihat *n* baris terakhir log (default: 10) |
| `:clear` | Clear terminal |
| `:exit` | Stop bot gracefully |

## Configuration

Config dikelola lewat file YAML di `src/config/`:

| File | Fungsi |
|---|---|
| `admin.yml` | Template moderasi grup (welcome, goodbye, promote, kick) |
| `menu.yml` | Kategorisasi command & struktur menu |
| `dev.yml` | Broadcast template & dev settings |

### Template Variables

Pesan template seperti `setwelcome`, `setgoodbye`, dan `setclose` mendukung variabel.

Lihat **[VARIABLES.md](VARIABLES.md)** untuk daftar lengkap variabel yang tersedia (`@user`, `@group`, `@time`, dll) beserta contoh penggunaannya.

## Contributing

Kontribusi dalam bentuk *pull request* sangat kami apresiasi! Untuk perubahan berskala besar atau modifikasi arsitektur utama, mohon buat *issue* terlebih dahulu guna mendiskusikan rencana perubahan yang diusulkan.

## License

Licensed under the [MIT License](LICENSE).
