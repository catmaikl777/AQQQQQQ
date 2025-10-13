<<<<<<< HEAD
// client.js (улучшенная версия)
(() => {
  const wsUrl = 'https://aqqqqqq-1.onrender.com';
=======
(() => {
  const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host;
>>>>>>> 65a3c9efa3e752f835231d667373d22f778cce6d
  const ws = new WebSocket(wsUrl);

  const messagesEl = document.getElementById('messages');
  const messageForm = document.getElementById('messageForm');
  const messageInput = document.getElementById('messageInput');
  const nameInput = document.getElementById('nameInput');
  const setNameBtn = document.getElementById('setName');
  const userListEl = document.getElementById('userList');
<<<<<<< HEAD
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebarToggle');
  const closeSidebar = document.getElementById('closeSidebar');
  const overlay = document.getElementById('overlay');
  const onlineCount = document.getElementById('onlineCount');
=======
>>>>>>> 65a3c9efa3e752f835231d667373d22f778cce6d

  let myId = null;
  const users = new Map();
  let historyLoaded = false;
<<<<<<< HEAD
  let isConnected = false;

  // Адаптация для мобильных устройств
  function setVH() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
    adjustChatHeight();
  }

  function adjustChatHeight() {
    const headerHeight = document.querySelector('.sidebar-header')?.offsetHeight || 0;
    const formHeight = messageForm?.offsetHeight || 0;
    const emojiHeight = document.querySelector('.emoji-panel')?.offsetHeight || 0;
    
    messagesEl.style.height = `calc(var(--vh, 1vh) * 100 - ${headerHeight + formHeight + emojiHeight + 20}px)`;
  }

  setVH();
  window.addEventListener('resize', setVH);
  window.addEventListener('orientationchange', setVH);

  // Управление сайдбаром
  function toggleSidebar() {
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
    document.body.style.overflow = sidebar.classList.contains('active') ? 'hidden' : '';
  }

  sidebarToggle.addEventListener('click', toggleSidebar);
  closeSidebar.addEventListener('click', toggleSidebar);
  overlay.addEventListener('click', toggleSidebar);

  // Обновление списка пользователей
  function renderUserList() {
    userListEl.innerHTML = '';
    const onlineUsers = Array.from(users.values()).filter(u => u.isOnline);
    
    if (onlineCount) {
      onlineCount.textContent = `Онлайн: ${onlineUsers.length}`;
    }

    onlineUsers.forEach(u => {
      const li = document.createElement('li');
      li.className = `user-item ${u.id === myId ? 'me' : ''}`;
      li.innerHTML = `
        <span class="user-status online"></span>
        <span class="user-name">${escapeHtml(u.name)}</span>
        ${u.id === myId ? '<span class="you-badge">(Вы)</span>' : ''}
      `;
      
      if (u.id !== myId) {
        li.addEventListener('click', () => {
          const text = prompt(`Приватное сообщение для ${u.name}:`);
          if (text) {
            ws.send(JSON.stringify({ type: 'private', to: u.id, text }));
          }
          if (window.innerWidth <= 768) {
            toggleSidebar();
          }
        });
      }
      
      userListEl.appendChild(li);
    });
  }
=======
>>>>>>> 65a3c9efa3e752f835231d667373d22f778cce6d

  // Эмодзи-панель
  const emojiPanel = document.createElement('div');
  emojiPanel.className = 'emoji-panel';
<<<<<<< HEAD
  const emojis = ['😀','😂','👍','🔥','❤️','🎉','😎','😢','🤔','🙏','👋','🎂','💯','🚀','⭐'];
  
  emojis.forEach(emoji => {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      ws.send(JSON.stringify({ type: 'reaction', emoji }));
      messageInput.blur();
    });
    emojiPanel.appendChild(btn);
  });
  
  messagesEl.parentNode.insertBefore(emojiPanel, messagesEl);

  // Отображение сообщений
  function addMessage(node) {
    messagesEl.appendChild(node);
    setTimeout(() => {
      messagesEl.scrollTo({
        top: messagesEl.scrollHeight,
        behavior: 'smooth'
      });
    }, 50);
  }

  function showHistory(history) {
    messagesEl.innerHTML = '';
    history.forEach(data => {
      let el;
      
      switch (data.type) {
        case 'message':
          el = document.createElement('div');
          el.className = 'message' + (data.user_id === myId ? ' me' : '');
          el.innerHTML = `
            <div class="message-header">
              <strong>${escapeHtml(data.name)}</strong>
              <span class="message-time">${formatTime(data.created_at)}</span>
            </div>
            <div class="message-text">${escapeHtml(data.content)}</div>
          `;
          break;
          
        case 'system':
          el = document.createElement('div');
          el.className = 'system';
          el.textContent = data.content;
          break;
          
        case 'action':
          el = document.createElement('div');
          el.className = 'action';
          el.textContent = `${data.name} ${data.content}`;
          break;
          
        case 'reaction':
          el = document.createElement('div');
          el.className = 'reaction';
          el.textContent = `${data.name} отправил реакцию ${data.content}`;
          break;
          
        default:
          return;
      }
      
      if (el) addMessage(el);
    });
    historyLoaded = true;
  }

  // Обработчик WebSocket сообщений
  ws.addEventListener('open', () => {
    isConnected = true;
    console.log('Connected to server');
  });

  ws.addEventListener('message', (ev) => {
    let data;
    try { 
      data = JSON.parse(ev.data); 
    } catch (e) { 
      console.error('Error parsing message:', e);
      return; 
    }

    switch (data.type) {
      case 'init':
        myId = data.id;
        users.set(data.id, { id: data.id, name: data.name, isOnline: true });
        renderUserList();
        nameInput.value = data.name;
        showSystemMessage(`Вы подключены как ${data.name}`);
        break;

      case 'history':
        if (!historyLoaded) {
          showHistory(data.history);
        }
        break;

      case 'system':
        showSystemMessage(data.text);
        break;

      case 'message':
        users.set(data.id, { id: data.id, name: data.name, isOnline: true });
        renderUserList();
        
        const messageEl = document.createElement('div');
        messageEl.className = 'message' + (data.id === myId ? ' me' : '');
        messageEl.innerHTML = `
          <div class="message-header">
            <strong>${escapeHtml(data.name)}</strong>
            <span class="message-time">${formatTime(data.ts)}</span>
          </div>
          <div class="message-text">${escapeHtml(data.text)}</div>
        `;
        addMessage(messageEl);
        break;

      case 'users':
        users.clear();
        data.users.forEach(u => users.set(u.id, u));
        renderUserList();
        break;

      case 'action':
        const actionEl = document.createElement('div');
        actionEl.className = 'action';
        actionEl.textContent = `${data.name} ${data.text}`;
        addMessage(actionEl);
        break;

      case 'reaction':
        const reactionEl = document.createElement('div');
        reactionEl.className = 'reaction';
        reactionEl.textContent = `${data.name} отправил реакцию ${data.emoji}`;
        addMessage(reactionEl);
        break;

      case 'private':
        const privateEl = document.createElement('div');
        privateEl.className = 'private';
        privateEl.innerHTML = `
          <div class="message-header">
            <strong>ЛС от ${escapeHtml(data.name)}</strong>
            <span class="message-time">${formatTime(Date.now())}</span>
          </div>
          <div class="message-text">${escapeHtml(data.text)}</div>
        `;
        addMessage(privateEl);
        
        // Вибрация на мобильных
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        
        // Уведомление
        if (document.hidden) {
          showNotification(`ЛС от ${data.name}`, data.text);
        }
        break;

      case 'private_sent':
        showSystemMessage(`Приватное сообщение отправлено`);
        break;
    }
  });

  ws.addEventListener('close', () => {
    isConnected = false;
    showSystemMessage('Соединение потеряно. Попытка переподключения...');
    setTimeout(() => window.location.reload(), 5000);
  });

  ws.addEventListener('error', (error) => {
    console.error('WebSocket error:', error);
    showSystemMessage('Ошибка соединения');
  });

  // Обработчики форм
  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !isConnected) return;
    
    ws.send(JSON.stringify({ type: 'message', text }));
    messageInput.value = '';
    messageInput.focus();
=======
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
>>>>>>> 65a3c9efa3e752f835231d667373d22f778cce6d
  });

  setNameBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
<<<<<<< HEAD
    if (!name || !isConnected) return;
    ws.send(JSON.stringify({ type: 'setName', name }));
    nameInput.blur();
  });

  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      messageForm.dispatchEvent(new Event('submit'));
    }
  });

  // Адаптация к изменению размера окна
  window.addEventListener('resize', () => {
    adjustChatHeight();
    if (window.innerWidth > 768) {
      sidebar.classList.remove('active');
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  });

  // Вспомогательные функции
  function showSystemMessage(text) {
    const el = document.createElement('div');
    el.className = 'system';
    el.textContent = text;
    addMessage(el);
  }

  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString('ru-RU', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  function showNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { 
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'}[c]); 
    });
  }

  // Запрос разрешения на уведомления
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Добавление стилей
  const style = document.createElement('style');
  style.textContent = `
    .message-header { 
      display: flex; 
      justify-content: between; 
      align-items: center; 
      margin-bottom: 4px; 
    }
    .message-time { 
      font-size: 11px; 
      color: #6b7280; 
      margin-left: auto;
    }
    .user-item { 
      display: flex; 
      align-items: center; 
      gap: 8px; 
      padding: 10px; 
      border-radius: 6px; 
      margin-bottom: 4px; 
      background: #f8fafc;
      cursor: pointer;
      transition: background 0.2s;
    }
    .user-item:hover { background: #e2e8f0; }
    .user-status { 
      width: 8px; 
      height: 8px; 
      border-radius: 50%; 
    }
    .user-status.online { background: #10b981; }
    .you-badge { 
      font-size: 12px; 
      color: #6b7280; 
      margin-left: auto;
    }
    #onlineCount {
      font-size: 14px;
      color: #6b7280;
      margin: 10px 0;
      text-align: center;
    }
  `;
  document.head.appendChild(style);
})();
=======
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
>>>>>>> 65a3c9efa3e752f835231d667373d22f778cce6d
