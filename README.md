# TikDown — TikTok Downloader Tanpa Watermark

Website download video TikTok tanpa watermark menggunakan Node.js + Express + yt-dlp.

## Struktur Proyek

```
tiktok-downloader/
├── server.js          # Backend Express
├── package.json
├── public/
│   └── index.html     # Frontend
└── temp/              # Folder sementara (auto-dibuat)
```

## Prasyarat

Pastikan sudah terinstall:
- **Node.js** v16+
- **Python** 3.7+ (untuk yt-dlp)
- **yt-dlp**
- **ffmpeg** (untuk merge video+audio)

## Instalasi

### 1. Install yt-dlp
```bash
pip install yt-dlp
```

Atau update jika sudah punya:
```bash
pip install -U yt-dlp
```

### 2. Install ffmpeg

**Windows:**
Download dari https://ffmpeg.org/download.html, tambahkan ke PATH.

**macOS:**
```bash
brew install ffmpeg
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt install ffmpeg
```

### 3. Install dependencies Node.js
```bash
npm install
```

### 4. Jalankan server
```bash
npm start
```

Server akan berjalan di: http://localhost:3000

Untuk development (auto-reload):
```bash
npm run dev
```

## API Endpoints

### `POST /api/info`
Ambil info video TikTok.

**Body:**
```json
{ "url": "https://www.tiktok.com/@username/video/1234567890" }
```

**Response:**
```json
{
  "title": "Judul video",
  "thumbnail": "https://...",
  "duration": 30,
  "uploader": "username",
  "view_count": 100000,
  "like_count": 5000
}
```

### `POST /api/download`
Download video tanpa watermark.

**Body:**
```json
{ "url": "https://www.tiktok.com/@username/video/1234567890" }
```

**Response:** File MP4 langsung (binary stream)

### `GET /api/health`
Cek status server.

## Deploy ke VPS

Untuk deploy ke server (misal Ubuntu + Nginx):

1. Install Node.js, yt-dlp, ffmpeg di server
2. Upload semua file
3. Jalankan dengan PM2:
   ```bash
   npm install -g pm2
   pm2 start server.js --name tiktok-downloader
   pm2 save
   ```
4. Konfigurasi Nginx sebagai reverse proxy ke port 3000

## Catatan

- Gunakan untuk keperluan pribadi saja
- Hormati hak cipta konten kreator TikTok
- yt-dlp perlu di-update secara berkala: `pip install -U yt-dlp`
