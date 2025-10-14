// server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
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

// Функции для работы с базой данных
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

// Static file server
const PUBLIC_DIR = path.join(__dirname);
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  let filePath = req.url;
  if (filePath === '/') filePath = '/index.html';
  
  // Безопасное определение пути к файлу
  const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(__dirname, safePath);

  // Проверяем существование файла
  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.json': 'application/json'
    }[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(fullPath).pipe(res);
  });
});

const wss = new WebSocket.Server({ noServer: true });
const clients = new Map();

function broadcast(data, except = null) {
  const raw = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client !== except) {
      client.send(raw);
    }
  });
}

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
      text: `${currentUser.username} вошёл в чат`
    }, ws);

    await updateOnlineUsers();

  } catch (error) {
    console.error('Error during connection setup:', error);
    ws.close();
    return;
  }

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'message':
          if (message.text && message.text.trim()) {
            const savedMessage = await db.saveMessage(
              currentUser.id, 
              'message', 
              message.text.trim()
            );
            
            broadcast({
              type: 'message',
              id: currentUser.id,
              name: currentUser.username,
              text: message.text.trim(),
              ts: savedMessage.created_at
            });
          }
          break;
          
        case 'setName':
          if (message.name && message.name.trim()) {
            const newName = message.name.trim();
            try {
              // Обновляем имя пользователя
              const client = await pool.connect();
              await client.query(
                'UPDATE users SET username = $1 WHERE id = $2',
                [newName, currentUser.id]
              );
              client.release();
              
              const oldName = currentUser.username;
              currentUser.username = newName;
              
              await db.saveMessage(
                currentUser.id, 
                'action', 
                `${oldName} сменил имя на ${newName}`
              );
              
              broadcast({
                type: 'action',
                name: oldName,
                text: `сменил имя на ${newName}`
              });
              
              await updateOnlineUsers();
              
            } catch (error) {
              console.error('Error updating username:', error);
              ws.send(JSON.stringify({ 
                type: 'system', 
                text: 'Ошибка при смене имени. Возможно, такое имя уже занято.' 
              }));
            }
          }
          break;
          
        case 'action':
          if (message.text && message.text.trim()) {
            await db.saveMessage(
              currentUser.id, 
              'action', 
              message.text.trim()
            );
            
            broadcast({
              type: 'action',
              name: currentUser.username,
              text: message.text.trim()
            });
          }
          break;
          
        case 'reaction':
          if (message.emoji) {
            await db.saveMessage(
              currentUser.id, 
              'reaction', 
              message.emoji
            );
            
            broadcast({
              type: 'reaction',
              name: currentUser.username,
              emoji: message.emoji
            });
          }
          break;
          
        case 'private':
          if (message.to && message.text && message.text.trim()) {
            const targetUser = await db.getUserById(message.to);
            if (targetUser) {
              await db.saveMessage(
                currentUser.id, 
                'private', 
                message.text.trim(),
                message.to
              );
              
              // Отправляем приватное сообщение конкретному пользователю
              wss.clients.forEach((client) => {
                const clientData = clients.get(client);
                if (clientData && clientData.user.id === message.to) {
                  client.send(JSON.stringify({
                    type: 'private',
                    name: currentUser.username,
                    text: message.text.trim()
                  }));
                }
              });
              
              ws.send(JSON.stringify({
                type: 'private_sent'
              }));
            }
          }
          break;
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', async () => {
    const clientData = clients.get(ws);
    if (clientData) {
      await db.endUserSession(clientData.sessionId);
      clients.delete(ws);
      
      await db.saveMessage(
        clientData.user.id, 
        'system', 
        `${clientData.user.username} вышел из чата`
      );
      
      broadcast({ 
        type: 'system', 
        text: `${clientData.user.username} вышел из чата` 
      });
      
      await updateOnlineUsers();
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

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
  await initializeDatabase();
  await cleanupOldSessions();
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  
  for (const [ws, clientData] of clients.entries()) {
    await db.endUserSession(clientData.sessionId);
  }
  
  await pool.end();''
  process.exit(0);
});
