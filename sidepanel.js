let db;
let currentChatId;

document.addEventListener("DOMContentLoaded", () => {
  const chatMessages = document.getElementById("chat-messages");
  const userInput = document.getElementById("user-input");
  const sendButton = document.getElementById("send-button");
  const newChatButton = document.getElementById("new-chat-button");
  const chatHistory = document.getElementById("chat-history");

  // Move the message listener inside DOMContentLoaded
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "closeSidebar") {
      window.close();
    } else if (message.action === "updateInput") {
      userInput.value = message.text;
    }
  });

  // Initialize IndexedDB
  const request = indexedDB.open("ChatDatabase", 2);
  request.onerror = (event) => console.error("IndexedDB error:", event.target.error);
  request.onsuccess = (event) => {
    db = event.target.result;
    loadChatHistory();
    loadMostRecentChat();
  };
  request.onupgradeneeded = (event) => {
    const db = event.target.result;
    if (!db.objectStoreNames.contains("chats")) {
      const objectStore = db.createObjectStore("chats", { keyPath: "id", autoIncrement: true });
      objectStore.createIndex("timestamp", "timestamp", { unique: false });
      objectStore.createIndex("chatId", "chatId", { unique: false });
    } else {
      const transaction = event.target.transaction;
      const objectStore = transaction.objectStore("chats");
      if (!objectStore.indexNames.contains("chatId")) {
        objectStore.createIndex("chatId", "chatId", { unique: false });
      }
    }
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
      if (!currentChatId) {
        createNewChat();
      }
      addMessageToChat("user", message);
      saveMessageToDb("user", message);

      getPageContentAndSelection()
        .then(({ pageContent, selectedText }) => {
          console.log("Current page content:", pageContent);
          console.log("Selected text:", selectedText);

          const fullMessage = `User message: ${message}\n\nPage content: ${pageContent}\n\nSelected text: ${selectedText}`;
          return sendToGPT(fullMessage);
        })
        .then((response) => {
          addMessageToChat("ai", response);
          saveMessageToDb("ai", response);
        })
        .catch((error) => {
          console.error("Error in sendMessage:", error);
          addMessageToChat("system", "An error occurred. Please try again.");
        });

      userInput.value = "";
    }
  }

  function getPageContentAndSelection() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: "getPageContentAndSelection" }, (response) => {
            if (chrome.runtime.lastError) {
              console.error("Error in getPageContentAndSelection:", chrome.runtime.lastError);
              resolve({ pageContent: "", selectedText: "" });
            } else if (response && response.pageContent !== undefined && response.selectedText !== undefined) {
              resolve(response);
            } else {
              console.error("Invalid response in getPageContentAndSelection");
              resolve({ pageContent: "", selectedText: "" });
            }
          });
        } else {
          console.error("No active tab found");
          resolve({ pageContent: "", selectedText: "" });
        }
      });
    });
  }

  function sendToGPT(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "sendToGPT", message: message }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.response) {
          resolve(response.response);
        } else {
          reject(new Error("Invalid response from GPT"));
        }
      });
    });
  }

  function addMessageToChat(sender, message) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", sender);
    messageElement.textContent = message;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function saveMessageToDb(sender, message) {
    if (!db) {
      console.error("Database not initialized");
      return;
    }
    const transaction = db.transaction(["chats"], "readwrite");
    const store = transaction.objectStore("chats");
    const chatMessage = {
      chatId: currentChatId,
      sender: sender,
      message: message,
      timestamp: new Date().getTime(),
    };
    store.add(chatMessage).onsuccess = () => {
      loadChatHistory();
    };
  }

  function loadChatHistory() {
    if (!db) {
      console.error("Database not initialized");
      return;
    }
    const transaction = db.transaction(["chats"], "readonly");
    const store = transaction.objectStore("chats");
    const index = store.index("timestamp");
    const request = index.openCursor(null, "prev");
    const chats = new Map();

    chatHistory.innerHTML = "";

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const chatId = cursor.value.chatId;
        if (!chats.has(chatId)) {
          chats.set(chatId, cursor.value);
          const chatItem = document.createElement("div");
          chatItem.classList.add("chat-item");
          chatItem.dataset.chatId = chatId;
          chatItem.textContent = `${new Date(cursor.value.timestamp).toLocaleString()} - ${cursor.value.message.substring(0, 30)}...`;
          chatItem.addEventListener("click", () => loadChat(chatId));
          chatHistory.appendChild(chatItem);
        }
        cursor.continue();
      }
    };
  }

  function loadChat(chatId) {
    console.log("Loading chat:", chatId); // Debug log
    if (!db) {
      console.error("Database not initialized");
      return;
    }
    currentChatId = chatId;
    chatMessages.innerHTML = "";
    const transaction = db.transaction(["chats"], "readonly");
    const store = transaction.objectStore("chats");
    const index = store.index("chatId");
    const request = index.getAll(chatId);

    request.onsuccess = (event) => {
      const messages = event.target.result;
      console.log("Messages for chat:", messages); // Debug log
      if (messages.length === 0) {
        console.log("No messages found for chatId:", chatId); // Debug log
      }
      messages.sort((a, b) => a.timestamp - b.timestamp);
      messages.forEach((msg) => addMessageToChat(msg.sender, msg.message));
    };

    // Update the visual feedback for the selected chat
    updateSelectedChat(chatId);
  }

  function updateSelectedChat(chatId) {
    const chatItems = document.querySelectorAll(".chat-item");
    chatItems.forEach((item) => {
      if (item.dataset.chatId == chatId) {
        item.classList.add("selected");
      } else {
        item.classList.remove("selected");
      }
    });
  }

  function createNewChat() {
    currentChatId = Date.now().toString();
    chatMessages.innerHTML = "";
    userInput.value = "";
    userInput.focus();
    loadChatHistory(); // Refresh the chat history to include the new chat
    updateSelectedChat(currentChatId);
  }

  function loadMostRecentChat() {
    if (!db) {
      console.error("Database not initialized");
      return;
    }
    const transaction = db.transaction(["chats"], "readonly");
    const store = transaction.objectStore("chats");
    const index = store.index("timestamp");
    const request = index.openCursor(null, "prev");

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        loadChat(cursor.value.chatId);
      } else {
        // No existing chats, create a new one
        createNewChat();
      }
    };
  }

  chrome.runtime.sendMessage({ action: "getSelectedText" }, (response) => {
    if (response && response.selectedText) {
      userInput.value = response.selectedText;
    } else if (response && response.error) {
      console.error("Error getting selected text:", response.error);
    }
  });

  // Handle messages from the content script
  window.addEventListener("message", (event) => {
    if (event.data.type === "selectedText" && event.data.text) {
      if (!currentChatId) {
        createNewChat();
      }
      userInput.value = event.data.text;
    }
  });

  // Get selected text when the side panel is opened
  chrome.runtime.sendMessage({ action: "getSelectedText" }, (response) => {
    if (response && response.selectedText) {
      if (!currentChatId) {
        createNewChat();
      }
      // addMessageToChat("user", "Selected text: " + response.selectedText);
      // saveMessageToDb("user", "Selected text: " + response.selectedText);
      userInput.value = response.selectedText;
    } else if (response && response.error) {
      console.error("Error getting selected text:", response.error);
    }
  });

  // Request the current selected text when the panel opens
  chrome.runtime.sendMessage({ action: "getCurrentSelectedText" }, (response) => {
    if (response && response.selectedText) {
      userInput.value = response.selectedText;
    }
  });
});
