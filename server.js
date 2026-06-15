require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const TEMP_DIR = path.join(os.tmpdir(), "videodown-temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

function checkYtDlp() {
  return new Promise((resolve) => {
    exec("yt-dlp --version", (err) => resolve(!err));
  });
}

async function fetchUrl(url, options = {}, timeoutMs = 15000) {
  const { default: fetch } = await import("node-fetch");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isValidTikTokUrl(url) {
  const clean = url.split("?")[0];
  return (
    /tiktok\.com\/@[\w.]+\/(video|photo)\/\d+/.test(clean) ||
    /vm\.tiktok\.com\/\w+/.test(clean) ||
    /vt\.tiktok\.com\/\w+/.test(clean) ||
    /tiktok\.com\/t\/\w+/.test(clean) ||
    /tiktok\.com\/@[\w.]+\/photo\/?$/.test(clean) ||
    /tiktok\.com\/@[\w.]+/.test(clean)
  );
}
function isValidInstagramUrl(url) {
  const clean = url.split("?")[0];
  return (
    /instagram\.com\/(p|reel|tv|reels)\/[\w-]+/.test(clean) ||
    /instagram\.com\/stories\/[\w.]+\/\d+/.test(clean) ||
    /instagram\.com\/stories\/[\w.]+\/?$/.test(clean) ||
    /instagram\.com\/share\/[\w-]+/.test(clean)
  );
}
function isValidCapCutUrl(url) {
  return /capcut\.com\/(v|video|t)\/[\w-]+|capcut\.com\/share\//.test(url.split("?")[0]);
}
function detectPlatform(url) {
  if (isValidTikTokUrl(url)) return "tiktok";
  if (isValidInstagramUrl(url)) return "instagram";
  if (isValidCapCutUrl(url)) return "capcut";
  return null;
}
function platformLabel(p) {
  return { tiktok: "TikTok", instagram: "Instagram", capcut: "CapCut" }[p] || p;
}
function isTikTokShortUrl(url) {
  return /vm\.tiktok\.com|vt\.tiktok\.com|tiktok\.com\/t\//.test(url);
}

async function resolveShortUrl(url) {
  if (!isTikTokShortUrl(url)) return url;
  try {
    const { default: fetch } = await import("node-fetch");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15" },
      signal: controller.signal,
    });
    const final = resp.url || url;
    console.log(`[resolve] ${url} → ${final}`);
    return final;
  } catch (e) {
    console.warn("[resolve] failed:", e.message);
    return url;
  }
}

async function tikwmFetch(url) {
  const clean = url.split("?")[0];
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(clean)}&hd=1`;
  console.log(`[tikwm] →`, clean);
  const resp = await fetchUrl(apiUrl, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
  }, 15000);
  if (!resp.ok) throw new Error(`tikwm HTTP ${resp.status}`);
  const raw = await resp.text();
  console.log(`[tikwm] raw (200):`, raw.slice(0, 300));
  const json = JSON.parse(raw);
  if (!json || json.code !== 0) throw new Error(json?.msg || "tikwm error");
  return json.data;
}

async function cobaltFetch(url) {
  const apiUrl = process.env.COBALT_API_URL || process.env.API_URL || "https://api.cobalt.tools";
  console.log(`[cobalt] → ${url} (via ${apiUrl})`);

  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  if (process.env.COBALT_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.COBALT_API_KEY}`;
  }

  const resp = await fetchUrl(`${apiUrl}/`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url, videoQuality: "max", audioFormat: "mp3", filenameStyle: "basic" }),
  }, 20000);
  const raw = await resp.text();
  console.log(`[cobalt] HTTP ${resp.status}, raw:`, raw.slice(0, 300));
  if (!resp.ok) throw new Error(`cobalt HTTP ${resp.status}: ${raw.slice(0, 100)}`);
  const json = JSON.parse(raw);
  if (!json || !["stream", "redirect", "tunnel", "picker"].includes(json.status)) {
    throw new Error(json?.error?.code || json?.text || `cobalt status: ${json?.status}`);
  }
  return json;
}

app.get("/api/proxy-thumbnail", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Missing url");
  try {
    const r = await fetchUrl(url, {
      headers: { "Referer": "https://www.tiktok.com/", "User-Agent": "Mozilla/5.0" },
    }, 10000);
    if (!r.ok) return res.status(r.status).send("Fetch failed");
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=3600");
    r.body.pipe(res);
  } catch (e) {
    res.status(500).send("Proxy error");
  }
});

app.post("/api/info", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL wajib diisi" });

  const platform = detectPlatform(url);
  if (!platform) return res.status(400).json({ error: "URL tidak valid. Gunakan link TikTok, Instagram Reel/Post." });

  if (platform === "tiktok") {
    try {
      const data = await tikwmFetch(url);
      const images = data.images || [];
      const isPhoto = images.length > 0;
      const rawThumb = data.cover || (isPhoto ? images[0] : null) || null;
      return res.json({
        platform: "tiktok",
        title: data.title || (isPhoto ? "TikTok Photo Post" : "TikTok Video"),
        thumbnail: rawThumb ? `/api/proxy-thumbnail?url=${encodeURIComponent(rawThumb)}` : null,
        duration: isPhoto ? null : (data.duration || null),
        uploader: data.author?.nickname || data.author?.unique_id || null,
        view_count: data.play_count || null,
        like_count: data.digg_count || null,
        content_type: isPhoto ? (images.length > 1 ? "carousel" : "image") : "video",
        image_count: isPhoto ? images.length : 0,
      });
    } catch (e) {
      console.error("[info/tiktok] tikwm error:", e.message);
      const resolved = await resolveShortUrl(url);
      if (/\/photo\//.test(resolved)) {
        return res.status(500).json({ error: "Gagal mengambil info foto TikTok. Pastikan postingan publik." });
      }
      return new Promise((resolve) => {
        exec(`yt-dlp --dump-json --no-playlist "${resolved}"`, { timeout: 30000 }, (err, stdout, stderr) => {
          if (err || !stdout.trim()) {
            console.error("[info/yt-dlp]", stderr);
            return res.status(500).json({ error: "Gagal mengambil info TikTok." });
          }
          try {
            const info = JSON.parse(stdout.trim().split("\n")[0]);
            return res.json({
              platform: "tiktok",
              title: info.title || "TikTok Video",
              thumbnail: info.thumbnail || null,
              duration: info.duration || null,
              uploader: info.uploader || null,
              view_count: info.view_count || null,
              like_count: info.like_count || null,
              content_type: "video",
              image_count: 0,
            });
          } catch {
            return res.status(500).json({ error: "Gagal memproses info TikTok." });
          }
          resolve();
        });
      });
    }
  }

  if (platform === "instagram" || platform === "capcut") {
    try {
      const data = await cobaltFetch(url);
      const isPicker = data.status === "picker";
      const items = data.picker || [];

      return res.json({
        platform,
        title: `${platformLabel(platform)} Post`,
        thumbnail: isPicker && items[0]?.thumb ? `/api/proxy-thumbnail?url=${encodeURIComponent(items[0].thumb)}` : null,
        duration: null,
        uploader: null,
        view_count: null,
        like_count: null,
        content_type: isPicker ? "carousel" : "video",
        image_count: isPicker ? items.length : 0,
        _cobalt_url: !isPicker ? (data.url || null) : null,
        _cobalt_picker: isPicker ? items : null,
      });
    } catch (e) {
      console.error(`[info/${platform}] cobalt error:`, e.message);
      const isStories = /stories/.test(url);
      return res.status(500).json({
        error: isStories
          ? `Gagal mengambil info Stories ${platformLabel(platform)}. Stories harus dibuka dulu agar URL-nya valid, atau coba copy link langsung dari browser.`
          : `Gagal mengambil info dari ${platformLabel(platform)}. Pastikan URL publik dan valid.`
      });
    }
  }

  return res.status(400).json({ error: "Platform tidak didukung." });
});

app.post("/api/download", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL wajib diisi" });

  const platform = detectPlatform(url);
  if (!platform) return res.status(400).json({ error: "URL tidak valid." });

  if (platform === "tiktok") {
    try {
      const data = await tikwmFetch(url);
      if ((data.images || []).length > 0) {
        return res.status(400).json({ error: "Ini postingan foto. Gunakan tombol Download Foto.", content_type: "carousel" });
      }
      const videoUrl = data.hdplay || data.play;
      if (!videoUrl) throw new Error("No video URL from tikwm");
      const r = await fetchUrl(videoUrl, { headers: { "Referer": "https://www.tiktok.com/" } }, 60000);
      if (!r.ok) throw new Error(`tikwm video fetch ${r.status}`);
      res.setHeader("Content-Disposition", `attachment; filename="tiktok_nowatermark.mp4"`);
      res.setHeader("Content-Type", "video/mp4");
      r.body.pipe(res);
      return;
    } catch (e) {
      console.warn("[download/tiktok] tikwm failed, falling back to yt-dlp:", e.message);
    }

    const hasYtDlp = await checkYtDlp();
    if (!hasYtDlp) return res.status(500).json({ error: "yt-dlp tidak ditemukan." });
    const resolved = await resolveShortUrl(url);
    const filepath = path.join(TEMP_DIR, `tiktok_${Date.now()}.mp4`);
    exec(`yt-dlp -f "best[ext=mp4]/best" -o "${filepath}" "${resolved}"`, { timeout: 90000 }, (err) => {
      if (err || !fs.existsSync(filepath)) return res.status(500).json({ error: "Gagal mendownload video TikTok." });
      res.download(filepath, "tiktok_nowatermark.mp4", () => fs.unlink(filepath, () => {}));
    });
    return;
  }

  if (platform === "instagram" || platform === "capcut") {
    try {
      const data = await cobaltFetch(url);
      if (data.status === "picker") {
        return res.status(400).json({ error: "Ini adalah postingan carousel. Gunakan tombol Download Foto/Video." });
      }
      const videoUrl = data.url;
      if (!videoUrl) throw new Error("No URL from cobalt");
      const r = await fetchUrl(videoUrl, {}, 60000);
      if (!r.ok) throw new Error(`cobalt stream ${r.status}`);
      res.setHeader("Content-Disposition", `attachment; filename="${platform}_nowatermark.mp4"`);
      res.setHeader("Content-Type", r.headers.get("content-type") || "video/mp4");
      r.body.pipe(res);
    } catch (e) {
      console.error(`[download/${platform}] error:`, e.message);
      return res.status(500).json({ error: `Gagal mendownload video dari ${platformLabel(platform)}.` });
    }
    return;
  }

  return res.status(400).json({ error: "Platform tidak didukung." });
});

app.post("/api/download-mp3", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL wajib diisi" });

  const platform = detectPlatform(url);
  if (!platform) return res.status(400).json({ error: "URL tidak valid." });

  if (platform === "tiktok") {
    try {
      const data = await tikwmFetch(url);
      if ((data.images || []).length > 0) {
        return res.status(400).json({ error: "Postingan foto tidak memiliki audio." });
      }
      const videoUrl = data.hdplay || data.play;
      if (!videoUrl) throw new Error("No video URL from tikwm");

      const ts = Date.now();
      const mp4Path = path.join(TEMP_DIR, `tiktok_${ts}.mp4`);
      const mp3Path = path.join(TEMP_DIR, `tiktok_${ts}.mp3`);

      const r = await fetchUrl(videoUrl, { headers: { "Referer": "https://www.tiktok.com/" } }, 60000);
      if (!r.ok) throw new Error(`tikwm video fetch ${r.status}`);

      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(mp4Path);
        r.body.pipe(ws);
        ws.on("finish", resolve);
        ws.on("error", reject);
      });

      await new Promise((resolve, reject) => {
        exec(`ffmpeg -i "${mp4Path}" -vn -ab 192k -ar 44100 -y "${mp3Path}"`, { timeout: 60000 }, (err) => {
          fs.unlink(mp4Path, () => {});
          if (err) return reject(err);
          resolve();
        });
      });

      res.download(mp3Path, "tiktok_audio.mp3", () => fs.unlink(mp3Path, () => {}));
      return;
    } catch (e) {
      console.warn("[mp3/tiktok] tikwm failed, falling back to yt-dlp:", e.message);
    }

    const hasYtDlp = await checkYtDlp();
    if (!hasYtDlp) return res.status(500).json({ error: "yt-dlp tidak ditemukan." });
    const resolved = await resolveShortUrl(url);
    const ts = Date.now();
    const mp4Path = path.join(TEMP_DIR, `tiktok_${ts}.mp4`);
    const mp3Path = path.join(TEMP_DIR, `tiktok_${ts}.mp3`);
    exec(`yt-dlp -f "best[ext=mp4]/best" -o "${mp4Path}" "${resolved}"`, { timeout: 90000 }, (err) => {
      if (err || !fs.existsSync(mp4Path)) return res.status(500).json({ error: "Gagal mendownload video untuk konversi." });
      exec(`ffmpeg -i "${mp4Path}" -vn -ab 192k -ar 44100 -y "${mp3Path}"`, { timeout: 60000 }, (err2) => {
        fs.unlink(mp4Path, () => {});
        if (err2 || !fs.existsSync(mp3Path)) return res.status(500).json({ error: "Gagal mengkonversi ke MP3." });
        res.download(mp3Path, "tiktok_audio.mp3", () => fs.unlink(mp3Path, () => {}));
      });
    });
    return;
  }

  if (platform === "instagram" || platform === "capcut") {
    try {
      const data = await cobaltFetch(url);
      if (data.status === "picker") {
        return res.status(400).json({ error: "Carousel tidak bisa dikonversi ke MP3 langsung." });
      }
      const videoUrl = data.url;
      if (!videoUrl) throw new Error("No URL from cobalt");

      const ts = Date.now();
      const mp4Path = path.join(TEMP_DIR, `${platform}_${ts}.mp4`);
      const mp3Path = path.join(TEMP_DIR, `${platform}_${ts}.mp3`);

      const r = await fetchUrl(videoUrl, {}, 60000);
      if (!r.ok) throw new Error(`cobalt stream ${r.status}`);

      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(mp4Path);
        r.body.pipe(ws);
        ws.on("finish", resolve);
        ws.on("error", reject);
      });

      await new Promise((resolve, reject) => {
        exec(`ffmpeg -i "${mp4Path}" -vn -ab 192k -ar 44100 -y "${mp3Path}"`, { timeout: 60000 }, (err) => {
          fs.unlink(mp4Path, () => {});
          if (err) return reject(err);
          resolve();
        });
      });

      res.download(mp3Path, `${platform}_audio.mp3`, () => fs.unlink(mp3Path, () => {}));
    } catch (e) {
      console.error(`[mp3/${platform}] error:`, e.message);
      return res.status(500).json({ error: `Gagal mengkonversi audio dari ${platformLabel(platform)}.` });
    }
    return;
  }

  return res.status(400).json({ error: "Platform tidak didukung." });
});

app.post("/api/download-images", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL wajib diisi" });

  const platform = detectPlatform(url);
  if (!platform) return res.status(400).json({ error: "URL tidak valid." });
  if (!["tiktok", "instagram"].includes(platform))
    return res.status(400).json({ error: "Download gambar hanya support TikTok dan Instagram." });

  if (platform === "tiktok") {
    try {
      const data = await tikwmFetch(url);
      const imageUrls = data.images || [];
      if (imageUrls.length === 0)
        return res.status(400).json({ error: "Ini bukan postingan foto. Gunakan Download MP4 untuk video." });

      const images = await Promise.all(
        imageUrls.map(async (imgUrl, i) => {
          const r = await fetchUrl(imgUrl, { headers: { "Referer": "https://www.tiktok.com/" } }, 15000);
          if (!r.ok) throw new Error(`Gagal download gambar ${i + 1}`);
          const buf = await r.buffer();
          return { index: i + 1, mime: "image/jpeg", data: buf.toString("base64"), filename: `tiktok_photo_${i + 1}.jpg` };
        })
      );
      return res.json({ images, count: images.length });
    } catch (e) {
      console.error("[images/tiktok] error:", e.message);
      return res.status(500).json({ error: "Gagal mendownload gambar TikTok. Coba lagi." });
    }
  }

  if (platform === "instagram") {
    try {
      const data = await cobaltFetch(url);

      if (data.status !== "picker") {
        const mediaUrl = data.url;
        if (!mediaUrl) throw new Error("No URL from cobalt");
        const r = await fetchUrl(mediaUrl, {}, 30000);
        if (!r.ok) throw new Error(`cobalt fetch ${r.status}`);
        const buf = await r.buffer();
        const ct = r.headers.get("content-type") || "image/jpeg";
        const ext = ct.includes("video") ? "mp4" : "jpg";
        return res.json({
          images: [{ index: 1, mime: ct, data: buf.toString("base64"), filename: `instagram_media_1.${ext}` }],
          count: 1,
        });
      }

      const items = data.picker || [];
      const images = await Promise.all(
        items.map(async (item, i) => {
          const mediaUrl = item.url;
          const r = await fetchUrl(mediaUrl, {}, 30000);
          if (!r.ok) throw new Error(`Gagal download item ${i + 1}`);
          const buf = await r.buffer();
          const ct = r.headers.get("content-type") || "image/jpeg";
          const ext = ct.includes("video") ? "mp4" : "jpg";
          return { index: i + 1, mime: ct, data: buf.toString("base64"), filename: `instagram_media_${i + 1}.${ext}` };
        })
      );
      return res.json({ images, count: images.length });
    } catch (e) {
      console.error("[images/instagram] error:", e.message);
      return res.status(500).json({ error: "Gagal mendownload media Instagram. Pastikan postingan publik." });
    }
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Video Downloader API running (TikTok + Instagram + CapCut)" });
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`📥 Downloader siap: TikTok · Instagram · CapCut`);
});