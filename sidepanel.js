let db;
let currentChatId;

document.addEventListener("DOMContentLoaded", () => {
  const chatMessages = document.getElementById("chat-messages");
  const userInput = document.getElementById("user-input");
  const sendButton = document.getElementById("send-button");
  const newChatButton = document.getElementById("new-chat-button");
  const chatHistory = document.getElementById("chat-history");

  // Initialize IndexedDB
  const request = indexedDB.open("ChatDatabase", 1);
  request.onerror = (event) => console.error("IndexedDB error:", event.target.error);
  request.onsuccess = (event) => {
    db = event.target.result;
    loadChatHistory();
  };
  request.onupgradeneeded = (event) => {
    const db = event.target.result;
    const objectStore = db.createObjectStore("chats", { keyPath: "id", autoIncrement: true });
    objectStore.createIndex("timestamp", "timestamp", { unique: false });
  };

  sendButton.addEventListener("click", sendMessage);
  userInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  newChatButton.addEventListener("click", createNewChat);

  function sendMessage() {
    const message = userInput.value.trim();
    if (message) {
      addMessageToChat("user", message);
      saveMessageToDb("user", message);
      chrome.runtime.sendMessage({ action: "sendToGPT", message: message }, (response) => {
        addMessageToChat("ai", response.response);
        saveMessageToDb("ai", response.response);
      });
      userInput.value = "";
    }
  }

  function addMessageToChat(sender, message) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", sender);
    messageElement.textContent = message;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function saveMessageToDb(sender, message) {
    const transaction = db.transaction(["chats"], "readwrite");
    const store = transaction.objectStore("chats");
    const chatMessage = {
      chatId: currentChatId,
      sender: sender,
      message: message,
      timestamp: new Date().getTime(),
    };
    store.add(chatMessage);
  }

  function loadChatHistory() {
    const transaction = db.transaction(["chats"], "readonly");
    const store = transaction.objectStore("chats");
    const index = store.index("timestamp");
    const request = index.openCursor(null, "prev");
    const chats = new Map();

    chatHistory.innerHTML = "";

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (!chats.has(cursor.value.chatId)) {
          chats.set(cursor.value.chatId, cursor.value);
          const chatItem = document.createElement("div");
          chatItem.classList.add("chat-item");
          chatItem.textContent = `Chat ${new Date(cursor.value.timestamp).toLocaleString()}`;
          chatItem.addEventListener("click", () => loadChat(cursor.value.chatId));
          chatHistory.appendChild(chatItem);
        }
        cursor.continue();
      }
    };
  }

  function loadChat(chatId) {
    currentChatId = chatId;
    chatMessages.innerHTML = "";
    const transaction = db.transaction(["chats"], "readonly");
    const store = transaction.objectStore("chats");
    const request = store.getAll(IDBKeyRange.only(chatId));

    request.onsuccess = (event) => {
      const messages = event.target.result;
      messages.sort((a, b) => a.timestamp - b.timestamp);
      messages.forEach((msg) => addMessageToChat(msg.sender, msg.message));
    };
  }

  function createNewChat() {
    currentChatId = Date.now();
    chatMessages.innerHTML = "";
    userInput.value = "";
    userInput.focus();
    loadChatHistory();
  }

  // Get selected text when the panel opens
  chrome.runtime.sendMessage({ action: "getSelectedText" }, (response) => {
    if (response && response.selectedText) {
      userInput.value = response.selectedText;
    }
  });

  // Create a new chat when the panel is first opened
  createNewChat();
});
