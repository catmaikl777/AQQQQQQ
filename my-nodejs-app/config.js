const dotenv = require('dotenv');

dotenv.config();

const config = {
  PORT: process.env.PORT || 3000,
  DB_CONNECTION_STRING: process.env.DB_CONNECTION_STRING || 'mongodb://localhost:27017/mydatabase',
  CHAT_HISTORY_FILE: process.env.CHAT_HISTORY_FILE || 'chatHistory.json',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};

module.exports = config;