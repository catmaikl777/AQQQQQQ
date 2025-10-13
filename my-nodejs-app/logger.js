const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, 'app.log');

function logMessage(level, message) {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} [${level.toUpperCase()}]: ${message}\n`;
    
    console.log(logEntry.trim());
    fs.appendFile(logFilePath, logEntry, (err) => {
        if (err) {
            console.error('Failed to write to log file:', err);
        }
    });
}

function info(message) {
    logMessage('info', message);
}

function warn(message) {
    logMessage('warn', message);
}

function error(message) {
    logMessage('error', message);
}

module.exports = {
    info,
    warn,
    error
};