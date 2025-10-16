// server.js (исправленная версия)
const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { Pool } = require("pg");

// Настройка подключения к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  maxUses: 7500,
});

pool.on("error", (err, client) => {
  console.error("Unexpected error on idle client", err);
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

      await this.ensureFileColumns(client);

      console.log("Database tables initialized successfully");
    } catch (error) {
      console.error("Error initializing database:", error);
      throw error;
    } finally {
      client.release();
    }
  },

  async ensureFileColumns(client) {
    try {
      await client.query("SELECT file_name FROM messages LIMIT 1");
    } catch (error) {
      if (error.code === "42703") {
        console.log("Adding file columns to messages table...");
        await client.query(
          "ALTER TABLE messages ADD COLUMN file_name VARCHAR(255)"
        );
        await client.query(
          "ALTER TABLE messages ADD COLUMN file_type VARCHAR(100)"
        );
        await client.query("ALTER TABLE messages ADD COLUMN file_size INTEGER");
        await client.query("ALTER TABLE messages ADD COLUMN file_data BYTEA");
        console.log("File columns added successfully");
      } else {
        throw error;
      }
    }
  },

  async cleanupDuplicateSessions(userId, currentSessionId) {
    const client = await pool.connect();
    try {
      await client.query(
        "UPDATE user_sessions SET disconnected_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND session_id != $2 AND disconnected_at IS NULL",
        [userId, currentSessionId]
      );
      console.log(`Cleaned up duplicate sessions for user ${userId}`);
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

  async ensureFileColumns(client) {
    try {
      await client.query("SELECT file_name FROM messages LIMIT 1");
    } catch (error) {
      if (error.code === "42703") {
        console.log("Adding file columns to messages table...");
        await client.query(
          "ALTER TABLE messages ADD COLUMN file_name VARCHAR(255)"
        );
        await client.query(
          "ALTER TABLE messages ADD COLUMN file_type VARCHAR(100)"
        );
        await client.query("ALTER TABLE messages ADD COLUMN file_size INTEGER");
        await client.query("ALTER TABLE messages ADD COLUMN file_data BYTEA");
        console.log("File columns added successfully");
      } else {
        throw error;
      }
    }
  },

  async createUserSession(userId, sessionId) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        "INSERT INTO user_sessions (user_id, session_id) VALUES ($1, $2) RETURNING id",
        [userId, sessionId]
      );
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

  async saveMessage(
    userId,
    messageType,
    content,
    targetUserId = null,
    fileData = null
  ) {
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

  async saveFileMessage(
    userId,
    filename,
    filetype,
    size,
    data,
    targetUserId = null
  ) {
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
      const tableInfo = await client.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name IN ('file_name', 'file_type', 'file_size')
      `);
      const existingColumns = tableInfo.rows.map((row) => row.column_name);
      const hasFileColumns = existingColumns.includes("file_name");
      let fileColumnsSelect = hasFileColumns
        ? ", m.file_name, m.file_type, m.file_size"
        : "";

      const result = await client.query(
        `SELECT m.id, m.message_type as type, m.content, m.created_at, u.username as name, u.id as user_id, m.target_user_id ${fileColumnsSelect}
         FROM messages m JOIN users u ON m.user_id = u.id
         WHERE (m.message_type != 'private' OR m.target_user_id IS NULL)
         ORDER BY m.created_at DESC LIMIT $1`,
        [limit]
      );

      const history = result.rows.reverse().map((row) => {
        const message = {
          type: row.type,
          name: row.name,
          user_id: row.user_id,
          created_at: row.created_at,
          content: row.content,
        };

        if (row.type === "file" && hasFileColumns) {
          message.file_name = row.file_name;
          message.file_type = row.file_type;
          message.file_size = row.file_size;
        }

        return message;
      });

      return history;
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
        SELECT DISTINCT u.id, u.username FROM users u
        JOIN user_sessions us ON u.id = us.user_id
        WHERE us.disconnected_at IS NULL ORDER BY u.username
      `);
      return result.rows;
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  let filePath = req.url;
  if (filePath === "/") filePath = "/index.html";

  const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, "");
  const fullPath = path.join(__dirname, safePath);

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
    const contentType =
      {
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
      }[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(fullPath).pipe(res);
  });
});

// WebSocket сервер с WebRTC
const wss = new WebSocket.Server({ server, perMessageDeflate: false });

const clients = new Map();
const rooms = new Map();

function broadcast(data, exceptSessionId = null) {
  const message = JSON.stringify(data);
  clients.forEach((client, sessionId) => {
    if (
      sessionId !== exceptSessionId &&
      client.ws.readyState === WebSocket.OPEN
    ) {
      client.ws.send(message);
    }
  });
}

function broadcastToRoom(roomId, data, exceptSessionId = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.users.forEach((userInfo, sessionId) => {
    if (sessionId !== exceptSessionId && clients.has(sessionId)) {
      const client = clients.get(sessionId);
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(data));
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

    const message = JSON.stringify({ type: "users", users: usersData });

    clients.forEach((client, sessionId) => {
      try {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(message);
        }
      } catch (error) {
        console.error(`Error sending to client ${sessionId}:`, error);
      }
    });
  } catch (error) {
    console.error("Error broadcasting users:", error);
  }
}

wss.on("connection", async (ws, req) => {
  const sessionId = `session_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;
  let currentUser = null;
  let userId = null;

  console.log(`New WebSocket connection: ${sessionId}`);

  try {
    const tempUsername = `User_${sessionId.substr(7, 6)}`;
    currentUser = await db.findOrCreateUser(tempUsername);
    userId = currentUser.id;

    await db.createUserSession(userId, sessionId);
    clients.set(sessionId, { ws, user: currentUser, userId, sessionId });

    const history = await db.getMessageHistory();
    ws.send(JSON.stringify({ type: "history", history }));
    ws.send(
      JSON.stringify({
        type: "init",
        id: userId,
        name: currentUser.username,
        sessionId: sessionId,
      })
    );

    await db.saveMessage(
      userId,
      "system",
      `${currentUser.username} вошёл в чат`
    );
    broadcast(
      { type: "system", text: `🐱 ${currentUser.username} вошёл в чат` },
      sessionId
    );
    await broadcastUsers();
  } catch (error) {
    console.error("Error during connection setup:", error);
    ws.close();
    return;
  }

  ws.on("message", async (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      console.error("Error parsing message:", error);
      return;
    }

    try {
      // Обработка разных типов сообщений...
      switch (message.type) {
        case "setName":
          if (message.name && message.name.trim()) {
            const newName = message.name.trim();
            const isAvailable = await db.isUsernameAvailable(userId, newName);
            if (!isAvailable) {
              ws.send(
                JSON.stringify({
                  type: "system",
                  text: "❌ Это имя уже занято. Выберите другое.",
                })
              );
              return;
            }

            // Очищаем старые сессии с тем же именем
            const oldName = currentUser.username;
            currentUser.username = newName;

            // Обновляем имя в базе
            await db.updateUsername(userId, newName);

            // Завершаем все сессии со старым именем (кроме текущей)
            await db.cleanupDuplicateSessions(userId, sessionId);

            await db.saveMessage(
              userId,
              "action",
              `${oldName} сменил имя на ${newName}`
            );

            // Отправляем подтверждение клиенту
            ws.send(
              JSON.stringify({
                type: "name_updated",
                userId: userId,
                newName: newName,
              })
            );

            broadcast({
              type: "action",
              name: oldName,
              text: `сменил имя на ${newName}`,
            });
            await broadcastUsers();
            ws.send(
              JSON.stringify({
                type: "system",
                text: `✅ Имя успешно изменено на ${newName}`,
              })
            );
          }
          break;

        case "message":
          if (message.text && message.text.trim()) {
            const text = message.text.trim();
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

        case "call_busy":
          if (message.roomId && message.fromUserId) {
            const fromClient = Array.from(clients.values()).find(
              (client) => client.userId === message.fromUserId
            );
            if (fromClient && fromClient.ws.readyState === WebSocket.OPEN) {
              fromClient.ws.send(
                JSON.stringify({
                  type: "system",
                  text: "❌ Пользователь занят в другом звонке",
                })
              );
            }
          }
          break;

        case "file":
          if (message.filename && message.data) {
            try {
              if (message.size > 10 * 1024 * 1024) {
                ws.send(
                  JSON.stringify({
                    type: "system",
                    text: "❌ Файл слишком большой (максимум 10MB)",
                  })
                );
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
              ws.send(
                JSON.stringify({
                  type: "system",
                  text: "❌ Ошибка при отправке файла",
                })
              );
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

              if (
                targetClient &&
                targetClient.ws.readyState === WebSocket.OPEN
              ) {
                targetClient.ws.send(
                  JSON.stringify({
                    type: "private",
                    name: currentUser.username,
                    text: text,
                  })
                );

                ws.send(JSON.stringify({ type: "private_sent" }));
              } else {
                ws.send(
                  JSON.stringify({
                    type: "system",
                    text: "❌ Пользователь не в сети",
                  })
                );
              }
            }
          }
          break;

        // WebRTC сигнальные сообщения
        case "create_room":
          const roomId = `room_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;
          rooms.set(roomId, {
            users: new Map([
              [sessionId, { userId, userName: currentUser.username }],
            ]),
            caller: sessionId,
          });

          broadcast(
            {
              type: "call_invite",
              fromUserId: userId,
              fromUserName: currentUser.username,
              roomId: roomId,
              isGroupCall: true,
            },
            sessionId
          );

          ws.send(JSON.stringify({ type: "room_created", roomId }));
          break;

        case "start_individual_call":
          if (message.targetUserId) {
            const targetClient = Array.from(clients.values()).find(
              (client) => client.userId === message.targetUserId
            );
            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
              const roomId = `room_${Date.now()}_${Math.random()
                .toString(36)
                .substr(2, 9)}`;
              rooms.set(roomId, {
                users: new Map([
                  [sessionId, { userId, userName: currentUser.username }],
                  [
                    targetClient.sessionId,
                    {
                      userId: targetClient.userId,
                      userName: targetClient.user.username,
                    },
                  ],
                ]),
                caller: sessionId,
              });

              targetClient.ws.send(
                JSON.stringify({
                  type: "call_invite",
                  fromUserId: userId,
                  fromUserName: currentUser.username,
                  roomId: roomId,
                  isGroupCall: false,
                })
              );

              ws.send(
                JSON.stringify({
                  type: "call_started",
                  roomId: roomId,
                  targetUserName: targetClient.user.username,
                })
              );
            } else {
              ws.send(
                JSON.stringify({
                  type: "system",
                  text: "❌ Пользователь не в сети",
                })
              );
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
              });

              broadcastToRoom(
                message.roomId,
                {
                  type: "user_joined",
                  userId: userId,
                  userName: currentUser.username,
                  roomId: message.roomId,
                  sessionId: sessionId, // Добавьте sessionId
                },
                sessionId
              );

              const usersInRoom = Array.from(room.users.entries()).map(
                ([sid, user]) => ({
                  sessionId: sid, // Убедитесь что отправляется sessionId
                  userId: user.userId,
                  userName: user.userName,
                })
              );
              ws.send(
                JSON.stringify({
                  type: "room_users",
                  users: usersInRoom,
                  roomId: message.roomId,
                })
              );
            }
          }
          break;

        case "webrtc_offer":
          if (message.roomId && message.targetSessionId && message.offer) {
            const targetClient = clients.get(message.targetSessionId);
            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
              targetClient.ws.send(
                JSON.stringify({
                  type: "webrtc_offer",
                  fromSessionId: sessionId,
                  fromUserId: userId,
                  fromUserName: currentUser.username,
                  roomId: message.roomId,
                  offer: message.offer,
                })
              );
            }
          }
          break;

        case "webrtc_answer":
          if (message.roomId && message.targetSessionId && message.answer) {
            const targetClient = clients.get(message.targetSessionId);
            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
              targetClient.ws.send(
                JSON.stringify({
                  type: "webrtc_answer",
                  fromSessionId: sessionId,
                  fromUserId: userId,
                  roomId: message.roomId,
                  answer: message.answer,
                })
              );
            }
          }
          break;

        case "webrtc_ice_candidate":
          if (message.roomId && message.targetSessionId && message.candidate) {
            const targetClient = clients.get(message.targetSessionId);
            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
              targetClient.ws.send(
                JSON.stringify({
                  type: "webrtc_ice_candidate",
                  fromSessionId: sessionId,
                  fromUserId: userId,
                  roomId: message.roomId,
                  candidate: message.candidate,
                })
              );
            }
          }
          break;

        case "leave_room":
          if (message.roomId && rooms.has(message.roomId)) {
            const room = rooms.get(message.roomId);
            room.users.delete(sessionId);

            broadcastToRoom(
              message.roomId,
              {
                type: "user_left",
                userId: userId,
                userName: currentUser.username,
                roomId: message.roomId,
              },
              sessionId
            );

            if (room.users.size === 0) {
              rooms.delete(message.roomId);
            }
          }
          break;

        default:
          console.log("Unknown message type:", message.type);
      }
    } catch (error) {
      console.error("Error processing message:", error);
      try {
        ws.send(
          JSON.stringify({
            type: "system",
            text: "❌ Ошибка обработки сообщения",
          })
        );
      } catch (sendError) {
        console.error("Error sending error message:", sendError);
      }
    }
  });

  ws.on("close", async () => {
    console.log(`WebSocket connection closed: ${sessionId}`);

    try {
      // Удаляем из комнат
      rooms.forEach((room, roomId) => {
        if (room.users.has(sessionId)) {
          room.users.delete(sessionId);
          try {
            broadcastToRoom(
              roomId,
              {
                type: "user_left",
                userId: userId,
                userName: currentUser.username,
                roomId: roomId,
              },
              sessionId
            );
          } catch (error) {
            console.error("Error broadcasting user left:", error);
          }

          if (room.users.size === 0) {
            rooms.delete(roomId);
          }
        }
      });

      const clientData = clients.get(sessionId);
      if (clientData) {
        await db.endUserSession(sessionId);
        clients.delete(sessionId);
        await db.saveMessage(
          userId,
          "system",
          `${currentUser.username} вышел из чата`
        );
        broadcast({
          type: "system",
          text: `🐱 ${currentUser.username} вышел из чата`,
        });
        await broadcastUsers();
      }
    } catch (error) {
      console.error("Error during connection cleanup:", error);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error for session", sessionId, ":", error);
  });
});

// Очистка старых сессий
async function cleanupOldSessions() {
  try {
    const client = await pool.connect();
    await client.query(`
      UPDATE user_sessions SET disconnected_at = CURRENT_TIMESTAMP 
      WHERE disconnected_at IS NULL AND connected_at < NOW() - INTERVAL '1 hour'
    `);
    client.release();
    console.log("Old sessions cleaned up");
  } catch (error) {
    console.error("Error cleaning up old sessions:", error);
  }
}

setInterval(cleanupOldSessions, 30 * 60 * 1000);

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await db.init();
    await cleanupOldSessions();
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`WebSocket server ready for connections`);
      console.log(`Health check available at http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

function gracefulShutdown() {
  console.log("Starting graceful shutdown...");

  // Закрываем WebSocket соединения
  wss.close(() => {
    console.log("WebSocket server closed");
  });

  // Закрываем все клиентские соединения
  clients.forEach((client, sessionId) => {
    try {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close(1001, "Server shutdown");
      }
    } catch (error) {
      console.error("Error closing client connection:", error);
    }
  });

  // Закрываем пул базы данных
  pool.end(() => {
    console.log("Database pool closed");
    process.exit(0);
  });

  // Принудительный выход через 10 секунд
  setTimeout(() => {
    console.log("Forced shutdown");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// Health check endpoint
server.on("request", (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        timestamp: new Date().toISOString(),
        clients: clients.size,
        rooms: rooms.size,
      })
    );
    return;
  }
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");
  for (const [sessionId, clientData] of clients.entries()) {
    await db.endUserSession(sessionId);
  }
  await pool.end();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

startServer();
