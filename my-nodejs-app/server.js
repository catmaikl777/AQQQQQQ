const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const { logInfo, logError } = require('./logger');
const { saveChatHistory, loadChatHistory } = require('./utils');

dotenv.config();

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  let filePath = req.url;
  if (filePath === '/') filePath = '/index.html';
  const fullPath = path.join(PUBLIC_DIR, decodeURI(filePath));

  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const map = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml'
    };

    res.writeHead(200, { 'Content-Type': map[ext] || 'application/octet-stream' });
    fs.createReadStream(fullPath).pipe(res);
  });
});

const wss = new WebSocket.Server({ noServer: true });

let clients = [];
let chatHistory = loadChatHistory();

function broadcast(data, except) {
  const raw = JSON.stringify(data);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN && c !== except) {
      c.send(raw);
    }
  });
}

wss.on('connection', (ws) => {
  clients.push(ws);
  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch (e) {
      logError('Failed to parse message', e);
      return;
    }

    if (data.type === 'message') {
      const text = String(data.text || '').trim();
      if (!text) return;
      const payload = {
        type: 'message',
        text,
        ts: Date.now()
      };
      chatHistory.push(payload);
      saveChatHistory(chatHistory);
      broadcast(payload);
    }
  });

  ws.on('close', () => {
    clients = clients.filter(client => client !== ws);
  });
});

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

server.listen(PORT, () => {
  logInfo(`Server running at http://localhost:${PORT}/`);
});