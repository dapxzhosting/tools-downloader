const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Pakai os.tmpdir() supaya works di Windows maupun Linux
const os = require("os");
const TEMP_DIR = path.join(os.tmpdir(), "tikdown-temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

function checkYtDlp() {
  return new Promise((resolve) => {
    exec("yt-dlp --version", (err) => resolve(!err));
  });
}

function isValidTikTokUrl(url) {
  return /tiktok\.com\/@[\w.]+\/video\/\d+|vm\.tiktok\.com\/\w+|vt\.tiktok\.com\/\w+/.test(url.split("?")[0]);
}

app.post("/api/info", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL wajib diisi" });
  if (!isValidTikTokUrl(url))
    return res.status(400).json({ error: "URL TikTok tidak valid" });

  const hasYtDlp = await checkYtDlp();
  if (!hasYtDlp)
    return res.status(500).json({ error: "yt-dlp tidak ditemukan." });

  exec(
    `yt-dlp --dump-json --no-playlist "${url}"`,
    { timeout: 30000 },
    (err, stdout, stderr) => {
      if (err) {
        console.error("yt-dlp error:", stderr);
        return res.status(500).json({ error: "Gagal mengambil info video. Cek URL kamu." });
      }
      try {
        const info = JSON.parse(stdout);
        res.json({
          title: info.title || "TikTok Video",
          thumbnail: info.thumbnail,
          duration: info.duration,
          uploader: info.uploader || info.creator,
          view_count: info.view_count,
          like_count: info.like_count,
        });
      } catch {
        res.status(500).json({ error: "Gagal parse info video" });
      }
    }
  );
});

app.post("/api/download", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL wajib diisi" });
  if (!isValidTikTokUrl(url))
    return res.status(400).json({ error: "URL TikTok tidak valid" });

  const hasYtDlp = await checkYtDlp();
  if (!hasYtDlp)
    return res.status(500).json({ error: "yt-dlp tidak ditemukan." });

  const filename = `tiktok_${Date.now()}.mp4`;
  const filepath = path.join(TEMP_DIR, filename);

  const cmd = `yt-dlp -f "best[ext=mp4]" -o "${filepath}" "${url}"`;
  exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
    if (err) {
      console.error("Download error:", stderr);
      return res.status(500).json({ error: "Gagal mendownload video." });
    }
    if (!fs.existsSync(filepath))
      return res.status(500).json({ error: "File tidak ditemukan setelah download." });

    res.download(filepath, "tiktok_nowatermark.mp4", (downloadErr) => {
      fs.unlink(filepath, () => {});
      if (downloadErr) console.error("Send error:", downloadErr);
    });
  });
});

app.post("/api/download-mp3", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL wajib diisi" });
  if (!isValidTikTokUrl(url))
    return res.status(400).json({ error: "URL TikTok tidak valid" });

  const hasYtDlp = await checkYtDlp();
  if (!hasYtDlp)
    return res.status(500).json({ error: "yt-dlp tidak ditemukan." });

  const ts = Date.now();
  const mp4Path = path.join(TEMP_DIR, `tiktok_${ts}.mp4`);
  const mp3Path = path.join(TEMP_DIR, `tiktok_${ts}.mp3`);

  const dlCmd = `yt-dlp -f "best[ext=mp4]" -o "${mp4Path}" "${url}"`;
  exec(dlCmd, { timeout: 60000 }, (err) => {
    if (err || !fs.existsSync(mp4Path)) {
      console.error("Download MP4 error");
      return res.status(500).json({ error: "Gagal mendownload video untuk konversi." });
    }

    const ffmpegCmd = `ffmpeg -i "${mp4Path}" -vn -ab 192k -ar 44100 -y "${mp3Path}"`;
    exec(ffmpegCmd, { timeout: 60000 }, (err2) => {
      fs.unlink(mp4Path, () => {});

      if (err2 || !fs.existsSync(mp3Path)) {
        console.error("ffmpeg error");
        return res.status(500).json({ error: "Gagal mengkonversi ke MP3." });
      }

      res.download(mp3Path, "tiktok_audio.mp3", (downloadErr) => {
        fs.unlink(mp3Path, () => {});
        if (downloadErr) console.error("Send error:", downloadErr);
      });
    });
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "TikTok Downloader API running" });
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`📥 TikTok Downloader siap digunakan!`);
});