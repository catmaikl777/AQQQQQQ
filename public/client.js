(() => {
  // DOM элементы
  const messagesEl = document.getElementById("messages");
  const messageForm = document.getElementById("messageForm");
  const messageInput = document.getElementById("messageInput");
  const nameInput = document.getElementById("nameInput");
  const setNameBtn = document.getElementById("setName");
  const userListEl = document.getElementById("userList");
  const sidebar = document.getElementById("sidebar");
  const sidebarToggle = document.getElementById("sidebarToggle");
  const closeSidebar = document.getElementById("closeSidebar");
  const overlay = document.getElementById("overlay");
  const onlineCount = document.getElementById("onlineCount");
  const fileInput = document.getElementById("fileInput");
  const fileUploadBtn = document.getElementById("fileUploadBtn");
  const startCallBtn = document.getElementById("startCall");
  const endCallBtn = document.getElementById("endCall");
  const videoCallContainer = document.getElementById("videoCallContainer");
  const localVideo = document.getElementById("localVideo");
  const toggleVideoBtn = document.getElementById("toggleVideo");
  const toggleAudioBtn = document.getElementById("toggleAudio");
  const closeCallBtn = document.getElementById("closeCall");
  const incomingCallModal = document.getElementById("incomingCallModal");
  const callerNameEl = document.getElementById("callerName");
  const acceptCallBtn = document.getElementById("acceptCall");
  const rejectCallBtn = document.getElementById("rejectCall");
  const initialNameInput = document.getElementById("initialNameInput");
  const confirmNameBtn = document.getElementById("confirmName");
  const nameModal = document.getElementById("nameModal");
  const callStatusEl = document.getElementById("callStatus");
  const participantsCountEl = document.getElementById("participantsCount");
  const joinCallBtn = document.getElementById("joinCall");

  // Глобальные переменные
  let myId = null;
  let mySessionId = null;
  let ws = null;
  const users = new Map();
  let historyLoaded = false;
  let isConnected = false;
  let activeCalls = [];
  let activeCallsModal = null;

  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  const reconnectDelay = 3000;

  // WebRTC переменные
  let localStream = null;
  let peerConnections = new Map();
  let currentRoomId = null;
  let isInCall = false;
  let incomingCall = null;
  let isCallInitiator = false;
  let participantsCount = 1;
  let roomUsers = new Map();

  // WebRTC конфигурация (улучшенная)
  const rtcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:turn.bistri.com:80",
        username: "homeo",
        credential: "homeo",
      },
    ],
    iceCandidatePoolSize: 10,
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  };

  // Инициализация приложения
  function init() {
    setupEventListeners();
    initializeEmojiPanel();
    checkUserName();
    connectWebSocket();
  }

  function checkUserName() {
    const savedName = localStorage.getItem("chatUserName");
    if (savedName) {
      hideNameModal();
    } else {
      showNameModal();
    }
  }

  function showNameModal() {
    nameModal.classList.remove("hidden");
    initialNameInput.focus();
  }

  function hideNameModal() {
    nameModal.classList.add("hidden");
  }

  // Настройка обработчиков событий
  function setupEventListeners() {
    // Модальное окно имени
    confirmNameBtn.addEventListener("click", handleInitialName);
    initialNameInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") handleInitialName();
    });

    // Сайдбар
    sidebarToggle.addEventListener("click", toggleSidebar);
    closeSidebar.addEventListener("click", toggleSidebar);
    overlay.addEventListener("click", toggleSidebar);

    // Форма сообщения
    messageForm.addEventListener("submit", handleMessageSubmit);
    messageInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleMessageSubmit(e);
      }
    });

    if (joinCallBtn) {
      joinCallBtn.addEventListener("click", showActiveCallsModal);
    }

    // Установка имени
    setNameBtn.addEventListener("click", handleNameChange);
    nameInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") handleNameChange();
    });

    // Загрузка файлов
    fileUploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", handleFileUpload);

    // Звонки
    startCallBtn.addEventListener("click", startGroupCall);
    endCallBtn.addEventListener("click", endCall);
    closeCallBtn.addEventListener("click", endCall);
    toggleVideoBtn.addEventListener("click", toggleVideo);
    toggleAudioBtn.addEventListener("click", toggleAudio);

    // Входящие звонки
    acceptCallBtn.addEventListener("click", acceptCall);
    rejectCallBtn.addEventListener("click", rejectCall);

    // Адаптивность
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", setVH);

    // Уведомления
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  function initializeEmojiPanel() {
    const emojiPanel = document.querySelector(".emoji-panel");
    if (!emojiPanel) return;

    const emojis = [
      "😀",
      "😂",
      "😍",
      "🤔",
      "👏",
      "🎉",
      "❤️",
      "🔥",
      "👍",
      "👎",
      "😎",
      "🤯",
    ];

    emojiPanel.innerHTML = "";
    emojis.forEach((emoji) => {
      const button = document.createElement("button");
      button.textContent = emoji;
      button.type = "button";
      button.addEventListener("click", () => {
        sendMessage({ type: "reaction", emoji });
      });
      emojiPanel.appendChild(button);
    });
  }

  function setVH() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty("--vh", `${vh}px`);
  }

  function handleResize() {
    if (window.innerWidth > 768) {
      sidebar.classList.remove("active");
      overlay.classList.remove("active");
    }
    setVH();
  }

  function toggleSidebar() {
    if (window.innerWidth <= 768) {
      sidebar.classList.toggle("active");
      overlay.classList.toggle("active");
    }
  }

  function handleVisibilityChange() {
    if (document.hidden && incomingCall) {
      showBrowserNotification(
        "Входящий звонок",
        `${incomingCall.fromUserName} звонит вам`
      );
    }
  }

  function updateVideoGridLayout() {
    const videoGrid = document.querySelector(".video-grid");
    if (!videoGrid) return;

    const videoContainers = videoGrid.querySelectorAll(".video-container");
    const containerCount = videoContainers.length;

    // Удаляем все классы компоновки
    videoGrid.className = "video-grid";
    videoContainers.forEach((container) => {
      container.className = "video-container";
    });

    // Динамически настраиваем сетку в зависимости от количества участников
    if (containerCount <= 2) {
      videoGrid.style.gridTemplateColumns = "1fr 1fr";
    } else if (containerCount <= 4) {
      videoGrid.style.gridTemplateColumns = "1fr 1fr";
      videoGrid.style.gridTemplateRows = "1fr 1fr";
    } else {
      videoGrid.style.gridTemplateColumns =
        "repeat(auto-fit, minmax(300px, 1fr))";
    }

    console.log(`🎬 Video grid updated: ${containerCount} participants`);
  }

  // WebSocket соединение
  function connectWebSocket() {
    const wsUrl = "https://aqqqqqq-1.onrender.com";

    try {
      ws = new WebSocket(wsUrl);
      setupWebSocketHandlers();
    } catch (error) {
      console.error("Error creating WebSocket:", error);
      handleConnectionError();
    }
  }

  function setupWebSocketHandlers() {
    ws.onopen = () => {
      console.log("✅ Connected to server");
      isConnected = true;
      reconnectAttempts = 0;
      showSystemMessage("✅ Подключено к серверу");
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      showSystemMessage("❌ Ошибка соединения с сервером");
    };

    // В функции setupWebSocketHandlers() добавьте:
    ws.onclose = (event) => {
      console.log("❌ Disconnected from server:", event.code, event.reason);
      isConnected = false;

      // ИСПРАВЛЕНИЕ: Не пытаемся переподключаться при закрытии дублирующей сессии
      if (
        event.code === 4000 &&
        event.reason === "Duplicate session closed by new connection"
      ) {
        console.log(
          "🔄 Duplicate session closed normally, no reconnection needed"
        );
        showSystemMessage(
          "🔄 Сессия закрыта (вы подключены с другого устройства/вкладки)"
        );
        return;
      }

      if (event.code !== 1000 && event.code !== 4000) {
        handleReconnection();
      }
    };
  }

  function handleReconnection() {
    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      const delay = reconnectDelay * reconnectAttempts;

      showSystemMessage(
        `🔄 Переподключение через ${
          delay / 1000
        }сек... (${reconnectAttempts}/${maxReconnectAttempts})`
      );

      setTimeout(() => {
        if (!isConnected) {
          connectWebSocket();
        }
      }, delay);
    } else {
      showSystemMessage(
        "❌ Не удалось подключиться к серверу. Обновите страницу."
      );
    }
  }

  function handleConnectionError() {
    showSystemMessage("❌ Ошибка подключения к серверу");
  }

  // Обработка сообщений WebSocket
  function handleWebSocketMessage(message) {
    console.log("📨 Received message:", message.type, message);

    switch (message.type) {
      case "init":
        handleInitMessage(message);
        break;
      case "history":
        handleHistoryMessage(message);
        break;
      case "message":
        showMessage(message);
        break;
      case "system":
        showSystemMessage(message.text);
        break;
      case "action":
        showActionMessage(message);
        break;
      case "reaction":
        showReactionMessage(message);
        break;
      case "file":
        showFileMessage(message);
        break;
      case "users":
        updateUsersList(message.users);
        break;
      case "name_updated":
        handleNameUpdated(message);
        break;
      case "private":
        handlePrivateMessage(message);
        break;
      case "private_sent":
        showSystemMessage("✅ Личное сообщение отправлено");
        break;

      // WebRTC сообщения - ИСПРАВЛЕННЫЕ
      case "call_invite":
        handleCallInvite(message);
        break;
      case "call_started":
        handleCallStarted(message);
        break;
      case "room_created":
        handleRoomCreated(message);
        break;
      case "room_users":
        handleRoomUsers(message);
        break;
      case "user_joined":
        handleUserJoined(message);
        break;
      case "user_left":
        handleUserLeft(message);
        break;
      case "webrtc_offer":
        handleWebRTCOffer(message);
        break;
      case "webrtc_answer":
        handleWebRTCAnswer(message);
        break;
      case "webrtc_ice_candidate":
        handleICECandidate(message);
        break;
      case "call_rejected":
        handleCallRejected(message);
        break;
      case "call_ended":
        handleCallEnded(message);
        break;
      case "group_call_started":
        handleGroupCallStarted(message);
        break;
      case "group_call_ended":
        handleGroupCallEnded(message);
        break;
      case "active_calls":
        handleActiveCalls(message);
        break;

      default:
        console.log("❌ Unknown message type:", message);
    }
  }

  function handleInitMessage(message) {
    myId = message.id;
    mySessionId = message.sessionId;

    const savedName = localStorage.getItem("chatUserName");
    if (savedName && nameInput) {
      nameInput.value = savedName;
      sendMessage({ type: "setName", name: savedName });
    } else if (message.name) {
      localStorage.setItem("chatUserName", message.name);
      if (nameInput) nameInput.value = message.name;
    }

    hideNameModal();
  }

  function handleHistoryMessage(message) {
    if (!historyLoaded && message.history) {
      message.history.forEach((msg) => {
        switch (msg.type) {
          case "message":
            showMessage(msg, true);
            break;
          case "system":
            showSystemMessage(msg.content, true);
            break;
          case "action":
            showActionMessage(msg, true);
            break;
          case "file":
            showFileMessage(msg, true);
            break;
        }
      });
      historyLoaded = true;
    }
  }

  // Отправка сообщений
  function sendMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error("Error sending message:", error);
        showSystemMessage("❌ Ошибка отправки сообщения");
      }
    } else {
      showSystemMessage("❌ Нет подключения к серверу");
    }
  }

  function handleInitialName() {
    const name = initialNameInput.value.trim();
    if (name) {
      localStorage.setItem("chatUserName", name);
      hideNameModal();
      if (isConnected && myId) {
        // Ждем инициализации перед отправкой имени
        setTimeout(() => {
          sendMessage({ type: "setName", name });
        }, 1000);
      }
    }
  }

  function handleMessageSubmit(e) {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (text && isConnected) {
      sendMessage({ type: "message", text });
      messageInput.value = "";
      messageInput.focus();
    }
  }

  function handleNameChange() {
    const name = nameInput.value.trim();
    if (name && isConnected) {
      sendMessage({ type: "setName", name });
    }
  }

  function handleNameUpdated(message) {
    if (message.userId === myId) {
      localStorage.setItem("chatUserName", message.newName);
      showSystemMessage(`✅ Теперь вас зовут ${message.newName}`);
    } else {
      // Если это не наш ID, но мы получили сообщение - возможно, имя не изменилось
      console.log("Name update message for other user:", message);
    }
  }

  // Отображение сообщений
  function showMessage(data, isHistory = false) {
    const el = document.createElement("div");
    el.className = `message ${data.id === myId ? "me" : ""}`;

    const time = data.ts
      ? new Date(data.ts).toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : new Date().toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        });

    el.innerHTML = `
      <div class="message-header">
        <strong>${escapeHtml(data.name)}</strong>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-text">${escapeHtml(data.text)}</div>
    `;

    addMessage(el, isHistory);
  }

  function showSystemMessage(text, isHistory = false) {
    const el = document.createElement("div");
    el.className = "system";
    el.textContent = text;
    addMessage(el, isHistory);
  }

  function showActionMessage(data, isHistory = false) {
    const el = document.createElement("div");
    el.className = "action";
    el.textContent = `${data.name} ${data.text}`;
    addMessage(el, isHistory);
  }

  function showReactionMessage(data) {
    const el = document.createElement("div");
    el.className = "reaction";
    el.textContent = `${data.name} отправил реакцию ${data.emoji}`;
    addMessage(el);
  }

  function showFileMessage(data, isHistory = false) {
    const el = document.createElement("div");
    el.className = `message file-message ${data.id === myId ? "me" : ""}`;

    let previewHtml = "";
    if (data.filetype && data.filetype.startsWith("image/")) {
      previewHtml = `<img src="data:${data.filetype};base64,${data.data}" alt="${data.filename}" loading="lazy">`;
    } else if (data.filetype && data.filetype.startsWith("video/")) {
      previewHtml = `<video controls><source src="data:${data.filetype};base64,${data.data}" type="${data.filetype}"></video>`;
    } else if (data.filetype && data.filetype.startsWith("audio/")) {
      previewHtml = `<audio controls><source src="data:${data.filetype};base64,${data.data}" type="${data.filetype}"></audio>`;
    } else {
      previewHtml = `<div class="file-icon">📄 ${data.filename}</div>`;
    }

    const time = data.ts
      ? new Date(data.ts).toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : new Date().toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        });

    el.innerHTML = `
      <div class="message-header">
        <strong>${escapeHtml(data.name)}</strong>
        <span class="message-time">${time}</span>
      </div>
      <div class="file-preview">
        ${previewHtml}
        <div class="file-info">
          <div class="file-name">${escapeHtml(data.filename)}</div>
          <div class="file-size">${formatFileSize(data.size)}</div>
          <button class="download-btn" onclick="downloadFile('${
            data.filename
          }', '${data.filetype}', '${data.data}')">
            Скачать
          </button>
        </div>
      </div>
    `;

    addMessage(el, isHistory);
  }

  function addMessage(element, isHistory = false) {
    if (!messagesEl) return;

    if (isHistory) {
      messagesEl.insertBefore(element, messagesEl.firstChild);
    } else {
      messagesEl.appendChild(element);
      scrollToBottom();
    }
  }

  function scrollToBottom() {
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function formatFileSize(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  // Работа с пользователями
  function updateUsersList(usersList) {
    if (!userListEl) return;

    userListEl.innerHTML = "";
    if (onlineCount) {
      onlineCount.textContent = `Онлайн: ${usersList.length}`;
    }

    users.clear();
    usersList.forEach((user) => {
      users.set(user.id, user);

      const userEl = document.createElement("li");
      userEl.className = `user-item ${user.id === myId ? "me" : ""}`;

      let userHtml = `
        <span class="user-status online"></span>
        <span class="user-name">${escapeHtml(user.name)}</span>
        ${user.id === myId ? '<span class="you-badge">(Вы)</span>' : ""}
      `;

      if (user.id !== myId) {
        userHtml += `<button class="call-user-btn" title="Позвонить">📞</button>`;
      }

      userEl.innerHTML = userHtml;

      if (user.id !== myId) {
        const callBtn = userEl.querySelector(".call-user-btn");
        if (callBtn) {
          callBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            startIndividualCall(user.id);
          });
        }

        userEl.addEventListener("click", () => {
          const text = prompt(`Приватное сообщение для ${user.name}:`);
          if (text && text.trim()) {
            sendMessage({ type: "private", to: user.id, text: text.trim() });
          }
        });
      }

      userListEl.appendChild(userEl);
    });

    if (!isInCall) {
      const joinCallItem = document.createElement("li");
      joinCallItem.className = "user-item join-call-item";
      joinCallItem.innerHTML = `
      <span class="user-status" style="background: #f59e0b"></span>
      <span class="user-name">Присоединиться к групповому звонку</span>
      <button class="call-user-btn" style="background: #f59e0b">👥</button>
    `;

      const joinBtn = joinCallItem.querySelector(".call-user-btn");
      joinBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        showActiveCallsModal();
      });

      joinCallItem.addEventListener("click", () => {
        showActiveCallsModal();
      });

      userListEl.appendChild(joinCallItem);
    }
  }

  function showActiveCallsModal() {
    // Создаем модальное окно, если его нет
    if (!activeCallsModal) {
      activeCallsModal = document.createElement("div");
      activeCallsModal.className = "modal";
      activeCallsModal.innerHTML = `
      <div class="modal-content">
        <h3>Активные групповые звонки</h3>
        <div id="activeCallsList" style="max-height: 300px; overflow-y: auto; margin: 16px 0;">
          <div class="system">Загрузка...</div>
        </div>
        <div class="modal-buttons">
          <button id="refreshCalls" class="accept-btn">🔄 Обновить</button>
          <button id="closeCallsModal" class="reject-btn">✕ Закрыть</button>
        </div>
      </div>
    `;
      document.body.appendChild(activeCallsModal);

      // Обработчики событий для модального окна
      document
        .getElementById("refreshCalls")
        .addEventListener("click", refreshActiveCalls);
      document
        .getElementById("closeCallsModal")
        .addEventListener("click", hideActiveCallsModal);
    }

    activeCallsModal.classList.remove("hidden");
    refreshActiveCalls();
  }

  function hideActiveCallsModal() {
    if (activeCallsModal) {
      activeCallsModal.classList.add("hidden");
    }
  }

  function refreshActiveCalls() {
    sendMessage({ type: "get_active_calls" });
  }

  async function processPendingIceCandidates(pc, sessionId) {
    if (!pc.pendingIceCandidates || pc.pendingIceCandidates.length === 0) {
      return;
    }

    console.log(
      `🔄 Processing ${pc.pendingIceCandidates.length} pending ICE candidates for ${sessionId}`
    );

    // Обрабатываем все отложенные кандидаты
    while (pc.pendingIceCandidates.length > 0) {
      const candidate = pc.pendingIceCandidates.shift();
      try {
        await pc.addIceCandidate(candidate);
        console.log(`🧊 Added pending ICE candidate from ${sessionId}`);
      } catch (error) {
        console.warn("⚠️ Error adding pending ICE candidate:", error);
      }
    }
  }

  async function joinGroupCall(roomId) {
    if (isInCall) {
      showSystemMessage("❌ Вы уже в звонке");
      return;
    }

    hideActiveCallsModal();
    showSystemMessage("🎥 Запрашиваем доступ к камере и микрофону...");

    try {
      // ИСПРАВЛЕНИЕ: Инициализируем медиапоток перед присоединением
      await initializeLocalStream();

      currentRoomId = roomId;
      isInCall = true;
      isCallInitiator = false;

      sendMessage({ type: "join_group_call", roomId: roomId });
      showVideoCallUI();
      showSystemMessage("✅ Вы присоединились к групповому звонку");
    } catch (error) {
      console.error("Error joining group call:", error);
      showSystemMessage("❌ Ошибка присоединения к звонку");
    }
  }

  // ДОБАВИТЬ: Обработчик активных звонков
  function handleActiveCalls(message) {
    activeCalls = message.calls;

    const callsList = document.getElementById("activeCallsList");
    if (!callsList) return;

    if (activeCalls.length === 0) {
      callsList.innerHTML =
        '<div class="system">Нет активных групповых звонков</div>';
      return;
    }

    callsList.innerHTML = "";
    activeCalls.forEach((call) => {
      const callEl = document.createElement("div");
      callEl.className = "user-item";
      callEl.style.marginBottom = "8px";
      callEl.style.cursor = "pointer";
      callEl.style.padding = "12px";
      callEl.style.borderRadius = "8px";
      callEl.style.border = "1px solid var(--border-color)";

      callEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div>
          <div style="font-weight: 500;">Звонок от ${escapeHtml(
            call.creatorName
          )}</div>
          <div style="font-size: 12px; color: var(--text-muted);">
            Участников: ${call.participantsCount} • 
            ${new Date(call.createdAt).toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
        <button class="call-user-btn" style="background: #10b981;">➕</button>
      </div>
    `;

      const joinBtn = callEl.querySelector(".call-user-btn");
      joinBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        joinGroupCall(call.roomId);
      });

      callEl.addEventListener("click", () => {
        joinGroupCall(call.roomId);
      });

      callsList.appendChild(callEl);
    });
  }

  // ДОБАВИТЬ: Обработчик уведомления о начале группового звонка
  function handleGroupCallStarted(message) {
    if (isInCall) return; // Не показываем уведомления если уже в звонке

    showSystemMessage(`👥 ${message.fromUserName} начал групповой звонок`);

    // Показываем кнопку для быстрого присоединения
    if (!document.querySelector(".quick-join-call")) {
      const quickJoin = document.createElement("div");
      quickJoin.className = "system quick-join-call";
      quickJoin.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
        ${message.fromUserName} начал групповой звонок
        <button style="background: var(--primary-blue); color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">
          Присоединиться
        </button>
      </div>
    `;

      const joinBtn = quickJoin.querySelector("button");
      joinBtn.addEventListener("click", () => {
        joinGroupCall(message.roomId);
        quickJoin.remove();
      });

      addMessage(quickJoin);
    }
  }

  // ДОБАВИТЬ: Обработчик завершения группового звонка
  function handleGroupCallEnded(message) {
    showSystemMessage(
      `📞 Групповой звонок завершен ${
        message.endedBy ? `пользователем ${message.endedBy}` : ""
      }`
    );

    // Удаляем кнопки быстрого присоединения
    document.querySelectorAll(".quick-join-call").forEach((el) => el.remove());
  }

  function handlePrivateMessage(data) {
    const el = document.createElement("div");
    el.className = "private";

    el.innerHTML = `
      <div class="message-header">
        <strong>🔒 ЛС от ${escapeHtml(data.name)}</strong>
        <span class="message-time">${new Date().toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        })}</span>
      </div>
      <div class="message-text">${escapeHtml(data.text)}</div>
    `;

    addMessage(el);

    // Уведомление
    if (
      document.hidden &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      new Notification(`Личное сообщение от ${data.name}`, {
        body: data.text,
        icon: "/favicon.ico",
      });
    }
  }

  // Загрузка файлов
  function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      showSystemMessage("❌ Файл слишком большой (максимум 10MB)");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result.split(",")[1];
      sendMessage({
        type: "file",
        filename: file.name,
        filetype: file.type,
        size: file.size,
        data: base64,
      });
    };
    reader.onerror = () => {
      showSystemMessage("❌ Ошибка чтения файла");
    };
    reader.readAsDataURL(file);
    fileInput.value = "";
  }

  // WebRTC функции - ИСПРАВЛЕННЫЕ
  async function startGroupCall() {
    if (isInCall) {
      showSystemMessage("❌ Вы уже в звонке");
      return;
    }

    try {
      showSystemMessage("🎥 Запрашиваем доступ к камере и микрофону...");
      await initializeLocalStream();
      isCallInitiator = true;
      sendMessage({ type: "create_room" });
      showSystemMessage("👥 Создаем групповой звонок...");
    } catch (error) {
      console.error("Error starting group call:", error);
      showSystemMessage(
        "❌ Не удалось начать звонок. Проверьте разрешения для камеры/микрофона."
      );
    }
  }

  function startIndividualCall(targetUserId) {
    if (isInCall) {
      showSystemMessage("❌ Вы уже в звонке");
      return;
    }

    isCallInitiator = true;
    sendMessage({ type: "start_individual_call", targetUserId });
    showSystemMessage("📞 Вызываем пользователя...");
  }

  async function initializeLocalStream() {
    try {
      // Останавливаем существующий поток если есть
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }

      localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (localVideo) {
        localVideo.srcObject = localStream;
        console.log("✅ Local video stream initialized");
      }

      return localStream;
    } catch (error) {
      console.error("❌ Error accessing media devices:", error);

      // Пробуем получить только аудио если видео недоступно
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });

        if (localVideo) {
          localVideo.srcObject = null;
        }

        console.log("✅ Audio-only stream initialized");
        return localStream;
      } catch (audioError) {
        console.error("❌ Error accessing audio devices:", audioError);
        showSystemMessage("❌ Не удалось получить доступ к камере/микрофону");
        throw error;
      }
    }
  }

  function handleCallInvite(message) {
    if (isInCall) {
      // Если уже в звонке, отклоняем входящий
      sendMessage({ type: "call_rejected", roomId: message.roomId });
      return;
    }

    incomingCall = message;
    callerNameEl.textContent = `${message.fromUserName} (${
      message.isGroupCall ? "Групповой звонок" : "Индивидуальный звонок"
    })`;
    incomingCallModal.classList.remove("hidden");

    // Автоматическое отклонение через 30 секунд
    setTimeout(() => {
      if (
        incomingCallModal &&
        !incomingCallModal.classList.contains("hidden")
      ) {
        rejectCall();
      }
    }, 30000);
  }

  function handleCallStarted(message) {
    currentRoomId = message.roomId;
    isInCall = true;
    showSystemMessage(`📞 Звонок начат с ${message.targetUserName}`);
  }

  function handleRoomCreated(message) {
    currentRoomId = message.roomId;
    isInCall = true;
    showVideoCallUI();
    showSystemMessage(message.message || "✅ Комната создана");

    // Запрашиваем список пользователей в комнате
    setTimeout(() => {
      updateRoomUsers();
    }, 1000);
  }

  async function acceptCall() {
    if (!incomingCall) return;

    try {
      showSystemMessage("🎥 Запрашиваем доступ к камере и микрофону...");
      await initializeLocalStream();
      currentRoomId = incomingCall.roomId;
      isInCall = true;
      isCallInitiator = false;

      sendMessage({ type: "join_room", roomId: incomingCall.roomId });
      hideIncomingCallModal();
      showVideoCallUI();
      showSystemMessage("✅ Вы присоединились к звонку");

      // Запрашиваем список пользователей в комнате
      setTimeout(() => {
        updateRoomUsers();
      }, 1000);
    } catch (error) {
      console.error("Error accepting call:", error);
      showSystemMessage("❌ Ошибка присоединения к звонку");
      hideIncomingCallModal();
    }
  }

  function rejectCall() {
    if (incomingCall) {
      sendMessage({ type: "call_rejected", roomId: incomingCall.roomId });
      hideIncomingCallModal();
      showSystemMessage("❌ Вы отклонили звонок");
    }
  }

  function hideIncomingCallModal() {
    incomingCallModal.classList.add("hidden");
    incomingCall = null;
  }

  function handleCallRejected(message) {
    showSystemMessage(
      `❌ ${message.userName || "Пользователь"} отклонил ваш звонок`
    );
    endCall();
  }

  function handleCallEnded(message) {
    showSystemMessage(
      `📞 ${
        message.endedBy
          ? `Звонок завершен пользователем ${message.endedBy}`
          : "Звонок завершен"
      }`
    );
    endCall();
  }

  // WebRTC соединения - ИСПРАВЛЕННЫЕ
  async function createPeerConnection(targetSessionId) {
    console.log(`🔗 Creating peer connection for: ${targetSessionId}`);

    try {
      const pc = new RTCPeerConnection(rtcConfig);

      // Инициализируем массив для отложенных ICE кандидатов
      pc.pendingCandidates = [];

      // Обработчик получения удаленных потоков
      pc.ontrack = (event) => {
        console.log(
          "📹 Received remote track from:",
          targetSessionId,
          event.streams
        );
        if (event.streams && event.streams[0]) {
          showRemoteVideo(targetSessionId, event.streams[0]);
        }
      };

      // Обработчик ICE кандидатов
      pc.onicecandidate = (event) => {
        if (event.candidate && currentRoomId) {
          console.log(`🧊 Sending ICE candidate to ${targetSessionId}`);
          sendMessage({
            type: "webrtc_ice_candidate",
            roomId: currentRoomId,
            targetSessionId: targetSessionId,
            candidate: event.candidate,
          });
        }
      };

      // Обработчики состояния соединения
      pc.onconnectionstatechange = () => {
        console.log(
          `🔗 Connection state for ${targetSessionId}: ${pc.connectionState}`
        );

        if (pc.connectionState === "connected") {
          console.log(`✅ Successfully connected to ${targetSessionId}`);
          updateCallStatus("connected");
        } else if (pc.connectionState === "failed") {
          console.warn(`❌ Connection failed with ${targetSessionId}`);
          // Не переподключаемся автоматически - это вызывает цикл
        } else if (pc.connectionState === "closed") {
          console.log(`🔒 Connection closed with ${targetSessionId}`);
        }
      };

      // Добавляем локальные треки
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          try {
            pc.addTrack(track, localStream);
            console.log(
              `✅ Added local track to connection with ${targetSessionId}`
            );
          } catch (error) {
            console.error("Error adding track:", error);
          }
        });
      }

      peerConnections.set(targetSessionId, pc);
      return pc;
    } catch (error) {
      console.error(
        `❌ Error creating peer connection for ${targetSessionId}:`,
        error
      );
      throw error;
    }
  }

  function showRemoteVideo(sessionId, remoteStream) {
    const remoteVideoId = `remoteVideo_${sessionId}`;
    let remoteVideo = document.getElementById(remoteVideoId);
    let videoContainer = document.getElementById(`videoContainer_${sessionId}`);

    if (!videoContainer) {
      videoContainer = document.createElement("div");
      videoContainer.className = "video-container";
      videoContainer.id = `videoContainer_${sessionId}`;

      remoteVideo = document.createElement("video");
      remoteVideo.id = remoteVideoId;
      remoteVideo.autoplay = true;
      remoteVideo.playsInline = true;
      remoteVideo.className = "remote-video";

      // ИСПРАВЛЕНИЕ: Добавляем обработчики ошибок для видео
      remoteVideo.onerror = (e) => {
        console.error(`❌ Video error for ${sessionId}:`, e);
      };

      remoteVideo.onloadedmetadata = () => {
        console.log(`✅ Video loaded for ${sessionId}`);
      };

      const videoLabel = document.createElement("div");
      videoLabel.className = "video-label";

      const userName = roomUsers.get(sessionId)?.userName || "Участник";
      videoLabel.textContent = userName;

      videoContainer.appendChild(remoteVideo);
      videoContainer.appendChild(videoLabel);

      const videoGrid = document.querySelector(".video-grid");
      if (videoGrid) {
        videoGrid.appendChild(videoContainer);
      }
    }

    if (remoteVideo) {
      try {
        remoteVideo.srcObject = remoteStream;
        console.log(`✅ Remote video set for ${sessionId}`);
      } catch (error) {
        console.error(`❌ Error setting remote video for ${sessionId}:`, error);
      }
    }

    // Обновляем компоновку сетки
    setTimeout(updateVideoGridLayout, 100);
  }

  async function handleRoomUsers(message) {
    console.log("👥 Room users received:", message.users);

    roomUsers.clear();
    message.users.forEach((user) => {
      roomUsers.set(user.sessionId, user);
    });

    updateParticipantsCount(message.users.length);

    // Обновляем компоновку сетки
    setTimeout(updateVideoGridLayout, 100);

    const otherUsers = message.users.filter(
      (user) => user.sessionId !== mySessionId
    );

    console.log(`🔗 Need to connect to ${otherUsers.length} other users`);

    // Создаем соединения последовательно с задержкой
    for (let i = 0; i < otherUsers.length; i++) {
      const user = otherUsers[i];

      // Проверяем, нет ли уже активного соединения
      if (peerConnections.has(user.sessionId)) {
        const existingPc = peerConnections.get(user.sessionId);
        if (
          existingPc.connectionState === "connected" ||
          existingPc.connectionState === "connecting"
        ) {
          console.log(
            `✅ Already connected/connecting to ${user.userName}, skipping`
          );
          continue;
        }
      }

      console.log(
        `🔗 Setting up connection with: ${user.userName} (${user.sessionId})`
      );

      // Добавляем задержку между созданием соединений
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        await createOffer(user.sessionId);
        console.log(`✅ Connection setup initiated for ${user.userName}`);
      } catch (error) {
        console.error(
          `❌ Failed to setup connection with ${user.userName}:`,
          error
        );
      }
    }
  }

  async function createPeerConnection(targetSessionId) {
    console.log(`🔗 Creating peer connection for: ${targetSessionId}`);

    try {
      const pc = new RTCPeerConnection(rtcConfig);

      // Инициализируем массив для отложенных ICE кандидатов
      pc.pendingIceCandidates = [];

      // Обработчик получения удаленных потоков
      pc.ontrack = (event) => {
        console.log(
          "📹 Received remote track from:",
          targetSessionId,
          event.streams
        );
        if (event.streams && event.streams[0]) {
          showRemoteVideo(targetSessionId, event.streams[0]);
        }
      };

      // Обработчик ICE кандидатов
      pc.onicecandidate = (event) => {
        if (event.candidate && currentRoomId) {
          console.log(`🧊 Sending ICE candidate to ${targetSessionId}`);
          sendMessage({
            type: "webrtc_ice_candidate",
            roomId: currentRoomId,
            targetSessionId: targetSessionId,
            candidate: event.candidate,
          });
        } else if (!event.candidate) {
          console.log(`✅ All ICE candidates gathered for ${targetSessionId}`);
        }
      };

      // Обработчики состояния соединения
      pc.onconnectionstatechange = () => {
        console.log(
          `🔗 Connection state for ${targetSessionId}: ${pc.connectionState}`
        );

        if (pc.connectionState === "connected") {
          console.log(`✅ Successfully connected to ${targetSessionId}`);
          updateCallStatus("connected");

          // Очищаем отложенные кандидаты при успешном соединении
          if (pc.pendingIceCandidates) {
            pc.pendingIceCandidates = [];
          }
        } else if (pc.connectionState === "failed") {
          console.warn(`❌ Connection failed with ${targetSessionId}`);
        } else if (pc.connectionState === "closed") {
          console.log(`🔒 Connection closed with ${targetSessionId}`);
        }
      };

      // Обработчик ICE соединения
      pc.oniceconnectionstatechange = () => {
        console.log(
          `🧊 ICE connection state for ${targetSessionId}: ${pc.iceConnectionState}`
        );

        if (pc.iceConnectionState === "connected") {
          console.log(`✅ ICE connected to ${targetSessionId}`);
        } else if (pc.iceConnectionState === "failed") {
          console.warn(`❌ ICE failed with ${targetSessionId}`);
        }
      };

      // Обработчик состояния сигналинга
      pc.onsignalingstatechange = () => {
        console.log(
          `📡 Signaling state for ${targetSessionId}: ${pc.signalingState}`
        );

        // Когда signaling state становится stable, обрабатываем отложенные кандидаты
        if (pc.signalingState === "stable" && pc.remoteDescription) {
          processPendingIceCandidates(pc, targetSessionId);
        }
      };

      // Добавляем локальные треки
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          try {
            pc.addTrack(track, localStream);
            console.log(
              `✅ Added local track to connection with ${targetSessionId}`
            );
          } catch (error) {
            console.error("Error adding track:", error);
          }
        });
      }

      peerConnections.set(targetSessionId, pc);
      return pc;
    } catch (error) {
      console.error(
        `❌ Error creating peer connection for ${targetSessionId}:`,
        error
      );
      throw error;
    }
  }

  function cleanupPendingCandidates(sessionId) {
    const pc = peerConnections.get(sessionId);
    if (pc && pc.pendingIceCandidates) {
      console.log(
        `🧹 Cleaning up ${pc.pendingIceCandidates.length} pending ICE candidates for ${sessionId}`
      );
      pc.pendingIceCandidates = [];
    }
  }

  function debugConnections() {
    console.log("🔍 DEBUG CONNECTIONS:");
    console.log(`Room Users: ${roomUsers.size}`);
    roomUsers.forEach((user, sessionId) => {
      console.log(
        `- ${user.userName} (${sessionId}) ${
          sessionId === mySessionId ? "(You)" : ""
        }`
      );
    });

    console.log(`Peer Connections: ${peerConnections.size}`);
    peerConnections.forEach((pc, sessionId) => {
      console.log(
        `- ${sessionId}: ${pc.connectionState} (ICE: ${pc.iceConnectionState})`
      );
    });

    console.log(
      `Video Elements: ${document.querySelectorAll(".video-container").length}`
    );
  }

  // Вызывайте эту функцию для отладки при необходимости

  function refreshAllConnections() {
    console.log("🔄 Refreshing all peer connections...");

    const disconnectedConnections = Array.from(
      peerConnections.entries()
    ).filter(
      ([sessionId, pc]) =>
        pc.connectionState !== "connected" &&
        pc.connectionState !== "connecting"
    );

    console.log(
      `🔄 Found ${disconnectedConnections.length} disconnected connections`
    );

    // Обновляем только отключенные соединения с задержкой
    disconnectedConnections.forEach(async ([sessionId], index) => {
      await new Promise((resolve) => setTimeout(resolve, index * 2000)); // 2 секунды между каждым
      if (currentRoomId && peerConnections.has(sessionId)) {
        createOffer(sessionId);
      }
    });
  }

  // Увеличьте интервал проверки соединений
  // setInterval(() => {
  //   if (isInCall && peerConnections.size > 0) {
  //     let disconnectedCount = 0;
  //     peerConnections.forEach((pc, sessionId) => {
  //       if (
  //         pc.connectionState !== "connected" &&
  //         pc.connectionState !== "connecting"
  //       ) {
  //         disconnectedCount++;
  //         console.log(
  //           `⚠️ Connection with ${sessionId} is ${pc.connectionState}`
  //         );
  //       }
  //     });

  //     if (disconnectedCount > 0 && disconnectedCount <= 4) {
  //       // Ограничиваем количество одновременных переподключений
  //       console.log(`🔄 ${disconnectedCount} connections need refresh`);
  //       refreshAllConnections();
  //     }
  //   }
  // }, 30000); // Увеличиваем до 30 секунд

  async function handleRoomUsers(message) {
    console.log("👥 Room users received:", message.users);

    roomUsers.clear();
    message.users.forEach((user) => {
      roomUsers.set(user.sessionId, user);
    });

    updateParticipantsCount(message.users.length);

    // Обновляем компоновку сетки
    setTimeout(updateVideoGridLayout, 100);

    // Создаем соединения с другими пользователями с задержкой
    const otherUsers = message.users.filter(
      (user) => user.sessionId !== mySessionId
    );

    console.log(`🔗 Need to connect to ${otherUsers.length} other users`);

    // Создаем соединения последовательно с задержкой
    for (let i = 0; i < otherUsers.length; i++) {
      const user = otherUsers[i];

      if (!peerConnections.has(user.sessionId)) {
        console.log(
          `🔗 Setting up connection with: ${user.userName} (${user.sessionId})`
        );

        // Добавляем задержку между созданием соединений
        await new Promise((resolve) => setTimeout(resolve, 1000 + i * 500));

        try {
          await createOffer(user.sessionId);
          console.log(`✅ Connection setup initiated for ${user.userName}`);
        } catch (error) {
          console.error(
            `❌ Failed to setup connection with ${user.userName}:`,
            error
          );
        }
      }
    }
  }

  async function handleWebRTCOffer(message) {
    try {
      console.log(`📥 Received WebRTC offer from: ${message.fromSessionId}`);

      // Проверяем, не обрабатываем ли мы уже это предложение
      if (peerConnections.has(message.fromSessionId)) {
        const existingPc = peerConnections.get(message.fromSessionId);
        if (
          existingPc.signalingState !== "stable" &&
          existingPc.signalingState !== "closed"
        ) {
          console.log(
            `⚠️ Already processing offer from ${message.fromSessionId}, state: ${existingPc.signalingState}`
          );
          return;
        }
      }

      // Закрываем существующее соединение если есть
      if (peerConnections.has(message.fromSessionId)) {
        const oldPc = peerConnections.get(message.fromSessionId);
        if (oldPc.signalingState !== "closed") {
          oldPc.close();
        }
        peerConnections.delete(message.fromSessionId);
      }

      const pc = await createPeerConnection(message.fromSessionId);

      // Устанавливаем удаленное описание
      await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
      console.log(`✅ Remote description set, state: ${pc.signalingState}`);

      // Обрабатываем отложенные ICE кандидаты после установки remote description
      await processPendingIceCandidates(pc, message.fromSessionId);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendMessage({
        type: "webrtc_answer",
        roomId: message.roomId,
        targetSessionId: message.fromSessionId,
        answer: answer,
      });

      console.log(`✅ Answer created and sent to ${message.fromSessionId}`);
    } catch (error) {
      console.error("❌ Error handling WebRTC offer:", error);

      // Очищаем проблемное соединение
      if (message.fromSessionId && peerConnections.has(message.fromSessionId)) {
        peerConnections.get(message.fromSessionId).close();
        peerConnections.delete(message.fromSessionId);
      }
    }
  }

  async function handleWebRTCAnswer(message) {
    try {
      console.log(`📥 Received WebRTC answer from: ${message.fromSessionId}`);

      const pc = peerConnections.get(message.fromSessionId);
      if (!pc) {
        console.warn(
          `❌ No peer connection found for ${message.fromSessionId}`
        );
        return;
      }

      // Проверяем состояние соединения
      if (pc.signalingState === "closed" || pc.connectionState === "closed") {
        console.warn(
          `⚠️ Connection is closed for ${message.fromSessionId}, ignoring answer`
        );
        return;
      }

      // Если соединение уже установлено, игнорируем новый answer
      if (
        pc.connectionState === "connected" ||
        pc.iceConnectionState === "connected"
      ) {
        console.log(
          `✅ Already connected to ${message.fromSessionId}, ignoring duplicate answer`
        );
        return;
      }

      // Устанавливаем удаленное описание
      await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
      console.log(
        `✅ Remote description set for ${message.fromSessionId}, signaling state: ${pc.signalingState}`
      );

      // Обрабатываем отложенные ICE кандидаты после установки remote description
      await processPendingIceCandidates(pc, message.fromSessionId);
    } catch (error) {
      console.error("❌ Error handling WebRTC answer:", error);

      // Не пересоздаем соединение при ошибке - это вызывает цикл
      console.log(
        `⚠️ Answer error for ${message.fromSessionId}, but not recreating connection to avoid loop`
      );
    }
  }

  async function handleICECandidate(message) {
    try {
      const pc = peerConnections.get(message.fromSessionId);
      if (!pc) {
        console.warn(
          `❌ No peer connection for ICE candidate from ${message.fromSessionId}`
        );
        return;
      }

      // Проверяем состояние соединения
      if (pc.signalingState === "closed" || pc.connectionState === "closed") {
        console.warn(
          `⚠️ Connection closed for ${message.fromSessionId}, ignoring ICE candidate`
        );
        return;
      }

      // Если remote description еще не установлен, сохраняем кандидата в очередь
      if (!pc.remoteDescription) {
        console.log(
          `⏳ Queueing ICE candidate - waiting for remote description from ${message.fromSessionId}`
        );

        // Создаем очередь для отложенных кандидатов
        if (!pc.pendingIceCandidates) {
          pc.pendingIceCandidates = [];
        }
        pc.pendingIceCandidates.push(new RTCIceCandidate(message.candidate));
        return;
      }

      // Пытаемся добавить кандидат
      await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
      console.log(`🧊 ICE candidate added from ${message.fromSessionId}`);
    } catch (error) {
      console.error("❌ Error handling ICE candidate:", error);
      // Не критичная ошибка - продолжаем работу
    }
  }

  function handleUserLeft(message) {
    roomUsers.delete(message.sessionId);

    if (peerConnections.has(message.sessionId)) {
      peerConnections.get(message.sessionId).close();
      peerConnections.delete(message.sessionId);
    }

    removeVideoElement(message.sessionId);
    showSystemMessage(`👤 ${message.userName} покинул звонок`);
    updateParticipantsCount(roomUsers.size);
  }

  function removeVideoElement(sessionId) {
    const videoContainer = document.getElementById(
      `videoContainer_${sessionId}`
    );
    if (videoContainer) {
      videoContainer.remove();
      // Обновляем компоновку сетки после удаления
      setTimeout(updateVideoGridLayout, 100);
    }
  }

  function updateRoomUsers() {
    if (currentRoomId) {
      sendMessage({
        type: "get_room_users",
        roomId: currentRoomId,
      });
    }
  }

  function updateCallStatus(state) {
    if (callStatusEl) {
      const statusMap = {
        connected: "✅ Подключено",
        connecting: "🔄 Подключение...",
        disconnected: "⚠️ Соединение прервано",
        failed: "❌ Ошибка соединения",
        closed: "🔌 Соединение закрыто",
      };
      callStatusEl.textContent = statusMap[state] || state;
    }
  }

  function debugRoomUsers() {
    console.log("🔍 DEBUG Room Users:");
    console.log(`Total in room: ${roomUsers.size}`);
    roomUsers.forEach((user, sessionId) => {
      console.log(
        `- ${user.userName} (${sessionId}) ${
          sessionId === mySessionId ? "(You)" : ""
        }`
      );
    });

    console.log("🔍 DEBUG Peer Connections:");
    console.log(`Total peer connections: ${peerConnections.size}`);
    peerConnections.forEach((pc, sessionId) => {
      console.log(`- ${sessionId}: ${pc.connectionState}`);
    });

    console.log("🔍 DEBUG Video Elements:");
    const videoContainers = document.querySelectorAll(".video-container");
    console.log(`Total video containers: ${videoContainers.length}`);
  }

  // Вызывайте эту функцию для отладки:
  // debugRoomUsers();

  function updateParticipantsCount(count) {
    participantsCount = count;
    if (participantsCountEl) {
      participantsCountEl.textContent = `Участников: ${count}`;
      // Добавляем визуальную индикацию если участников больше 2
      if (count > 2) {
        participantsCountEl.style.color = "#fbbf24";
        participantsCountEl.style.fontWeight = "bold";
      } else {
        participantsCountEl.style.color = "";
        participantsCountEl.style.fontWeight = "";
      }
    }

    // Логируем для отладки
    console.log(`👥 Participants count updated: ${count}`);
    debugRoomUsers();
  }

  // UI управления звонком
  function showVideoCallUI() {
    videoCallContainer.classList.remove("hidden");
    updateCallButtons();
    updateParticipantsCount(1);
  }

  function hideVideoCallUI() {
    videoCallContainer.classList.add("hidden");
  }

  function updateCallButtons() {
    if (startCallBtn) startCallBtn.disabled = isInCall;
    if (endCallBtn) endCallBtn.disabled = !isInCall;
  }

  function toggleVideo() {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        toggleVideoBtn.textContent = videoTrack.enabled ? "🎥" : "❌🎥";
        toggleVideoBtn.style.background = videoTrack.enabled ? "" : "#ff6b6b";
        showSystemMessage(
          videoTrack.enabled ? "✅ Камера включена" : "❌ Камера выключена"
        );
      }
    }
  }

  function toggleAudio() {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        toggleAudioBtn.textContent = audioTrack.enabled ? "🎤" : "❌🎤";
        toggleAudioBtn.style.background = audioTrack.enabled ? "" : "#ff6b6b";
        showSystemMessage(
          audioTrack.enabled ? "✅ Микрофон включен" : "❌ Микрофон выключен"
        );
      }
    }
  }

  function endCall() {
    console.log("📞 Ending call...");

    // Отправляем сообщение о выходе из комнаты
    if (currentRoomId) {
      sendMessage({ type: "leave_room", roomId: currentRoomId });
      sendMessage({ type: "end_call", roomId: currentRoomId });
    }

    // Закрываем все peer соединения с очисткой
    peerConnections.forEach((pc, sessionId) => {
      cleanupPendingCandidates(sessionId);
      pc.close();
      removeVideoElement(sessionId);
    });

    peerConnections.clear();

    // Останавливаем локальный поток
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      localStream = null;
    }

    // Сбрасываем состояние
    currentRoomId = null;
    isInCall = false;
    isCallInitiator = false;
    roomUsers.clear();
    incomingCall = null;

    // Обновляем UI
    hideVideoCallUI();
    hideIncomingCallModal();
    updateCallButtons();
    showSystemMessage("📞 Звонок завершен");
  }

  function showBrowserNotification(title, body) {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, {
        body: body,
        icon: "/favicon.ico",
      });
    }
  }

  // Глобальные функции
  window.downloadFile = function (filename, filetype, base64Data) {
    const link = document.createElement("a");
    link.href = `data:${filetype};base64,${base64Data}`;
    link.download = filename;
    link.click();
  };

  // Запрос разрешения на уведомления
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  // Обработка закрытия страницы
  window.addEventListener("beforeunload", () => {
    if (ws) {
      ws.close(1000, "Page closed");
    }
    endCall();
  });

  // Инициализация при загрузке
  window.addEventListener("DOMContentLoaded", () => {
    setVH();
    init();
  });
})();
