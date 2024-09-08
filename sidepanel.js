import { initializeSettings } from "./settings.js";
import { models, defaults, defaultProvider } from "./config.js";

let db;
let currentChatId;
let sidebarState = "open";

function initializeUI() {
  initializeEventListeners();
  initDatabase()
    .then(() => loadChatHistory())
    .then(() => loadMostRecentChat())
    .catch((error) => console.error("Error during initialization:", error));
  initializeModelSelect();
  restoreSidebarState();
  setupMessageListeners();
}

const { updateConfiguredModels, openSettings } = initializeSettings();

function initializeEventListeners() {
  document.getElementById("send-button").addEventListener("click", sendMessage);
  document.getElementById("user-input").addEventListener("keydown", handleUserInputKeydown);
  document.getElementById("new-chat-button").addEventListener("click", createNewChat);
  document.getElementById("minimize-button").addEventListener("click", toggleSidebar);
  document.getElementById("expand-sidebar-button").addEventListener("click", toggleSidebar);
  document.getElementById("new-chat-button-collapsed").addEventListener("click", handleNewChatCollapsed);
  document.getElementById("model-select").addEventListener("change", handleModelSelectChange);
  document.getElementById("settings-button").addEventListener("click", openSettings);
  document.getElementById("settings-button-collapsed").addEventListener("click", openSettings);
}

function initDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ChatDatabase", 6);
    request.onerror = (event) => reject("IndexedDB error: " + event.target.error);
    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("chats")) {
        const objectStore = db.createObjectStore("chats", { keyPath: "chatId" });
        objectStore.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
  });
}

async function sendMessage() {
  const userInput = document.getElementById("user-input");

  const modelsAvailable = await updateConfiguredModels();
  if (!modelsAvailable) {
    openSettings();
    return;
  }
  const message = userInput.innerHTML.trim();
  if (message) {
    if (!currentChatId) {
      try {
        await createNewChat();
      } catch (error) {
        return;
      }
    }
    proceedWithSendMessage(message);
  }
}

function proceedWithSendMessage(message) {
  const timestamp = Date.now();
  let chatData;

  getCurrentTabUrl()
    .then((currentUrl) => {
      if (!currentUrl) {
        throw new Error("No URL found for the active tab");
      }

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(["chats"], "readwrite");
        const store = transaction.objectStore("chats");
        const getRequest = store.get(currentChatId);

        getRequest.onsuccess = (event) => {
          chatData = event.target.result || {
            chatId: currentChatId,
            timestamp: Date.now(),
            messages: [],
          };

          const lastUrlMessage = chatData.messages.findLast((msg) => msg.type === "url");
          const urlChanged = !lastUrlMessage || currentUrl !== lastUrlMessage.url;

          if (urlChanged) {
            const urlTimestamp = Date.now();
            addUrlToChat(currentUrl, urlTimestamp);
            chatData.messages.push({
              type: "url",
              url: currentUrl,
              timestamp: urlTimestamp,
            });
          }

          addMessageToChat("user", message, timestamp);
          chatData.messages.push({
            type: "message",
            sender: "user",
            message: message,
            timestamp: timestamp,
          });

          const putRequest = store.put(chatData);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = (error) => reject(error);
        };

        getRequest.onerror = (error) => reject(error);
      });
    })
    .then(() => {
      return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "getPageContentAndSelection" }, (response) => {
              if (chrome.runtime.lastError) {
                resolve({ pageContent: "", selectedText: "" });
              } else if (response && response.pageContent !== undefined && response.selectedText !== undefined) {
                resolve(response);
              } else {
                resolve({ pageContent: "", selectedText: "" });
              }
            });
          } else {
            resolve({ pageContent: "", selectedText: "" });
          }
        });
      });
    })
    .then(({ pageContent, selectedText }) => {
      const lastMessages = chatData.messages
        .filter((msg) => msg.type === "message")
        .slice(-10)
        .map((msg) => ({
          role: msg.sender === "user" ? "user" : "assistant",
          content: msg.message,
        }));

      const systemMessage = `You are a librarian who will be given some content from a webpage. Your job is to answer questions based on this content.${
        selectedText ? " You will also be given a selected text from the webpage, which may be the focus of the question." : ""
      }\n\nPage content: ${pageContent}${selectedText ? `\n\nSelected text: ${selectedText}` : ""}`;

      const messages = [
        {
          role: "system",
          content: systemMessage,
        },
        ...lastMessages,
        { role: "user", content: message },
      ];

      const aiTimestamp = Date.now();
      const aiMessageElement = addMessageToChat("ai", "", aiTimestamp);

      chatData.messages.push({
        type: "message",
        sender: "ai",
        message: "",
        timestamp: aiTimestamp,
      });

      return sendToGPT(messages, aiMessageElement);
    })
    .then((response) => {
      const aiMessage = chatData.messages[chatData.messages.length - 1];
      aiMessage.message = response;

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(["chats"], "readwrite");
        const store = transaction.objectStore("chats");
        const putRequest = store.put(chatData);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = (error) => reject(error);
      });
    })
    .then(() => {})
    .catch((error) => {
      addMessageToChat("system", "An error occurred. Please try again.", Date.now());
    });

  document.getElementById("user-input").innerHTML = "";
}

function sendToGPT(messages, aiMessageElement) {
  return new Promise((resolve, reject) => {
    let fullResponse = "";

    chrome.runtime.sendMessage({ action: "sendToGPT", messages: messages }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      }
    });

    const messageListener = (msg) => {
      if (msg.action === "streamResponse") {
        fullResponse += msg.content;
        handleStreamResponse(msg.content, aiMessageElement);
      } else if (msg.action === "streamEnd") {
        chrome.runtime.onMessage.removeListener(messageListener);
        finalizeMessage(aiMessageElement, fullResponse);
        resolve(fullResponse);
      } else if (msg.action === "error") {
        chrome.runtime.onMessage.removeListener(messageListener);
        reject(new Error(msg.error));
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
  });
}

function handleStreamResponse(content, aiMessageElement) {
  if (!aiMessageElement) {
    return;
  }

  const messageContent = aiMessageElement.querySelector(".message-content");
  if (!messageContent) {
    return;
  }

  aiMessageElement.dataset.markdown = (aiMessageElement.dataset.markdown || "") + content;
  messageContent.innerHTML = marked.parseInline(aiMessageElement.dataset.markdown);
  aiMessageElement.scrollIntoView({ behavior: "smooth", block: "end" });
}

function finalizeMessage(aiMessageElement, fullResponse) {
  if (!aiMessageElement) {
    return;
  }

  const messageContent = aiMessageElement.querySelector(".message-content");
  if (!messageContent) {
    return;
  }

  messageContent.innerHTML = marked.parse(fullResponse);

  aiMessageElement.querySelectorAll("a").forEach((link) => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });

  aiMessageElement.scrollIntoView({ behavior: "smooth", block: "end" });
}

function handleUserInputKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function handleModelSelectChange() {
  const { provider, model } = JSON.parse(this.value);
  chrome.storage.local.set({ provider, model }, () => {});
}

function handleNewChatCollapsed() {
  createNewChat();
  toggleSidebar();
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const body = document.body;
  const collapsedSidebar = document.getElementById("collapsed-sidebar");

  sidebar.classList.toggle("collapsed");
  body.classList.toggle("sidebar-collapsed");

  if (body.classList.contains("sidebar-collapsed")) {
    collapsedSidebar.style.display = "flex";
    sidebarState = "collapsed";
  } else {
    collapsedSidebar.style.display = "none";
    sidebarState = "open";
  }

  chrome.storage.local.set({ sidebarState: sidebarState }, () => {
    console.log("Sidebar state saved:", sidebarState);
  });
}

function restoreSidebarState() {
  chrome.storage.local.get(["sidebarState"], (result) => {
    if (result.sidebarState === "collapsed") {
      toggleSidebar();
    }
  });
}

function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "closeSidebar") {
      window.close();
    } else if (message.action === "updateInput") {
      const userInput = document.getElementById("user-input");
      if (userInput) {
        userInput.innerHTML = message.text;
      }
    } else if (message.action === "modelChanged") {
      updateModelSelect(message.provider, message.model);
    } else if (message.action === "toggleSidebar") {
      toggleSidebar();
    } else if (message.action === "createNewChat") {
      createNewChat();
    } else if (message.action === "updateSelectedText") {
      handleSelectedText(message.selectedText);
    }
  });

  window.addEventListener("message", (event) => {
    if (event.data.type === "selectedText" && event.data.text) {
      if (!currentChatId) {
        createNewChat();
      }
      setInputAsQuote(event.data.text);
    }
  });

  chrome.runtime.sendMessage({ action: "getSelectedText" }, (response) => {
    if (response && response.selectedText) {
      handleSelectedText(response.selectedText);
    }
  });

  chrome.runtime.sendMessage({ action: "getCurrentSelectedText" }, (response) => {
    if (response && response.selectedText) {
      handleSelectedText(response.selectedText);
    }
  });
}

async function createNewChat() {
  if (!db) {
    throw new Error("Database not initialized");
  }

  try {
    const url = await getCurrentTabUrl();
    if (!url) {
      throw new Error("No URL found for the active tab");
    }

    currentChatId = Date.now().toString();
    const chatMessages = document.getElementById("chat-messages");
    const userInput = document.getElementById("user-input");
    chatMessages.innerHTML = "";
    userInput.innerHTML = "";
    userInput.focus();

    const transaction = db.transaction(["chats"], "readwrite");
    const store = transaction.objectStore("chats");
    const newChat = {
      chatId: currentChatId,
      timestamp: Date.now(),
      messages: [
        {
          type: "url",
          url: url,
          timestamp: Date.now(),
        },
      ],
    };

    await new Promise((resolve, reject) => {
      const addRequest = store.add(newChat);
      addRequest.onsuccess = () => {
        updateSelectedChat(currentChatId);
        resolve();
      };
      addRequest.onerror = (error) => {
        reject(error);
      };
    });

    await loadChatHistory();
    await loadChat(currentChatId);
  } catch (error) {
    throw error;
  }
}

function loadChatHistory() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject("Database not initialized");
      return;
    }

    const transaction = db.transaction(["chats"], "readonly");
    const store = transaction.objectStore("chats");
    const index = store.index("timestamp");
    const request = index.openCursor(null, "prev");
    const chats = new Map();

    document.getElementById("chat-history").innerHTML = "";

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const chatData = cursor.value;
        if (!chats.has(chatData.chatId)) {
          chats.set(chatData.chatId, chatData);
          const chatItem = createChatHistoryItem(chatData);
          document.getElementById("chat-history").appendChild(chatItem);
        }
        cursor.continue();
      } else {
        resolve();
      }
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

function loadChat(chatId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject("Database not initialized");
      return;
    }

    currentChatId = chatId;
    document.getElementById("chat-messages").innerHTML = "";

    const transaction = db.transaction(["chats"], "readonly");
    const store = transaction.objectStore("chats");
    const request = store.get(chatId);

    request.onsuccess = (event) => {
      const chatData = event.target.result;

      if (!chatData) {
        resolve();
        return;
      }

      let currentDate = null;
      if (Array.isArray(chatData.messages)) {
        chatData.messages.forEach((item) => {
          const itemDate = new Date(item.timestamp).toLocaleDateString();
          if (itemDate !== currentDate) {
            currentDate = itemDate;
            addDateToChat(currentDate);
          }
          if (item.type === "url") {
            addUrlToChat(item.url, item.timestamp);
          } else if (item.type === "message") {
            addMessageToChat(item.sender, item.message, item.timestamp);
          }
        });
      } else {
      }
      updateSelectedChat(chatId);
      document.getElementById("chat-messages").scrollTop = document.getElementById("chat-messages").scrollHeight;
      resolve();
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

function addDateToChat(date) {
  const dateElement = document.createElement("div");
  dateElement.classList.add("chat-date");
  dateElement.textContent = new Date(date).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  document.getElementById("chat-messages").appendChild(dateElement);
}

function addUrlToChat(url, timestamp) {
  const urlElement = document.createElement("div");
  urlElement.classList.add("chat-url");
  const time = new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  urlElement.innerHTML = `<span class="chat-time">${time}</span> <a href="${url}" target="_blank">${url}</a>`;
  document.getElementById("chat-messages").appendChild(urlElement);
  document.getElementById("chat-messages").scrollTop = document.getElementById("chat-messages").scrollHeight;
}

function addMessageToChat(sender, message, timestamp) {
  const messageElement = document.createElement("div");
  messageElement.classList.add("message", sender);

  const time = new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const timeElement = document.createElement("span");
  timeElement.classList.add("chat-time");
  timeElement.textContent = time;
  messageElement.appendChild(timeElement);

  const messageContent = document.createElement("div");
  messageContent.classList.add("message-content");

  messageContent.innerHTML = marked.parse(message);

  messageElement.appendChild(messageContent);

  messageElement.querySelectorAll("a").forEach((link) => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });

  document.getElementById("chat-messages").appendChild(messageElement);
  document.getElementById("chat-messages").scrollTop = document.getElementById("chat-messages").scrollHeight;

  addCopyButtonToCodeBlocks(messageContent);

  if (sender === "ai") {
    addCopyButtonToMessage(messageElement, message);
  }

  return messageElement;
}

function addCopyButtonToCodeBlocks(container) {
  const codeBlocks = container.querySelectorAll("pre");
  codeBlocks.forEach((codeBlock) => {
    const copyButton = document.createElement("button");
    copyButton.className = "copy-button";
    copyButton.addEventListener("click", () => {
      const code = codeBlock.querySelector("code").textContent;
      copyToClipboard(code, copyButton);
    });
    codeBlock.appendChild(copyButton);
  });
}

function addCopyButtonToMessage(messageElement, message) {
  const copyButton = document.createElement("button");
  copyButton.className = "copy-button message-copy-button";
  copyButton.addEventListener("click", () => {
    copyToClipboard(message, copyButton);
  });
  messageElement.appendChild(copyButton);
}

function copyToClipboard(text, button) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      button.classList.add("copied");
      setTimeout(() => {
        button.classList.remove("copied");
      }, 2000);
    })
    .catch((err) => {});
}

function getCurrentTabUrl() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "getCurrentTabUrl" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else if (response) {
        resolve(response);
      } else {
        reject(new Error("No active tab found"));
      }
    });
  });
}

function updateSelectedChat(chatId) {
  const chatItems = document.querySelectorAll(".chat-item");
  chatItems.forEach((item) => {
    if (item.dataset.chatId === chatId) {
      item.classList.add("selected");
    } else {
      item.classList.remove("selected");
    }
  });
}

function loadMostRecentChat() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject("Database not initialized");
      return;
    }

    const transaction = db.transaction(["chats"], "readonly");
    const store = transaction.objectStore("chats");
    const index = store.index("timestamp");
    const request = index.openCursor(null, "prev");

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        loadChat(cursor.value.chatId)
          .then(() => {
            updateSelectedChat(cursor.value.chatId);
            resolve();
          })
          .catch(reject);
      } else {
        createNewChat().then(resolve).catch(reject);
      }
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

function createChatHistoryItem(chatData) {
  const chatItem = document.createElement("div");
  chatItem.classList.add("chat-item");
  chatItem.dataset.chatId = chatData.chatId;

  const timeAgo = formatTimestamp(chatData.timestamp);

  const domains = new Set();
  chatData.messages.forEach((msg) => {
    if (msg.type === "url" && msg.url) {
      try {
        const url = new URL(msg.url);
        domains.add(url.hostname);
      } catch (error) {}
    }
  });

  const domainList = Array.from(domains).slice(0, 3);
  const domainText = domainList.join(", ") || "No domains";

  const lastMessage = chatData.messages.findLast((msg) => msg.type === "message")?.message || "New chat";

  chatItem.innerHTML = `
    <div class="chat-item-header">
      <span class="chat-item-time">${timeAgo}</span>
      <button class="delete-chat-button" title="Delete chat">[X]</button>
    </div>
    <div class="chat-item-domain" title="${domainText}">${domainText}</div>
    <div class="chat-item-message" title="${lastMessage}">${lastMessage.substring(0, 30)}${lastMessage.length > 30 ? "..." : ""}</div>
  `;

  chatItem.addEventListener("click", (e) => {
    if (!e.target.classList.contains("delete-chat-button")) {
      loadChat(chatData.chatId);
    }
  });

  const deleteButton = chatItem.querySelector(".delete-chat-button");
  deleteButton.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteChat(chatData.chatId);
  });

  return chatItem;
}

function formatTimestamp(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "<1 min ago";
  if (minutes < 60) return `${minutes} min${minutes > 1 ? "s" : ""} ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;

  return new Date(timestamp).toLocaleDateString();
}

function deleteChat(chatId) {
  if (!db) {
    return;
  }

  const transaction = db.transaction(["chats"], "readwrite");
  const store = transaction.objectStore("chats");
  const request = store.delete(chatId);

  request.onsuccess = () => {
    loadChatHistory();
    if (currentChatId === chatId) {
      loadMostRecentChat();
    }
  };

  request.onerror = (event) => {};
}

function setInputAsQuote(text) {
  if (text && text.trim()) {
    const cleanText = text
      .trim()
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");

    const formattedText = cleanText.replace(/\n/g, "<br>");

    document.getElementById("user-input").innerHTML = `<blockquote>${formattedText}</blockquote><p><br></p>`;
    document.getElementById("user-input").focus();

    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(document.getElementById("user-input"));
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function handleSelectedText(selectedText) {
  if (selectedText && selectedText.trim()) {
    if (!currentChatId) {
      createNewChat();
    }
    setInputAsQuote(selectedText);
    document.getElementById("user-input").focus();
  }
}

function initializeModelSelect() {
  chrome.storage.local.get(["provider", "model", "openaiApiKey", "anthropicApiKey", "localUrl", "localModels"], (result) => {
    const currentModel = result.model || defaults[result.provider || defaultProvider].model;
    const localModels = result.localModels || models.local;

    const modelSelect = document.getElementById("model-select");
    modelSelect.innerHTML = "";

    let availableModels = [];

    if (result.openaiApiKey) {
      availableModels = availableModels.concat(models.openai.map((model) => ({ provider: "openai", model })));
    }

    if (result.anthropicApiKey) {
      availableModels = availableModels.concat(models.anthropic.map((model) => ({ provider: "anthropic", model })));
    }

    if (result.localUrl) {
      availableModels = availableModels.concat(localModels.map((model) => ({ provider: "local", model })));
    }

    availableModels = Array.from(new Set(availableModels.map(JSON.stringify))).map(JSON.parse);

    availableModels.forEach(({ provider, model }) => {
      const option = document.createElement("option");
      option.value = JSON.stringify({ provider, model });
      option.textContent = `${provider}: ${model}`;
      modelSelect.appendChild(option);
    });

    const currentModelOption = Array.from(modelSelect.options).find((option) => {
      const { model } = JSON.parse(option.value);
      return model === currentModel;
    });

    if (currentModelOption) {
      modelSelect.value = currentModelOption.value;
    }

    console.log(
      "Model select options:",
      Array.from(modelSelect.options).map((opt) => opt.value)
    );
  });
}

function updateModelSelect(newProvider, newModel) {
  const modelSelect = document.getElementById("model-select");
  if (modelSelect) {
    const options = Array.from(modelSelect.options);
    const foundOption = options.find((option) => {
      const { provider, model } = JSON.parse(option.value);
      return provider === newProvider && model === newModel;
    });

    if (foundOption) {
      modelSelect.value = foundOption.value;
    }
  }
}

document.addEventListener("DOMContentLoaded", initializeUI);
