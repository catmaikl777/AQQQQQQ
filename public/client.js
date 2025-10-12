(() => {
  const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host;
  const ws = new WebSocket(wsUrl);

  const messagesEl = document.getElementById('messages');
  const messageForm = document.getElementById('messageForm');
  const messageInput = document.getElementById('messageInput');
  const nameInput = document.getElementById('nameInput');
  const setNameBtn = document.getElementById('setName');
  const userListEl = document.getElementById('userList');

  let myId = null;
  const users = new Map();
  let historyLoaded = false;

  // Эмодзи-панель
  const emojiPanel = document.createElement('div');
  emojiPanel.className = 'emoji-panel';
  ['😀','😂','👍','🔥','❤️','🎉','😎','😢','🤔','🙏'].forEach(emoji => {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.onclick = () => {
      ws.send(JSON.stringify({ type: 'reaction', emoji }));
    };
    emojiPanel.appendChild(btn);
  });
  messagesEl.parentNode.insertBefore(emojiPanel, messagesEl);

  // Приватные сообщения по клику на пользователя
  userListEl.addEventListener('click', (e) => {
    if (e.target.tagName === 'LI') {
      const name = e.target.textContent;
      const user = Array.from(users.values()).find(u => u.name === name);
      if (user && user.id !== myId) {
        const text = prompt(`Приватное сообщение для ${name}:`);
        if (text) {
          ws.send(JSON.stringify({ type: 'private', to: user.id, text }));
        }
      }
    }
  });

  // Отображение истории сообщений
  function showHistory(history) {
    messagesEl.innerHTML = '';
    history.forEach(data => {
      if (data.type === 'message') {
        const el = document.createElement('div');
        el.className = 'message' + (data.id === myId ? ' me' : '');
        el.innerHTML = `<strong>${escapeHtml(data.name)}:</strong> ${escapeHtml(data.text)}`;
        addMessage(el);
      }
      if (data.type === 'system') {
        const el = document.createElement('div');
        el.className = 'system';
        el.textContent = data.text;
        addMessage(el);
      }
      if (data.type === 'action') {
        const el = document.createElement('div');
        el.className = 'action';
        el.textContent = `${data.name} ${data.text}`;
        addMessage(el);
      }
      if (data.type === 'reaction') {
        const el = document.createElement('div');
        el.className = 'reaction';
        el.textContent = `${data.name} отправил реакцию ${data.emoji}`;
        addMessage(el);
      }
      if (data.type === 'private') {
        const el = document.createElement('div');
        el.className = 'private';
        el.innerHTML = `<strong>ЛС от ${escapeHtml(data.name)}:</strong> ${escapeHtml(data.text)}`;
        addMessage(el);
      }
    });
  }

  function addMessage(node) {
    messagesEl.appendChild(node);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderUserList() {
    userListEl.innerHTML = '';
    Array.from(users.values()).forEach(u => {
      const li = document.createElement('li');
      li.textContent = u.name;
      userListEl.appendChild(li);
    });
  }

  ws.addEventListener('message', (ev) => {
    let data;
    try { data = JSON.parse(ev.data); } catch (e) { return; }

    if (data.type === 'init') {
      myId = data.id;
      users.set(data.id, { id: data.id, name: data.name });
      renderUserList();
      nameInput.value = data.name;
      const sys = document.createElement('div');
      sys.className = 'system';
      sys.textContent = `Вы подключены как ${data.name}`;
      addMessage(sys);
      return;
    }

    if (data.type === 'system') {
      // system message
      const el = document.createElement('div');
      el.className = 'system';
      el.textContent = data.text;
      addMessage(el);
      return;
    }

    if (data.type === 'message') {
      users.set(data.id, { id: data.id, name: data.name });
      renderUserList();

      const el = document.createElement('div');
      el.className = 'message' + (data.id === myId ? ' me' : '');
      el.innerHTML = `<strong>${escapeHtml(data.name)}:</strong> ${escapeHtml(data.text)}`;
      addMessage(el);
      return;
    }

    if (data.type === 'users') {
      users.clear();
      data.users.forEach(u => users.set(u.id, u));
      renderUserList();
      return;
    }

    if (data.type === 'history' && !historyLoaded) {
      showHistory(data.history);
      historyLoaded = true;
      return;
    }

    if (data.type === 'action') {
      const el = document.createElement('div');
      el.className = 'action';
      el.textContent = `${data.name} ${data.text}`;
      addMessage(el);
      return;
    }

    if (data.type === 'reaction') {
      const el = document.createElement('div');
      el.className = 'reaction';
      el.textContent = `${data.name} отправил реакцию ${data.emoji}`;
      addMessage(el);
      return;
    }

    if (data.type === 'private') {
      const el = document.createElement('div');
      el.className = 'private';
      el.innerHTML = `<strong>ЛС от ${escapeHtml(data.name)}:</strong> ${escapeHtml(data.text)}`;
      addMessage(el);
      return;
    }
  });

  // Команды чата
  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text) return;
    ws.send(JSON.stringify({ type: 'message', text }));
    messageInput.value = '';
  });

  setNameBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return;
    ws.send(JSON.stringify({ type: 'setName', name }));
  });

  // Стили для новых элементов
  const style = document.createElement('style');
  style.textContent = `
    .emoji-panel { display: flex; gap: 4px; margin-bottom: 8px; }
    .emoji-panel button { font-size: 20px; padding: 2px 8px; border: none; background: #f3f4f6; border-radius: 6px; cursor: pointer; }
    .action { color: #2563eb; font-style: italic; margin: 4px 0; }
    .reaction { color: #f59e42; margin: 4px 0; }
    .private { background: #fef3c7; border-radius: 8px; padding: 6px; margin: 4px 0; }
  `;
  document.head.appendChild(style);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','\\':'\\\\','"':'&quot;', "'":'&#39;'}[c]); });
  }
})();
