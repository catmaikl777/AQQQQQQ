const fs = require('fs');

// Function to validate if a string is not empty
function validateNonEmptyString(str) {
  return typeof str === 'string' && str.trim() !== '';
}

// Function to format a timestamp into a readable date string
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

// Function to save chat history to a JSON file
function saveChatHistory(filePath, chatHistory) {
  fs.writeFileSync(filePath, JSON.stringify(chatHistory, null, 2), 'utf-8');
}

// Function to load chat history from a JSON file
function loadChatHistory(filePath) {
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  }
  return [];
}

module.exports = {
  validateNonEmptyString,
  formatTimestamp,
  saveChatHistory,
  loadChatHistory
};