# My Node.js Chat Application

This project is a simple chat application built with Node.js, utilizing WebSocket for real-time communication and serving static files. Below are the details regarding setup, usage, and features.

## Features

- Real-time chat functionality using WebSocket.
- User management with unique IDs and names.
- Chat history persistence using JSON.
- Static file serving for front-end assets.
- Logging utility for monitoring application behavior.

## Installation

1. Clone the repository:
   ```
   git clone <repository-url>
   cd my-nodejs-app
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory and configure your environment variables as needed.

## Usage

To start the application, run the following command:
```
node server.js
```

The server will start on the specified port (default is 3000). You can access the chat application by navigating to `http://localhost:3000` in your web browser.

## File Structure

- `server.js`: Main entry point for the application.
- `package.json`: Configuration file for npm.
- `.env`: Environment variables for configuration.
- `.gitignore`: Specifies files to ignore in Git.
- `README.md`: Documentation for the project.
- `utils.js`: Utility functions for the application.
- `logger.js`: Logging utility for the application.
- `chatHistory.json`: Stores chat history in JSON format.
- `config.js`: Configuration settings for the application.
- `test.js`: Test cases for the application.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any enhancements or bug fixes.

## License

This project is licensed under the MIT License.