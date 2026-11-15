const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 8765;
const ROOT = __dirname;
const CACHE_DIR = path.join(ROOT, 'audio_cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon'
};

// ============================================================================
// ショウコさん (Gemini TTS Leda) 常駐ワーカー ＆ 優先度付きキャッシュキュー
// ============================================================================
let ttsProc = null;
let ttsReady = false;
let activeJob = null;
const highQueue = []; // 今すぐ再生したいリクエスト
const lowQueue = [];  // バックグラウンド先読み(prefetch)リクエスト
const inflightMap = new Map(); // outPath -> Promise<boolean>

function startTtsWorker() {
  const workerPath = path.join(ROOT, 'shoko_tts_worker.py');
  if (!fs.existsSync(workerPath)) return;

  ttsProc = spawn('python', [workerPath], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdoutBuf = '';
  ttsProc.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8');
    const lines = stdoutBuf.split(/\r?\n/);
    stdoutBuf = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.ready) {
          ttsReady = true;
          console.log(`  Shoko TTS    : Ready (Voice=${msg.voice})`);
          pumpQueue();
          continue;
        }
        if (activeJob && msg.id === activeJob.id) {
          const job = activeJob;
          activeJob = null;
          job.resolve(Boolean(msg.ok));
          pumpQueue();
        }
      } catch (_) {}
    }
  });

  ttsProc.on('exit', () => {
    ttsReady = false;
    if (activeJob) {
      const job = activeJob;
      activeJob = null;
      job.resolve(false);
    }
    setTimeout(startTtsWorker, 3000);
  });
}

function pumpQueue() {
  if (!ttsReady || activeJob || !ttsProc) return;
  const nextJob = highQueue.shift() || lowQueue.shift();
  if (!nextJob) return;

  // 既にファイルが生成済みならスキップして即完了
  if (fs.existsSync(nextJob.outPath) && fs.statSync(nextJob.outPath).size > 200) {
    nextJob.resolve(true);
    setImmediate(pumpQueue);
    return;
  }

  activeJob = nextJob;
  const payload = JSON.stringify({
    id: nextJob.id,
    text: nextJob.text,
    out: nextJob.outPath
  });
  ttsProc.stdin.write(payload + '\n');
}

function getCachePathForText(text) {
  const hash = crypto.createHash('sha1').update('leda_v1:' + text.trim()).digest('hex');
  return path.join(CACHE_DIR, `shoko_${hash}.wav`);
}

function ensureTtsAudio(text, priority = 'high') {
  const clean = (text || '').trim();
  if (!clean) return Promise.resolve(null);

  const outPath = getCachePathForText(clean);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 200) {
    return Promise.resolve(outPath);
  }

  if (inflightMap.has(outPath)) {
    return inflightMap.get(outPath);
  }

  const p = new Promise((resolve) => {
    const job = {
      id: crypto.randomUUID(),
      text: clean,
      outPath,
      resolve: (ok) => {
        inflightMap.delete(outPath);
        resolve(ok ? outPath : null);
      }
    };
    if (priority === 'high') {
      highQueue.push(job);
    } else {
      lowQueue.push(job);
    }
    pumpQueue();
  });

  inflightMap.set(outPath, p);
  return p;
}

startTtsWorker();

// ============================================================================
// HTTP Server
// ============================================================================
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(reqUrl.pathname);

  // 1) GET /api/tts?text=...
  if (pathname === '/api/tts' && req.method === 'GET') {
    const text = reqUrl.searchParams.get('text') || '';
    const wavPath = await ensureTtsAudio(text, 'high');
    if (!wavPath || !fs.existsSync(wavPath)) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    const stat = fs.statSync(wavPath);
    res.writeHead(200, {
      'Content-Type': 'audio/wav',
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=604800'
    });
    fs.createReadStream(wavPath).pipe(res);
    return;
  }

  // 2) POST /api/tts/prefetch
  if (pathname === '/api/tts/prefetch' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      if (body.length < 65536) body += chunk.toString('utf8');
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const texts = Array.isArray(parsed.texts) ? parsed.texts.slice(0, 30) : [];
        texts.forEach((t) => ensureTtsAudio(String(t), 'low'));
      } catch (_) {}
      res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ accepted: true }));
    });
    return;
  }

  // 3) Static Files
  if (pathname === '/') pathname = '/index.html';
  const safePath = path.normalize(path.join(ROOT, pathname));
  if (!safePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(safePath, (err, content) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(err.code === 'ENOENT' ? 'Not Found' : 'Server Error');
      return;
    }
    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.jpg' || ext === '.png' ? 'public, max-age=86400' : 'no-cache'
    });
    res.end(content);
  });
});

function getLocalExternalIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log('  40m Flow Studio v2 - Home & Hotel + Shoko Voice');
  console.log('====================================================');
  console.log(`  PC Browser   : http://localhost:${PORT}`);
  console.log(`  Monday Home  : http://localhost:${PORT}/?day=1`);
  console.log(`  Monday Hotel : http://localhost:${PORT}/?day=1&loc=hotel`);
  const ips = getLocalExternalIps();
  ips.forEach((ip) => {
    console.log(`  Smartphone   : http://${ip}:${PORT}  (Same Wi-Fi)`);
  });
  console.log('====================================================');
});
