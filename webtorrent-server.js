import express from "express";
import WebTorrent from "webtorrent";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const downloadsDir = path.join(__dirname, "webtorrent-downloads");
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

const app = express();
const client = new WebTorrent();

app.use(cors());
app.use(express.json());

// ---- Torrent management ----

app.get("/add/:magnet(*)", async (req, res) => {
  let magnet = req.params.magnet;
  if (!magnet) return res.status(400).json({ error: "Magnet required" });

  try {
    let existing = client.get(magnet);
    if (existing) {
      return res.status(200).json({
        infoHash: existing.infoHash,
        files: existing.files.map((f) => ({ name: f.name, length: f.length, path: f.path })),
      });
    }

    client.add(magnet, { path: downloadsDir }, (torrent) => {
      res.status(200).json({
        infoHash: torrent.infoHash,
        files: torrent.files.map((f) => ({ name: f.name, length: f.length, path: f.path })),
      });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/metadata/:magnet(*)", async (req, res) => {
  let magnet = req.params.magnet;
  if (!magnet) return res.status(400).json({ error: "Magnet required" });

  try {
    let existing = client.get(magnet);
    if (existing) {
      return res.status(200).json({
        infoHash: existing.infoHash,
        files: existing.files.map((f) => ({ name: f.name, length: f.length })),
      });
    }

    const torrent = client.add(magnet, { deselect: true, path: downloadsDir });
    torrent.on("metadata", () => {
      res.status(200).json({
        infoHash: torrent.infoHash,
        files: torrent.files.map((f) => ({ name: f.name, length: f.length })),
      });
    });
    torrent.on("error", (err) => {
      res.status(500).json({ error: err.message });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/streamfile/:magnet(*)/:filename(*)", async (req, res, next) => {
  let magnet = req.params.magnet;
  let filename = req.params.filename;

  let tor = client.get(magnet);
  if (!tor) {
    return res.status(404).send("Torrent not found");
  }

  let file = tor.files.find((f) => f.name === filename);
  if (!file) {
    return res.status(404).send("No file found in the torrent");
  }

  file.select();

  let range = req.headers.range;
  if (!range) {
    return res.status(416).send("Range is required");
  }

  let positions = range.replace(/bytes=/, "").split("-");
  let start = parseInt(positions[0], 10);
  let file_size = file.length;
  let end = positions[1] ? parseInt(positions[1], 10) : file_size - 1;
  let chunksize = end - start + 1;

  let head = {
    "Content-Range": `bytes ${start}-${end}/${file_size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunksize,
    "Content-Type": "video/mp4",
  };

  res.writeHead(206, head);

  let stream = file.createReadStream({ start, end });
  stream.pipe(res);

  stream.on("error", (err) => {
    console.error("Stream error:", err);
    if (!res.headersSent) {
      return res.status(500).send("Error streaming the video");
    }
  });
});

app.get("/stream/:magnet(*)", async (req, res, next) => {
  let magnet = req.params.magnet;
  let tor = client.get(magnet);
  if (!tor) {
    return res.status(404).send("Torrent not found");
  }

  let file = tor.files.find((f) => f.name.endsWith(".mkv") || f.name.endsWith(".mp4"));
  if (!file) {
    return res.status(404).send("No video file found in the torrent");
  }

  let range = req.headers.range;
  if (!range) {
    return res.status(416).send("Range is required");
  }

  let positions = range.replace(/bytes=/, "").split("-");
  let start = parseInt(positions[0], 10);
  let file_size = file.length;
  let end = positions[1] ? parseInt(positions[1], 10) : file_size - 1;
  let chunksize = end - start + 1;

  let head = {
    "Content-Range": `bytes ${start}-${end}/${file_size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunksize,
    "Content-Type": "video/mp4",
  };

  res.writeHead(206, head);

  let stream = file.createReadStream({ start, end });
  stream.pipe(res);

  stream.on("error", (err) => {
    console.error("Stream error:", err);
    if (!res.headersSent) {
      return res.status(500).send("Error streaming the video");
    }
  });
});

app.get("/detailsepisode/:magnet(*)/:filename(*)", async (req, res) => {
  let magnet = req.params.magnet;
  let filename = req.params.filename;

  let tor = client.get(magnet);
  if (!tor) {
    return res.status(404).send("Torrent not found");
  }

  let file = tor.files.find((f) => f.name === filename);
  if (!file) {
    return res.status(404).send("No file found in the torrent");
  }

  res.status(200).json({
    name: file.name,
    length: file.length,
    downloaded: file.downloaded,
    progress: file.progress,
    torrentProgress: tor.progress,
    numPeers: tor.numPeers,
    downloadSpeed: tor.downloadSpeed,
    uploadSpeed: tor.uploadSpeed,
  });
});

app.get("/details/:magnet(*)", async (req, res) => {
  let magnet = req.params.magnet;
  let tor = client.get(magnet);
  if (!tor) {
    return res.status(404).send("Torrent not found");
  }

  res.status(200).json({
    name: tor.name,
    length: tor.length,
    downloaded: tor.downloaded,
    uploaded: tor.uploaded,
    downloadSpeed: tor.downloadSpeed,
    uploadSpeed: tor.uploadSpeed,
    progress: tor.progress,
    ratio: tor.ratio,
    numPeers: tor.numPeers,
    files: tor.files.map((f) => ({ name: f.name, length: f.length })),
  });
});

app.delete("/remove/:magnet(*)", async (req, res) => {
  let magnet = req.params.magnet;
  let tor = client.get(magnet);
  if (!tor) {
    return res.status(404).send("Torrent not found");
  }

  tor.destroy((err) => {
    if (err) {
      return res.status(500).send("Error removing torrent");
    }
    res.status(200).send("Torrent removed successfully");
  });
});

app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

const PORT = process.env.WEBTORRENT_PORT || 64622;
app.listen(PORT, () => {
  console.log(`WebTorrent server running at http://localhost:${PORT}`);
});

export default app;
