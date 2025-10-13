<<<<<<< HEAD
// server.js
=======
>>>>>>> 65a3c9efa3e752f835231d667373d22f778cce6d
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
<<<<<<< HEAD
const { Pool } = require('pg');

// Настройка подключения к PostgreSQL для Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Настройки пула соединений
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// server.js - добавьте эту функцию
async function initializeDatabase() {
  try {
    const client = await pool.connect();
    
    // Создаем таблицы если они не существуют
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        message_type VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        target_user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        session_id VARCHAR(100) UNIQUE NOT NULL,
        connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        disconnected_at TIMESTAMP NULL
      )
    `);

    // Создаем индексы
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)
    `);

    console.log('Database tables created successfully');
    client.release();
  } catch (error) {
    console.error('Error creating database tables:', error);
  }
}
=======
>>>>>>> 65a3c9efa3e752f835231d667373d22f778cce6d

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

<<<<<<< HEAD
// Функции для работы с базой данных (остаются те же)
const db = {
  async findOrCreateUser(username) {
    const client = await pool.connect();
    try {
      let result = await client.query(
        'SELECT id, username FROM users WHERE username = $1',
        [username]
      );

      if (result.rows.length === 0) {
        result = await client.query(
          'INSERT INTO users (username) VALUES ($1) RETURNING id, username',
          [username]
        );
      }

      await client.query(
        'UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1',
        [result.rows[0].id]
      );

      return result.rows[0];
    } catch (error) {
      console.error('Error in findOrCreateUser:', error);
      throw error;
    } finally {
      client.release();
    }
  },

  async createUserSession(userId, sessionId) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'INSERT INTO user_sessions (user_id, session_id) VALUES ($1, $2) RETURNING id',
        [userId, sessionId]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error in createUserSession:', error);
      throw error;
    } finally {
      client.release();
    }
  },

  async endUserSession(sessionId) {
    const client = await pool.connect();
    try {
      await client.query(
        'UPDATE user_sessions SET disconnected_at = CURRENT_TIMESTAMP WHERE session_id = $1',
        [sessionId]
      );
    } catch (error) {
      console.error('Error in endUserSession:', error);
      throw error;
    } finally {
      client.release();
    }
  },

  async saveMessage(userId, messageType, content, targetUserId = null) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'INSERT INTO messages (user_id, message_type, content, target_user_id) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
        [userId, messageType, content, targetUserId]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error in saveMessage:', error);
      throw error;
    } finally {
      client.release();
    }
  },

  async getMessageHistory(limit = 50) {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          m.id,
          m.message_type as type,
          m.content,
          m.created_at,
          u.username as name,
          u.id as user_id,
          m.target_user_id
        FROM messages m
        JOIN users u ON m.user_id = u.id
        WHERE m.message_type != 'private' OR m.target_user_id IS NULL
        ORDER BY m.created_at DESC
        LIMIT $1
      `, [limit]);

      return result.rows.reverse();
    } catch (error) {
      console.error('Error in getMessageHistory:', error);
      throw error;
    } finally {
      client.release();
    }
  },

  async getOnlineUsers() {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT DISTINCT u.id, u.username
        FROM users u
        JOIN user_sessions us ON u.id = us.user_id
        WHERE us.disconnected_at IS NULL
        ORDER BY u.username
      `);
      return result.rows;
    } catch (error) {
      console.error('Error in getOnlineUsers:', error);
      throw error;
    } finally {
      client.release();
    }
  },

  async getUserById(userId) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT id, username FROM users WHERE id = $1',
        [userId]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error in getUserById:', error);
      throw error;
    } finally {
      client.release();
    }
  }
};

// Инициализация базы данных
async function initializeDatabase() {
  try {
    const client = await pool.connect();
    
    // Создаем таблицы если они не существуют
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        message_type VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        target_user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        session_id VARCHAR(100) UNIQUE NOT NULL,
        connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        disconnected_at TIMESTAMP NULL
      )
    `);

    // Создаем индексы если они не существуют
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)
    `);

    console.log('Database initialized successfully');
    client.release();
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

// Static file server (остается тот же)
=======
// Simple static file server
>>>>>>> 65a3c9efa3e752f835231d667373d22f778cce6d
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
<<<<<<< HEAD
const clients = new Map();

function broadcast(data, except = null) {
  const raw = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client !== except) {
      client.send(raw);
=======

let clientId = 1;

function broadcast(data, except) {
  const raw = JSON.stringify(data);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN && c !== except) {
      c.send(raw);
>>>>>>> 65a3c9efa3e752f835231d667373d22f778cce6d
    }
  });
}

<<<<<<< HEAD
async function updateOnlineUsers() {
  try {
    const onlineUsers = await db.getOnlineUsers();
    const usersData = onlineUsers.map(user => ({
      id: user.id,
      name: user.username,
      isOnline: true
    }));

    broadcast({ type: 'users', users: usersData });
  } catch (error) {
    console.error('Error updating online users:', error);
  }
}

wss.on('connection', async (ws) => {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  let currentUser = null;

  try {
    currentUser = await db.findOrCreateUser(`User${Date.now()}`);
    await db.createUserSession(currentUser.id, sessionId);
    
    clients.set(ws, { user: currentUser, sessionId });

    const history = await db.getMessageHistory();
    ws.send(JSON.stringify({ type: 'history', history }));

    ws.send(JSON.stringify({ 
      type: 'init', 
      id: currentUser.id, 
      name: currentUser.username 
    }));

    await db.saveMessage(currentUser.id, 'system', `${currentUser.username} вошёл в чат`);

    broadcast({ 
      type: 'system', 
      text: `${currentUser.username} вошёл в чат`,
      userId: currentUser.id,
      userName: currentUser.username
    }, ws);

    await updateOnlineUsers();

  } catch (error) {
    console.error('Error during connection setup:', error);
    ws.close();
    return;
  }

  // Остальная логика обработки сообщений остается той же...
  // [Вставьте сюда обработчики сообщений из предыдущей версии]
=======
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
>>>>>>> 65a3c9efa3e752f835231d667373d22f778cce6d
});

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

<<<<<<< HEAD
// Очистка старых сессий
async function cleanupOldSessions() {
  try {
    const client = await pool.connect();
    await client.query(`
      UPDATE user_sessions 
      SET disconnected_at = CURRENT_TIMESTAMP 
      WHERE disconnected_at IS NULL
    `);
    client.release();
    console.log('Old sessions cleaned up');
  } catch (error) {
    console.error('Error cleaning up old sessions:', error);
  }
}

// Запуск сервера
server.listen(PORT, async () => {
  await initializeDatabase(); // Добавьте эту строку
  await cleanupOldSessions();
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  
  for (const [ws, clientData] of clients.entries()) {
    await db.endUserSession(clientData.sessionId);
  }
  
  await pool.end();
  process.exit(0);
});
=======
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
>>>>>>> 65a3c9efa3e752f835231d667373d22f778cce6d
