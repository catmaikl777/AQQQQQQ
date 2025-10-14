// server.js (полная версия)
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { Pool } = require('pg');

// Настройка подключения к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Функции для работы с базой данных
const db = {
  async init() {
    const client = await pool.connect();
    try {
      // Создаем таблицу пользователей
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Создаем таблицу сессий
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id),
          session_id VARCHAR(100) UNIQUE NOT NULL,
          connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          disconnected_at TIMESTAMP NULL
        )
      `);

      // Создаем таблицу сообщений с поддержкой файлов
      await client.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id),
          message_type VARCHAR(20) NOT NULL,
          content TEXT,
          target_user_id INTEGER REFERENCES users(id),
          file_name VARCHAR(255),
          file_type VARCHAR(100),
          file_size INTEGER,
          file_data BYTEA,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Создаем индексы для производительности
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

      console.log('Database tables initialized successfully');
    } catch (error) {
      console.error('Error initializing database:', error);
      throw error;
    } finally {
      client.release();
    }
  },

  async findOrCreateUser(username) {
    const client = await pool.connect();
    try {
      // Проверяем существующего пользователя
      let result = await client.query(
        'SELECT id, username FROM users WHERE username = $1',
        [username]
      );

      // Если пользователь не существует, создаем нового
      if (result.rows.length === 0) {
        result = await client.query(
          'INSERT INTO users (username) VALUES ($1) RETURNING id, username',
          [username]
        );
      }

      // Обновляем время последней активности
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

  async saveMessage(userId, messageType, content, targetUserId = null, fileData = null) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO messages (user_id, message_type, content, target_user_id, file_data) 
         VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
        [userId, messageType, content, targetUserId, fileData]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error in saveMessage:', error);
      throw error;
    } finally {
      client.release();
    }
  },

  async saveFileMessage(userId, filename, filetype, size, data, targetUserId = null) {
    const client = await pool.connect();
    try {
      const buffer = Buffer.from(data, 'base64');
      const result = await client.query(
        `INSERT INTO messages (user_id, message_type, file_name, file_type, file_size, file_data, target_user_id) 
         VALUES ($1, 'file', $2, $3, $4, $5, $6) RETURNING id, created_at`,
        [userId, filename, filetype, size, buffer, targetUserId]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error in saveFileMessage:', error);
      throw error;
    } finally {
      client.release();
    }
  },

  async getMessageHistory(limit = 100) {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          m.id,
          m.message_type as type,
          m.content,
          m.created_at,
          m.file_name,
          m.file_type,
          m.file_size,
          u.username as name,
          u.id as user_id,
          m.target_user_id
        FROM messages m
        JOIN users u ON m.user_id = u.id
        WHERE (m.message_type != 'private' OR m.target_user_id IS NULL)
          AND m.message_type != 'system'
        ORDER BY m.created_at DESC
        LIMIT $1
      `, [limit]);

      // Преобразуем историю сообщений
      const history = result.rows.reverse().map(row => {
        const message = {
          type: row.type,
          name: row.name,
          user_id: row.user_id,
          created_at: row.created_at
        };

        if (row.type === 'file') {
          message.content = row.file_name;
          message.file_name = row.file_name;
          message.file_type = row.file_type;
          message.file_size = row.file_size;
        } else {
          message.content = row.content;
        }

        return message;
      });

      return history;
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
  },

  async updateUsername(userId, newUsername) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'UPDATE users SET username = $1 WHERE id = $2 RETURNING username',
        [newUsername, userId]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error in updateUsername:', error);
      throw error;
    } finally {
      client.release();
    }
  }
};

// HTTP сервер для статических файлов
const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  let filePath = req.url;
  if (filePath === '/') filePath = '/index.html';
  
  // Защита от directory traversal
  const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(__dirname, safePath);

  // Проверяем существование файла
  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Если файл не найден, возвращаем index.html для SPA
      const indexPath = path.join(__dirname, 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.json': 'application/json'
    }[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(fullPath).pipe(res);
  });
});

// WebSocket сервер
const wss = new WebSocket.Server({ 
  server,
  perMessageDeflate: false
});

const clients = new Map(); // sessionId -> {ws, user, userId}

function broadcast(data, exceptSessionId = null) {
  const message = JSON.stringify(data);
  clients.forEach((client, sessionId) => {
    if (sessionId !== exceptSessionId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

async function broadcastUsers() {
  try {
    const onlineUsers = await db.getOnlineUsers();
    const usersData = onlineUsers.map(user => ({
      id: user.id,
      name: user.username,
      isOnline: true
    }));

    broadcast({ type: 'users', users: usersData });
  } catch (error) {
    console.error('Error broadcasting users:', error);
  }
}

// Обработка WebSocket соединений
wss.on('connection', async (ws, req) => {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  let currentUser = null;
  let userId = null;

  console.log(`New WebSocket connection: ${sessionId}`);

  try {
    // Создаем временного пользователя
    currentUser = await db.findOrCreateUser(`User_${sessionId.substr(7, 6)}`);
    userId = currentUser.id;
    
    await db.createUserSession(userId, sessionId);
    
    clients.set(sessionId, { ws, user: currentUser, userId });

    // Отправляем историю сообщений
    const history = await db.getMessageHistory();
    ws.send(JSON.stringify({ type: 'history', history }));

    // Отправляем информацию о текущем пользователе
    ws.send(JSON.stringify({ 
      type: 'init', 
      id: userId, 
      name: currentUser.username 
    }));

    // Сообщаем о входе пользователя
    await db.saveMessage(userId, 'system', `${currentUser.username} вошёл в чат`);
    broadcast({ 
      type: 'system', 
      text: `${currentUser.username} вошёл в чат`
    }, ws);

    // Обновляем список пользователей
    await broadcastUsers();

  } catch (error) {
    console.error('Error during connection setup:', error);
    ws.close();
    return;
  }

  // Обработка входящих сообщений
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'setName':
          if (message.name && message.name.trim()) {
            const newName = message.name.trim();
            
            try {
              // Проверяем, не занято ли имя
              const existingUser = await db.findOrCreateUser(newName);
              
              if (existingUser.id !== userId) {
                // Имя занято другим пользователем
                ws.send(JSON.stringify({ 
                  type: 'system', 
                  text: 'Это имя уже занято. Выберите другое.' 
                }));
                return;
              }
              
              // Обновляем имя
              const oldName = currentUser.username;
              currentUser.username = newName;
              
              await db.updateUsername(userId, newName);
              await db.saveMessage(userId, 'action', `${oldName} сменил имя на ${newName}`);
              
              broadcast({
                type: 'action',
                name: oldName,
                text: `сменил имя на ${newName}`
              });
              
              await broadcastUsers();
              
              ws.send(JSON.stringify({
                type: 'system',
                text: `Имя успешно изменено на ${newName}`
              }));
              
            } catch (error) {
              console.error('Error updating username:', error);
              ws.send(JSON.stringify({ 
                type: 'system', 
                text: 'Ошибка при смене имени' 
              }));
            }
          }
          break;
          
        case 'message':
          if (message.text && message.text.trim()) {
            const text = message.text.trim();
            const savedMessage = await db.saveMessage(userId, 'message', text);
            
            broadcast({
              type: 'message',
              id: userId,
              name: currentUser.username,
              text: text,
              ts: savedMessage.created_at
            });
          }
          break;
          
        case 'file':
          if (message.filename && message.data) {
            try {
              // Проверяем размер файла (10MB максимум)
              if (message.size > 10 * 1024 * 1024) {
                ws.send(JSON.stringify({
                  type: 'system',
                  text: 'Файл слишком большой (максимум 10MB)'
                }));
                return;
              }
              
              await db.saveFileMessage(
                userId, 
                message.filename,
                message.filetype,
                message.size,
                message.data
              );
              
              broadcast({
                type: 'file',
                id: userId,
                name: currentUser.username,
                filename: message.filename,
                filetype: message.filetype,
                size: message.size,
                data: message.data,
                ts: Date.now()
              });
              
            } catch (error) {
              console.error('Error saving file:', error);
              ws.send(JSON.stringify({
                type: 'system',
                text: 'Ошибка при отправке файла'
              }));
            }
          }
          break;
          
        case 'action':
          if (message.text && message.text.trim()) {
            const text = message.text.trim();
            await db.saveMessage(userId, 'action', text);
            
            broadcast({
              type: 'action',
              name: currentUser.username,
              text: text
            });
          }
          break;
          
        case 'reaction':
          if (message.emoji) {
            await db.saveMessage(userId, 'reaction', message.emoji);
            
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
              const text = message.text.trim();
              
              // Сохраняем приватное сообщение
              await db.saveMessage(userId, 'private', text, message.to);
              
              // Ищем клиент целевого пользователя
              let targetClient = null;
              clients.forEach((client, sid) => {
                if (client.userId === message.to) {
                  targetClient = client;
                }
              });
              
              if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                targetClient.ws.send(JSON.stringify({
                  type: 'private',
                  name: currentUser.username,
                  text: text
                }));
                
                ws.send(JSON.stringify({
                  type: 'private_sent'
                }));
              } else {
                ws.send(JSON.stringify({
                  type: 'system',
                  text: 'Пользователь не в сети'
                }));
              }
            }
          }
          break;

        // Обработчики звонков
        case 'call_start':
          broadcast({
            type: 'call_start',
            id: userId,
            name: currentUser.username
          }, sessionId);
          break;
          
        case 'call_accept':
          if (message.target) {
            // Ищем клиент того, кто начал звонок
            clients.forEach((client, sid) => {
              if (client.userId === message.target && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({
                  type: 'call_accept',
                  id: userId,
                  name: currentUser.username
                }));
              }
            });
          }
          break;
          
        case 'call_reject':
          if (message.target) {
            clients.forEach((client, sid) => {
              if (client.userId === message.target && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({
                  type: 'call_reject',
                  id: userId,
                  name: currentUser.username
                }));
              }
            });
          }
          break;
          
        case 'call_end':
          broadcast({
            type: 'call_end',
            id: userId,
            name: currentUser.username
          });
          break;
          
        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'system',
        text: 'Ошибка обработки сообщения'
      }));
    }
  });

  // Обработка закрытия соединения
  ws.on('close', async () => {
    console.log(`WebSocket connection closed: ${sessionId}`);
    
    const clientData = clients.get(sessionId);
    if (clientData) {
      await db.endUserSession(sessionId);
      clients.delete(sessionId);
      
      // Сообщаем о выходе пользователя
      await db.saveMessage(userId, 'system', `${currentUser.username} вышел из чата`);
      broadcast({ 
        type: 'system', 
        text: `${currentUser.username} вышел из чата` 
      });
      
      await broadcastUsers();
    }
  });

  // Обработка ошибок
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Очистка старых сессий при запуске
async function cleanupOldSessions() {
  try {
    const client = await pool.connect();
    await client.query(`
      UPDATE user_sessions 
      SET disconnected_at = CURRENT_TIMESTAMP 
      WHERE disconnected_at IS NULL
      AND connected_at < NOW() - INTERVAL '1 hour'
    `);
    client.release();
    console.log('Old sessions cleaned up');
  } catch (error) {
    console.error('Error cleaning up old sessions:', error);
  }
}

// Периодическая очистка неактивных сессий
setInterval(cleanupOldSessions, 30 * 60 * 1000); // Каждые 30 минут

// Запуск сервера
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await db.init();
    await cleanupOldSessions();
    
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`WebSocket server ready for connections`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  
  // Завершаем все активные сессии
  for (const [sessionId, clientData] of clients.entries()) {
    await db.endUserSession(sessionId);
  }
  
  await pool.end();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down...');
  
  for (const [sessionId, clientData] of clients.entries()) {
    await db.endUserSession(sessionId);
  }
  
  await pool.end();
  server.close(() => {
    process.exit(0);
  });
});

// Запускаем сервер
startServer();