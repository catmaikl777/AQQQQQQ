const assert = require('assert');
const { server } = require('./server'); // Assuming server.js exports the server instance
const WebSocket = require('ws');

describe('Chat Application Tests', () => {
  let ws;

  before((done) => {
    server.listen(3000, () => {
      ws = new WebSocket('ws://localhost:3000');
      ws.on('open', done);
    });
  });

  after((done) => {
    ws.close();
    server.close(done);
  });

  it('should connect to the WebSocket server', (done) => {
    ws.on('message', (message) => {
      const data = JSON.parse(message);
      assert.strictEqual(data.type, 'init');
      done();
    });
  });

  it('should broadcast messages to other clients', (done) => {
    const ws2 = new WebSocket('ws://localhost:3000');
    ws2.on('open', () => {
      ws.send(JSON.stringify({ type: 'message', text: 'Hello, World!' }));
    });

    ws2.on('message', (message) => {
      const data = JSON.parse(message);
      assert.strictEqual(data.type, 'message');
      assert.strictEqual(data.text, 'Hello, World!');
      ws2.close();
      done();
    });
  });

  it('should allow users to change their name', (done) => {
    ws.send(JSON.stringify({ type: 'setName', name: 'NewUser' }));

    ws.on('message', (message) => {
      const data = JSON.parse(message);
      assert.strictEqual(data.type, 'system');
      assert.strictEqual(data.text, 'User1 сменил имя на NewUser'); // Adjust based on actual user ID
      done();
    });
  });
});