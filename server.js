// server.js - исправленная версия с правильной обработкой дублирующих сессий
const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { Pool } = require("pg");

// Настройка подключения к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on("error", (err, client) => {
  console.error("Unexpected error on idle client", err);
});

// Функции для работы с базой данных
const db = {
  async init() {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

      await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)`);
      
      await this.ensureFileColumns(client);
      console.log("✅ Database tables initialized successfully");
    } catch (error) {
      console.error("❌ Error initializing database:", error);
      throw error;
    } finally {
      client.release();
    }
  },

  async ensureFileColumns(client) {
    try {
      const columns = ['file_name', 'file_type', 'file_size', 'file_data'];
      for (const column of columns) {
        try {
          await client.query(`SELECT ${column} FROM messages LIMIT 1`);
        } catch (error) {
          if (error.code === "42703") {
            console.log(`Adding ${column} column to messages table...`);
            const type = column === 'file_size' ? 'INTEGER' : column === 'file_data' ? 'BYTEA' : 'VARCHAR(255)';
            await client.query(`ALTER TABLE messages ADD COLUMN ${column} ${type}`);
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      console.error("Error ensuring file columns:", error);
      throw error;
    }
  },

  // ИСПРАВЛЕНИЕ: Более безопасная очистка дублирующихся сессий
  async cleanupDuplicateSessions(userId, currentSessionId) {
    const client = await pool.connect();
    try {
      // Получаем все активные сессии пользователя
      const result = await client.query(
        "SELECT session_id FROM user_sessions WHERE user_id = $1 AND session_id != $2 AND disconnected_at IS NULL",
        [userId, currentSessionId]
      );
      
      const duplicateSessions = result.rows.map(row => row.session_id);
      
      if (duplicateSessions.length > 0) {
        console.log(`🧹 Found ${duplicateSessions.length} duplicate sessions for user ${userId}:`, duplicateSessions);
        
        // Закрываем дублирующиеся сессии в базе данных
        await client.query(
          "UPDATE user_sessions SET disconnected_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND session_id != $2 AND disconnected_at IS NULL",
          [userId, currentSessionId]
        );
        
        // Закрываем дублирующиеся соединения в памяти
        duplicateSessions.forEach(sessionId => {
          if (clients.has(sessionId)) {
            const clientData = clients.get(sessionId);
            try {
              if (clientData.ws.readyState === WebSocket.OPEN) {
                // ИСПРАВЛЕНИЕ: Используем специальный код для дублирующих сессий
                clientData.ws.close(4000, "Duplicate session closed by new connection");
              }
            } catch (error) {
              console.error("Error closing duplicate session:", error);
            }
            clients.delete(sessionId);
          }
        });
      }
      
      return duplicateSessions.length;
    } catch (error) {
      console.error("Error in cleanupDuplicateSessions:", error);
      throw error;
    } finally {
      client.release();
    }
  },

  async findOrCreateUser(username) {
    const client = await pool.connect();
    try {
      let result = await client.query(
        "SELECT id, username FROM users WHERE username = $1",
        [username]
      );
      
      if (result.rows.length === 0) {
        result = await client.query(
          "INSERT INTO users (username) VALUES ($1) RETURNING id, username",
          [username]
        );
      }
      
      await client.query(
        "UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1",
        [result.rows[0].id]
      );
      
      return result.rows[0];
    } catch (error) {
      console.error("Error in findOrCreateUser:", error);
      throw error;
    } finally {
      client.release();
    }
  },

  async createUserSession(userId, sessionId) {
    const client = await pool.connect();
    try {
      // Сначала создаем сессию, потом очищаем дубликаты
      const result = await client.query(
        "INSERT INTO user_sessions (user_id, session_id) VALUES ($1, $2) RETURNING id",
        [userId, sessionId]
      );
      
      // Очищаем дублирующиеся сессии после создания новой
      await this.cleanupDuplicateSessions(userId, sessionId);
      
      return result.rows[0];
    } catch (error) {
      console.error("Error in createUserSession:", error);
      throw error;
    } finally {
      client.release();
    }
  },

  async endUserSession(sessionId) {
    const client = await pool.connect();
    try {
      await client.query(
        "UPDATE user_sessions SET disconnected_at = CURRENT_TIMESTAMP WHERE session_id = $1",
        [sessionId]
      );
    } catch (error) {
      console.error("Error in endUserSession:", error);
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
      console.error("Error in saveMessage:", error);
      throw error;
    } finally {
      client.release();
    }
  },

  async saveFileMessage(userId, filename, filetype, size, data, targetUserId = null) {
    const client = await pool.connect();
    try {
      await this.ensureFileColumns(client);
      const buffer = Buffer.from(data, "base64");

      const result = await client.query(
        `INSERT INTO messages (user_id, message_type, content, file_name, file_type, file_size, file_data, target_user_id) 
         VALUES ($1, 'file', $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
        [userId, filename, filename, filetype, size, buffer, targetUserId]
      );
      return result.rows[0];
    } catch (error) {
      console.error("Error in saveFileMessage:", error);
      throw error;
    } finally {
      client.release();
    }
  },

  async getMessageHistory(limit = 100) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT m.id, m.message_type as type, m.content, m.created_at, 
                u.username as name, u.id as user_id, m.target_user_id,
                m.file_name, m.file_type, m.file_size
         FROM messages m 
         JOIN users u ON m.user_id = u.id
         WHERE (m.message_type != 'private' OR m.target_user_id IS NULL)
         ORDER BY m.created_at DESC LIMIT $1`,
        [limit]
      );

      return result.rows.reverse().map((row) => {
        const message = {
          type: row.type,
          name: row.name,
          user_id: row.user_id,
          created_at: row.created_at,
          content: row.content,
        };

        if (row.type === "file") {
          message.file_name = row.file_name;
          message.file_type = row.file_type;
          message.file_size = row.file_size;
        }

        return message;
      });
    } catch (error) {
      console.error("Error in getMessageHistory:", error);
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
      
      // Дополнительная проверка: фильтруем пользователей, которые действительно онлайн в памяти
      const onlineUsers = result.rows.filter(user => {
        return Array.from(clients.values()).some(client => 
          client.userId === user.id && client.ws.readyState === WebSocket.OPEN
        );
      });
      
      return onlineUsers;
    } catch (error) {
      console.error("Error in getOnlineUsers:", error);
      throw error;
    } finally {
      client.release();
    }
  },

  async getUserById(userId) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        "SELECT id, username FROM users WHERE id = $1",
        [userId]
      );
      return result.rows[0];
    } catch (error) {
      console.error("Error in getUserById:", error);
      throw error;
    } finally {
      client.release();
    }
  },

  async isUsernameAvailable(userId, newUsername) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        "SELECT id FROM users WHERE username = $1 AND id != $2",
        [newUsername, userId]
      );
      return result.rows.length === 0;
    } catch (error) {
      console.error("Error in isUsernameAvailable:", error);
      throw error;
    } finally {
      client.release();
    }
  },

  async updateUsername(userId, newUsername) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        "UPDATE users SET username = $1 WHERE id = $2 RETURNING username",
        [newUsername, userId]
      );
      return result.rows[0];
    } catch (error) {
      console.error("Error in updateUsername:", error);
      throw error;
    } finally {
      client.release();
    }
  },
};

// HTTP сервер
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      timestamp: new Date().toISOString(),
      clients: clients.size,
      rooms: rooms.size,
      database: "connected"
    }));
    return;
  }

  let filePath = req.url;
  if (filePath === "/") filePath = "/index.html";

  const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, "");
  const fullPath = path.join(__dirname, safePath);

  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(__dirname, "index.html");
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        fs.createReadStream(indexPath).pipe(res);
      } else {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("File not found");
      }
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".json": "application/json",
      ".txt": "text/plain; charset=utf-8"
    };

    const contentType = contentTypes[ext] || "application/octet-stream";
    
    res.writeHead(200, { 
      "Content-Type": contentType,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });
    
    fs.createReadStream(fullPath).pipe(res);
  });
});

// WebSocket сервер
const wss = new WebSocket.Server({ 
  server, 
  perMessageDeflate: false,
  clientTracking: true
});

const clients = new Map();
const rooms = new Map();

function broadcast(data, exceptSessionId = null) {
  const message = JSON.stringify(data);
  clients.forEach((client, sessionId) => {
    if (sessionId !== exceptSessionId && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(message);
      } catch (error) {
        console.error(`Error broadcasting to client ${sessionId}:`, error);
      }
    }
  });
}

function broadcastToRoom(roomId, data, exceptSessionId = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  const message = JSON.stringify(data);
  room.users.forEach((userInfo, sessionId) => {
    if (sessionId !== exceptSessionId && clients.has(sessionId)) {
      const client = clients.get(sessionId);
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(message);
        } catch (error) {
          console.error(`Error broadcasting to room client ${sessionId}:`, error);
        }
      }
    }
  });
}

async function broadcastUsers() {
  try {
    const onlineUsers = await db.getOnlineUsers();
    const usersData = onlineUsers.map((user) => ({
      id: user.id,
      name: user.username,
      isOnline: true,
    }));

    console.log(`📊 Broadcasting ${usersData.length} online users`);
    broadcast({ type: "users", users: usersData });
  } catch (error) {
    console.error("Error broadcasting users:", error);
  }
}

wss.on("connection", async (ws, req) => {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  let currentUser = null;
  let userId = null;

  console.log(`🔌 New WebSocket connection: ${sessionId}`);

  try {
    // Создаем временное имя пользователя
    const tempUsername = `User_${sessionId.substr(7, 6)}`;
    currentUser = await db.findOrCreateUser(tempUsername);
    userId = currentUser.id;

    // Создаем сессию (она сама очистит дубликаты)
    await db.createUserSession(userId, sessionId);
    
    // Сохраняем в памяти
    clients.set(sessionId, { ws, user: currentUser, userId, sessionId });

    // Отправляем историю и инициализацию
    const history = await db.getMessageHistory();
    ws.send(JSON.stringify({ type: "history", history }));
    ws.send(JSON.stringify({
      type: "init",
      id: userId,
      name: currentUser.username,
      sessionId: sessionId,
    }));

    await db.saveMessage(userId, "system", `${currentUser.username} вошёл в чат`);
    broadcast({ type: "system", text: `🐱 ${currentUser.username} вошёл в чат` }, sessionId);
    await broadcastUsers();
    
    console.log(`✅ User ${currentUser.username} (${userId}) connected with session ${sessionId}`);
  } catch (error) {
    console.error("❌ Error during connection setup:", error);
    try {
      ws.close(1011, "Server error during connection setup");
    } catch (closeError) {
      console.error("Error closing connection:", closeError);
    }
    return;
  }

  ws.on("message", async (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
      
      if (!message || typeof message !== 'object') {
        throw new Error('Invalid message format');
      }
      
      if (!message.type) {
        throw new Error('Message type is required');
      }
    } catch (error) {
      console.error("Error parsing message:", error);
      ws.send(JSON.stringify({ 
        type: "error", 
        text: "❌ Неверный формат сообщения" 
      }));
      return;
    }

    try {
      switch (message.type) {
        case "setName":
          if (message.name && message.name.trim()) {
            const newName = message.name.trim();
            
            if (newName.length > 50) {
              ws.send(JSON.stringify({
                type: "system",
                text: "❌ Имя слишком длинное (максимум 50 символов)"
              }));
              return;
            }
            
            if (!/^[a-zA-Zа-яА-Я0-9_-\s]+$/.test(newName)) {
              ws.send(JSON.stringify({
                type: "system",
                text: "❌ Имя содержит недопустимые символы"
              }));
              return;
            }

            const isAvailable = await db.isUsernameAvailable(userId, newName);
            if (!isAvailable) {
              ws.send(JSON.stringify({
                type: "system",
                text: "❌ Это имя уже занято. Выберите другое."
              }));
              return;
            }

            const oldName = currentUser.username;
            currentUser.username = newName;

            // ИСПРАВЛЕНИЕ: Сначала обновляем имя, потом очищаем дубликаты
            await db.updateUsername(userId, newName);
            await db.saveMessage(userId, "action", `${oldName} сменил имя на ${newName}`);

            // Очищаем дублирующиеся сессии после смены имени
            const closedCount = await db.cleanupDuplicateSessions(userId, sessionId);
            
            if (closedCount > 0) {
              console.log(`🔄 Closed ${closedCount} duplicate sessions after name change`);
            }

            ws.send(JSON.stringify({
              type: "name_updated",
              userId: userId,
              newName: newName,
            }));

            broadcast({
              type: "action",
              name: oldName,
              text: `сменил имя на ${newName}`,
            });
            await broadcastUsers();
            ws.send(JSON.stringify({
              type: "system",
              text: `✅ Имя успешно изменено на ${newName}`
            }));
          }
          break;

        case "message":
          if (message.text && message.text.trim()) {
            const text = message.text.trim();
            
            if (text.length > 1000) {
              ws.send(JSON.stringify({
                type: "system",
                text: "❌ Сообщение слишком длинное (максимум 1000 символов)"
              }));
              return;
            }
            
            const savedMessage = await db.saveMessage(userId, "message", text);
            broadcast({
              type: "message",
              id: userId,
              name: currentUser.username,
              text: text,
              ts: savedMessage.created_at,
            });
          }
          break;

        case "file":
          if (message.filename && message.data) {
            try {
              if (message.size > 10 * 1024 * 1024) {
                ws.send(JSON.stringify({
                  type: "system",
                  text: "❌ Файл слишком большой (максимум 10MB)"
                }));
                return;
              }

              const allowedTypes = [
                'image/jpeg', 'image/png', 'image/gif', 'image/webp',
                'video/mp4', 'video/webm', 'video/ogg',
                'audio/mpeg', 'audio/wav', 'audio/ogg',
                'application/pdf', 'text/plain',
                'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              ];
              
              if (!allowedTypes.includes(message.filetype)) {
                ws.send(JSON.stringify({
                  type: "system",
                  text: "❌ Тип файла не поддерживается"
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
                type: "file",
                id: userId,
                name: currentUser.username,
                filename: message.filename,
                filetype: message.filetype,
                size: message.size,
                data: message.data,
                ts: Date.now(),
              });
            } catch (error) {
              console.error("Error saving file:", error);
              ws.send(JSON.stringify({
                type: "system",
                text: "❌ Ошибка при отправке файла"
              }));
            }
          }
          break;

        case "action":
          if (message.text && message.text.trim()) {
            const text = message.text.trim();
            await db.saveMessage(userId, "action", text);
            broadcast({
              type: "action",
              name: currentUser.username,
              text: text,
            });
          }
          break;

        case "reaction":
          if (message.emoji) {
            await db.saveMessage(userId, "reaction", message.emoji);
            broadcast({
              type: "reaction",
              name: currentUser.username,
              emoji: message.emoji,
            });
          }
          break;

        case "private":
          if (message.to && message.text && message.text.trim()) {
            const targetUser = await db.getUserById(message.to);
            if (targetUser) {
              const text = message.text.trim();
              await db.saveMessage(userId, "private", text, message.to);

              let targetClient = null;
              clients.forEach((client, sid) => {
                if (client.userId === message.to) {
                  targetClient = client;
                }
              });

              if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                targetClient.ws.send(JSON.stringify({
                  type: "private",
                  name: currentUser.username,
                  text: text,
                  fromUserId: userId
                }));

                ws.send(JSON.stringify({ type: "private_sent" }));
              } else {
                ws.send(JSON.stringify({
                  type: "system",
                  text: "❌ Пользователь не в сети"
                }));
              }
            }
          }
          break;

        // WebRTC сигнальные сообщения
        case "create_room":
          const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          rooms.set(roomId, {
            users: new Map([[sessionId, { 
              userId, 
              userName: currentUser.username,
              sessionId: sessionId 
            }]]),
            creator: sessionId,
            createdAt: Date.now(),
            isGroupCall: true
          });

          console.log(`📞 Room created: ${roomId} by ${currentUser.username}`);

          // Отправляем создателю подтверждение
          ws.send(JSON.stringify({ 
            type: "room_created", 
            roomId: roomId,
            message: "Групповой звонок создан. Ожидаем участников..."
          }));

          // Отправляем приглашение всем пользователям
          broadcast({
            type: "call_invite",
            fromUserId: userId,
            fromUserName: currentUser.username,
            roomId: roomId,
            isGroupCall: true,
          }, sessionId);
          break;

        case "start_individual_call":
          if (message.targetUserId) {
            const targetClient = Array.from(clients.values()).find(
              (client) => client.userId === message.targetUserId
            );
            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
              const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              rooms.set(roomId, {
                users: new Map([
                  [sessionId, { userId, userName: currentUser.username, sessionId: sessionId }],
                ]),
                creator: sessionId,
                createdAt: Date.now(),
                isGroupCall: false
              });

              console.log(`📞 Individual call room created: ${roomId} by ${currentUser.username}`);

              // Сначала отправляем подтверждение инициатору
              ws.send(JSON.stringify({
                type: "call_started",
                roomId: roomId,
                targetUserName: targetClient.user.username,
                message: `Вызываем ${targetClient.user.username}...`
              }));

              // Затем отправляем приглашение целевому пользователю
              targetClient.ws.send(JSON.stringify({
                type: "call_invite",
                fromUserId: userId,
                fromUserName: currentUser.username,
                roomId: roomId,
                isGroupCall: false,
              }));
            } else {
              ws.send(JSON.stringify({
                type: "system",
                text: "❌ Пользователь не в сети"
              }));
            }
          }
          break;

        case "join_room":
          if (message.roomId && rooms.has(message.roomId)) {
            const room = rooms.get(message.roomId);
            if (!room.users.has(sessionId)) {
              room.users.set(sessionId, { 
                userId, 
                userName: currentUser.username,
                sessionId: sessionId 
              });

              console.log(`👤 User ${currentUser.username} joined room ${message.roomId}`);

              // Отправляем обновленный список пользователей всем участникам комнаты
              const usersInRoom = Array.from(room.users.entries()).map(([sid, user]) => ({
                sessionId: sid,
                userId: user.userId,
                userName: user.userName,
              }));
              
              broadcastToRoom(message.roomId, {
                type: "room_users",
                users: usersInRoom,
                roomId: message.roomId,
              });

              // Отдельное уведомление о присоединении
              broadcastToRoom(message.roomId, {
                type: "user_joined",
                userId: userId,
                userName: currentUser.username,
                roomId: message.roomId,
                sessionId: sessionId,
              }, sessionId);

            }
          } else {
            ws.send(JSON.stringify({
              type: "system",
              text: "❌ Комната не найдена"
            }));
          }
          break;

        case "get_room_users":
          if (message.roomId && rooms.has(message.roomId)) {
            const room = rooms.get(message.roomId);
            const usersInRoom = Array.from(room.users.entries()).map(([sid, user]) => ({
              sessionId: sid,
              userId: user.userId,
              userName: user.userName,
            }));
            
            ws.send(JSON.stringify({
              type: "room_users",
              users: usersInRoom,
              roomId: message.roomId,
            }));
          }
          break;

        case "webrtc_offer":
          if (message.roomId && message.targetSessionId && message.offer) {
            const targetClient = clients.get(message.targetSessionId);
            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
              console.log(`📡 Forwarding WebRTC offer from ${sessionId} to ${message.targetSessionId}`);
              targetClient.ws.send(JSON.stringify({
                type: "webrtc_offer",
                fromSessionId: sessionId,
                fromUserId: userId,
                fromUserName: currentUser.username,
                roomId: message.roomId,
                offer: message.offer,
              }));
            } else {
              console.log(`❌ Target client not found: ${message.targetSessionId}`);
            }
          }
          break;

        case "webrtc_answer":
          if (message.roomId && message.targetSessionId && message.answer) {
            const targetClient = clients.get(message.targetSessionId);
            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
              console.log(`📡 Forwarding WebRTC answer from ${sessionId} to ${message.targetSessionId}`);
              targetClient.ws.send(JSON.stringify({
                type: "webrtc_answer",
                fromSessionId: sessionId,
                fromUserId: userId,
                roomId: message.roomId,
                answer: message.answer,
              }));
            }
          }
          break;

        case "webrtc_ice_candidate":
          if (message.roomId && message.targetSessionId && message.candidate) {
            const targetClient = clients.get(message.targetSessionId);
            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
              targetClient.ws.send(JSON.stringify({
                type: "webrtc_ice_candidate",
                fromSessionId: sessionId,
                fromUserId: userId,
                roomId: message.roomId,
                candidate: message.candidate,
              }));
            }
          }
          break;

        case "leave_room":
          if (message.roomId && rooms.has(message.roomId)) {
            const room = rooms.get(message.roomId);
            const userName = currentUser.username;
            
            room.users.delete(sessionId);

            console.log(`👤 User ${userName} left room ${message.roomId}`);

            broadcastToRoom(message.roomId, {
              type: "user_left",
              userId: userId,
              userName: userName,
              roomId: message.roomId,
              sessionId: sessionId,
            }, sessionId);

            // Обновляем список пользователей для оставшихся участников
            if (room.users.size > 0) {
              const usersInRoom = Array.from(room.users.entries()).map(([sid, user]) => ({
                sessionId: sid,
                userId: user.userId,
                userName: user.userName,
              }));
              
              broadcastToRoom(message.roomId, {
                type: "room_users",
                users: usersInRoom,
                roomId: message.roomId,
              });
            } else {
              rooms.delete(message.roomId);
              console.log(`🗑️ Room ${message.roomId} deleted (no users)`);
            }
          }
          break;

        case "call_rejected":
          if (message.roomId && rooms.has(message.roomId)) {
            const room = rooms.get(message.roomId);
            const caller = clients.get(room.creator);
            if (caller && caller.ws.readyState === WebSocket.OPEN) {
              caller.ws.send(JSON.stringify({
                type: "call_rejected",
                roomId: message.roomId,
                userName: currentUser.username
              }));
            }
            // Удаляем комнату если это индивидуальный звонок
            if (!room.isGroupCall) {
              rooms.delete(message.roomId);
              console.log(`🗑️ Individual call room ${message.roomId} deleted (rejected)`);
            }
          }
          break;

        case "end_call":
          if (message.roomId && rooms.has(message.roomId)) {
            const room = rooms.get(message.roomId);
            broadcastToRoom(message.roomId, {
              type: "call_ended",
              roomId: message.roomId,
              endedBy: currentUser.username
            });
            
            // Удаляем комнату
            rooms.delete(message.roomId);
            console.log(`📞 Call ended in room ${message.roomId} by ${currentUser.username}`);
          }
          break;

        default:
          console.log("❌ Unknown message type:", message.type);
          ws.send(JSON.stringify({
            type: "error",
            text: "❌ Неизвестный тип сообщения"
          }));
      }
    } catch (error) {
      console.error("❌ Error processing message:", error);
      try {
        ws.send(JSON.stringify({
          type: "system",
          text: "❌ Ошибка обработки сообщения"
        }));
      } catch (sendError) {
        console.error("Error sending error message:", sendError);
      }
    }
  });

  ws.on("close", async (code, reason) => {
    console.log(`🔌 WebSocket connection closed: ${sessionId} (user: ${currentUser?.username})`, code, reason?.toString());

    // ИСПРАВЛЕНИЕ: Не обрабатываем как ошибку закрытие дублирующих сессий
    if (code === 4000 && reason === "Duplicate session closed by new connection") {
      console.log(`🔄 Duplicate session ${sessionId} closed normally`);
      clients.delete(sessionId);
      return;
    }

    try {
      // Удаляем из комнат
      rooms.forEach((room, roomId) => {
        if (room.users.has(sessionId)) {
          const userName = currentUser?.username || "Unknown";
          room.users.delete(sessionId);

          try {
            broadcastToRoom(roomId, {
              type: "user_left",
              userId: userId,
              userName: userName,
              roomId: roomId,
              sessionId: sessionId,
            }, sessionId);

            // Обновляем список пользователей для оставшихся участников
            if (room.users.size > 0) {
              const usersInRoom = Array.from(room.users.entries()).map(([sid, user]) => ({
                sessionId: sid,
                userId: user.userId,
                userName: user.userName,
              }));
              
              broadcastToRoom(roomId, {
                type: "room_users",
                users: usersInRoom,
                roomId: roomId,
              });
            } else {
              rooms.delete(roomId);
            }
          } catch (error) {
            console.error("Error broadcasting user left:", error);
          }
        }
      });

      const clientData = clients.get(sessionId);
      if (clientData && currentUser) {
        await db.endUserSession(sessionId);
        clients.delete(sessionId);
        await db.saveMessage(userId, "system", `${currentUser.username} вышел из чат`);
        broadcast({
          type: "system",
          text: `🐱 ${currentUser.username} вышел из чата`,
        });
        await broadcastUsers();
        
        console.log(`✅ User ${currentUser.username} (${userId}) disconnected, session ${sessionId} removed`);
      }
    } catch (error) {
      console.error("❌ Error during connection cleanup:", error);
    }
  });

  ws.on("error", (error) => {
    console.error("❌ WebSocket error for session", sessionId, "user:", currentUser?.username, "error:", error);
  });
});

// Улучшенная очистка старых сессий
async function cleanupOldSessions() {
  try {
    const client = await pool.connect();
    
    // Закрываем сессии в базе данных старше 1 часа
    await client.query(`
      UPDATE user_sessions SET disconnected_at = CURRENT_TIMESTAMP 
      WHERE disconnected_at IS NULL AND connected_at < NOW() - INTERVAL '1 hour'
    `);
    
    // Закрываем соединения в памяти для пользователей с неактивными сессиями
    clients.forEach((clientData, sessionId) => {
      // Если соединение закрыто, но все еще в памяти - удаляем
      if (clientData.ws.readyState !== WebSocket.OPEN) {
        clients.delete(sessionId);
        console.log(`🧹 Removed closed connection from memory: ${sessionId}`);
      }
    });
    
    // Очищаем пустые комнаты (старше 1 часа)
    const now = Date.now();
    rooms.forEach((room, roomId) => {
      if (room.users.size === 0 && (now - room.createdAt) > 3600000) {
        rooms.delete(roomId);
        console.log(`🧹 Removed empty room: ${roomId}`);
      }
    });
    
    client.release();
    console.log("🧹 Old sessions and rooms cleaned up");
  } catch (error) {
    console.error("Error cleaning up old sessions:", error);
  }
}

setInterval(cleanupOldSessions, 10 * 60 * 1000); // Каждые 10 минут

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await db.init();
    await cleanupOldSessions();
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 WebSocket server ready for connections`);
      console.log(`❤️  Health check available at http://localhost:${PORT}/health`);
      console.log(`💾 Database connection established`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

function gracefulShutdown() {
  console.log("🔄 Starting graceful shutdown...");

  wss.close(() => {
    console.log("✅ WebSocket server closed");
  });

  clients.forEach((client, sessionId) => {
    try {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close(1001, "Server shutdown");
      }
    } catch (error) {
      console.error("Error closing client connection:", error);
    }
  });

  pool.end(() => {
    console.log("✅ Database pool closed");
    process.exit(0);
  });

  setTimeout(() => {
    console.log("⚠️ Forced shutdown");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown();
});

startServer();