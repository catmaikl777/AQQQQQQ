const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

// Simple static file server
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

let clientId = 1;

function broadcast(data, except) {
  const raw = JSON.stringify(data);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN && c !== except) {
      c.send(raw);
    }
  });
}

wss.on('connection', (ws) => {
  ws.id = clientId++;
  ws.name = `User${ws.id}`;

  // Inform the connected client about its assigned id and name
  ws.send(JSON.stringify({ type: 'init', id: ws.id, name: ws.name }));

  // Inform others
  broadcast({ type: 'system', text: `${ws.name} вошёл в чат` }, ws);

  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch (e) {
      return;
    }

    if (data.type === 'setName') {
      const old = ws.name;
      ws.name = String(data.name || '').trim() || ws.name;
      broadcast({ type: 'system', text: `${old} сменил имя на ${ws.name}` });
      return;
    }

    if (data.type === 'message') {
      const text = String(data.text || '').trim();
      if (!text) return;
      const payload = {
        type: 'message',
        id: ws.id,
        name: ws.name,
        text,
        ts: Date.now()
      };
      broadcast(payload);
    }
  });

  ws.on('close', () => {
    broadcast({ type: 'system', text: `${ws.name} покинул чат` });
  });
});

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
