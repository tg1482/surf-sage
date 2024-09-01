import { initializeSettings } from "./settings.js";
import { models, defaults, defaultProvider } from "./config.js";

// Move updateModelSelect outside of DOMContentLoaded
function updateModelSelect(newModel) {
  console.log("Updating model select to:", newModel);
  const modelSelect = document.getElementById("model-select");
  if (modelSelect) {
    console.log(
      "Model select options:",
      Array.from(modelSelect.options).map((opt) => opt.value)
    );
    let found = false;
    for (let i = 0; i < modelSelect.options.length; i++) {
      if (modelSelect.options[i].value === newModel) {
        modelSelect.selectedIndex = i;
        found = true;
        console.log("Model updated successfully to index:", i);
        break;
      }
    }
    if (!found) {
      console.error("Model not found in options:", newModel);
    }
  } else {
    console.error("Model select element not found");
  }
}

// Move the message listener outside of DOMContentLoaded
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "closeSidebar") {
    window.close();
  } else if (message.action === "updateInput") {
    const userInput = document.getElementById("user-input");
    if (userInput) {
      userInput.innerHTML = message.text;
    }
  } else if (message.action === "modelChanged") {
    console.log("Received modelChanged message:", message.model);
    updateModelSelect(message.model);
  } else if (message.action === "toggleSidebar") {
    toggleSidebar();
  } else if (message.action === "createNewChat") {
    createNewChat();
  }
});

function initializeModelSelect() {
  chrome.storage.local.get(["provider", "model", "apiKey", "localUrl", "localModels"], (result) => {
    const provider = result.provider || defaultProvider;
    const currentModel = result.model || defaults[provider].model;
    const localModels = result.localModels || models.local;

    const modelSelect = document.getElementById("model-select");
    modelSelect.innerHTML = "";

    let availableModels = models[provider];
    if (provider === "local") {
      availableModels = localModels;
    }

    availableModels.forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = `${provider}: ${model}`;
      modelSelect.appendChild(option);
    });

    if (currentModel) {
      updateModelSelect(currentModel);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const chatMessages = document.getElementById("chat-messages");
  const userInput = document.getElementById("user-input");
  const sendButton = document.getElementById("send-button");
  const newChatButton = document.getElementById("new-chat-button");
  const chatHistory = document.getElementById("chat-history");
  const modelSelect = document.getElementById("model-select");

  const minimizeButton = document.getElementById("minimize-button");
  const expandSidebarButton = document.getElementById("expand-sidebar-button");
  const newChatButtonCollapsed = document.getElementById("new-chat-button-collapsed");

  function toggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    const body = document.body;
    const collapsedSidebar = document.getElementById("collapsed-sidebar");

    sidebar.classList.toggle("collapsed");
    body.classList.toggle("sidebar-collapsed");

    if (body.classList.contains("sidebar-collapsed")) {
      collapsedSidebar.style.display = "flex";
    } else {
      collapsedSidebar.style.display = "none";
    }
  }

  minimizeButton.addEventListener("click", toggleSidebar);
  expandSidebarButton.addEventListener("click", toggleSidebar);
  newChatButtonCollapsed.addEventListener("click", () => {
    createNewChat();
    toggleSidebar();
  });

  modelSelect.addEventListener("change", function () {
    chrome.storage.local.set({ model: this.value });
  });

  const { updateConfiguredModels, openSettings } = initializeSettings();

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && (changes.provider || changes.model || changes.apiKey || changes.localUrl || changes.localModels)) {
      updateConfiguredModels();
    }
  });

  let db;
  let currentChatId;

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

  initDatabase()
    .then(() => {
      console.log("Database initialized successfully");
      return loadChatHistory();
    })
    .then(() => {
      return loadMostRecentChat();
    })
    .catch((error) => {
      console.error("Error during initialization:", error);
    });

  sendButton.addEventListener("click", sendMessage);
  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  newChatButton.addEventListener("click", createNewChat);

  async function sendMessage() {
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
          console.log("New chat created, currentChatId:", currentChatId);
        } catch (error) {
          console.error("Error creating new chat:", error);
          return;
        }
      }
      proceedWithSendMessage(message);
    }
  }

  function proceedWithSendMessage(message) {
    console.log("Sending message:", message);
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
        console.log("User message saved to DB");
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
      })
      .then(({ pageContent, selectedText }) => {
        console.log("Current page content:", pageContent);
        console.log("Selected text:", selectedText);

        // Get the last 10 messages for context
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

        // Prepare the messages array
        const messages = [
          {
            role: "system",
            content: systemMessage,
          },
          ...lastMessages,
          { role: "user", content: message },
        ];

        // Create a placeholder for the AI response
        const aiTimestamp = Date.now();
        const aiMessageElement = addMessageToChat("ai", "", aiTimestamp);

        // Add AI message to chatData
        chatData.messages.push({
          type: "message",
          sender: "ai",
          message: "",
          timestamp: aiTimestamp,
        });

        return sendToGPT(messages, aiMessageElement);
      })
      .then((response) => {
        console.log("GPT response received:", response);

        // Update the AI message in chatData
        const aiMessage = chatData.messages[chatData.messages.length - 1];
        aiMessage.message = response;

        // Save the updated chat data to the database
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(["chats"], "readwrite");
          const store = transaction.objectStore("chats");
          const putRequest = store.put(chatData);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = (error) => reject(error);
        });
      })
      .then(() => {
        console.log("AI response saved to DB");
      })
      .catch((error) => {
        console.error("Error in sendMessage:", error);
        addMessageToChat("system", "An error occurred. Please try again.", Date.now());
      });

    userInput.innerHTML = "";
  }

  function sendToGPT(messages, aiMessageElement) {
    return new Promise((resolve, reject) => {
      let fullResponse = "";

      chrome.runtime.sendMessage({ action: "sendToGPT", messages: messages }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        }
      });

      // Set up a listener for the streamed responses
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
      console.error("aiMessageElement is not defined");
      return;
    }

    const messageContent = aiMessageElement.querySelector(".message-content");
    if (!messageContent) {
      console.error("Could not find .message-content element");
      return;
    }

    aiMessageElement.dataset.markdown = (aiMessageElement.dataset.markdown || "") + content;
    messageContent.innerHTML = marked.parseInline(aiMessageElement.dataset.markdown);
    aiMessageElement.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  function finalizeMessage(aiMessageElement, fullResponse) {
    if (!aiMessageElement) {
      console.error("aiMessageElement is not defined");
      return;
    }

    const messageContent = aiMessageElement.querySelector(".message-content");
    if (!messageContent) {
      console.error("Could not find .message-content element");
      return;
    }

    messageContent.innerHTML = marked.parse(fullResponse);

    // Add target="_blank" to all links
    aiMessageElement.querySelectorAll("a").forEach((link) => {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });

    aiMessageElement.scrollIntoView({ behavior: "smooth", block: "end" });
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

    // Parse and render markdown
    messageContent.innerHTML = marked.parse(message);

    messageElement.appendChild(messageContent);

    // Add target="_blank" to all links
    messageElement.querySelectorAll("a").forEach((link) => {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });

    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    return messageElement;
  }

  // Replace the chrome.tabs.query calls with this function
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

  // Update the createNewChat function
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
          console.log("New chat created successfully");
          resolve();
        };
        addRequest.onerror = (error) => {
          console.error("Error creating new chat:", error);
          reject(error);
        };
      });

      await loadChatHistory();
      updateSelectedChat(currentChatId);
      await loadChat(currentChatId);

      console.log("New chat created with URL:", url);
    } catch (error) {
      console.error("Error in createNewChat:", error);
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

      chatHistory.innerHTML = "";

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const chatData = cursor.value;
          if (!chats.has(chatData.chatId)) {
            chats.set(chatData.chatId, chatData);
            const chatItem = createChatHistoryItem(chatData);
            chatHistory.appendChild(chatItem);
          }
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = (event) => {
        console.error("Error loading chat history:", event.target.error);
        reject(event.target.error);
      };
    });
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

  function loadChat(chatId) {
    return new Promise((resolve, reject) => {
      if (!db) {
        reject("Database not initialized");
        return;
      }

      console.log("Loading chat:", chatId);
      currentChatId = chatId;
      chatMessages.innerHTML = "";

      const transaction = db.transaction(["chats"], "readonly");
      const store = transaction.objectStore("chats");
      const request = store.get(chatId);

      request.onsuccess = (event) => {
        const chatData = event.target.result;
        console.log("Chat data:", chatData);
        if (!chatData) {
          console.log("No chat data found for chatId:", chatId);
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
          console.error("Chat messages are not in the expected format:", chatData.messages);
        }
        updateSelectedChat(chatId);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        resolve();
      };

      request.onerror = (event) => {
        console.error("Error loading chat:", event.target.error);
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
    chatMessages.appendChild(dateElement);
  }

  function addUrlToChat(url, timestamp) {
    const urlElement = document.createElement("div");
    urlElement.classList.add("chat-url");
    const time = new Date(timestamp).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    urlElement.innerHTML = `<span class="chat-time">${time}</span> <a href="${url}" target="_blank">${url}</a>`;
    chatMessages.appendChild(urlElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
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
          loadChat(cursor.value.chatId).then(resolve).catch(reject);
        } else {
          createNewChat().then(resolve).catch(reject);
        }
      };

      request.onerror = (event) => {
        console.error("Error loading most recent chat:", event.target.error);
        reject(event.target.error);
      };
    });
  }

  // Helper function to create chat history item
  function createChatHistoryItem(chatData) {
    const chatItem = document.createElement("div");
    chatItem.classList.add("chat-item");
    chatItem.dataset.chatId = chatData.chatId;

    const timeAgo = formatTimestamp(chatData.timestamp);

    // Extract unique domains from chat messages
    const domains = new Set();
    chatData.messages.forEach((msg) => {
      if (msg.type === "url" && msg.url) {
        try {
          const url = new URL(msg.url);
          domains.add(url.hostname);
        } catch (error) {
          console.error("Invalid URL:", msg.url);
        }
      }
    });

    // Convert Set to Array and get up to 3 domains
    const domainList = Array.from(domains).slice(0, 3);
    const domainText = domainList.join(", ") || "No domains";

    const lastMessage = chatData.messages.findLast((msg) => msg.type === "message")?.message || "New chat";

    chatItem.innerHTML = `
      <div>${timeAgo}</div>
      <div title="${domainText}">${domainText}</div>
      <div title="${lastMessage}">${lastMessage.substring(0, 30)}${lastMessage.length > 30 ? "..." : ""}</div>
    `;

    chatItem.addEventListener("click", () => loadChat(chatData.chatId));
    return chatItem;
  }

  function setInputAsQuote(text) {
    if (text && text.trim()) {
      // Strip HTML tags and decode HTML entities
      const cleanText = text
        .trim()
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");

      // Replace newlines with <br> tags
      const formattedText = cleanText.replace(/\n/g, "<br>");

      userInput.innerHTML = `<blockquote>${formattedText}</blockquote><p><br></p>`;
      userInput.focus();

      // Move cursor to the end of the userInput
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(userInput);
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
      userInput.focus(); // Add this line to focus the input box
    }
  }

  // Set up a message listener for content script messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "updateSelectedText") {
      handleSelectedText(message.selectedText);
    }
  });

  // Get selected text when the side panel is opened
  chrome.runtime.sendMessage({ action: "getSelectedText" }, (response) => {
    if (response && response.selectedText) {
      handleSelectedText(response.selectedText);
    } else if (response && response.error) {
      console.error("Error getting selected text:", response.error);
    }
  });

  // Request the current selected text when the panel opens
  chrome.runtime.sendMessage({ action: "getCurrentSelectedText" }, (response) => {
    if (response && response.selectedText) {
      handleSelectedText(response.selectedText);
    }
  });

  // Handle messages from the content script
  window.addEventListener("message", (event) => {
    if (event.data.type === "selectedText" && event.data.text) {
      if (!currentChatId) {
        createNewChat();
      }
      setInputAsQuote(event.data.text);
    }
  });

  // Get selected text when the side panel is opened
  chrome.runtime.sendMessage({ action: "getSelectedText" }, (response) => {
    if (response && response.selectedText) {
      handleSelectedText(response.selectedText);
    } else if (response && response.error) {
      console.error("Error getting selected text:", response.error);
    }
  });

  // Request the current selected text when the panel opens
  chrome.runtime.sendMessage({ action: "getCurrentSelectedText" }, (response) => {
    if (response && response.selectedText) {
      handleSelectedText(response.selectedText);
    }
  });

  // Add this function to handle cleanup when the panel is closed
  function handlePanelClose() {
    // Perform any necessary cleanup here
    console.log("Side panel is being closed");
    // For example, you might want to save the current state or clear some data
  }

  // Add an event listener for when the window is about to unload
  window.addEventListener("beforeunload", handlePanelClose);

  initializeModelSelect();

  // Add this to your existing chrome.runtime.onMessage listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "closeSidebar") {
      window.close();
    } else if (message.action === "updateInput") {
      const userInput = document.getElementById("user-input");
      if (userInput) {
        userInput.innerHTML = message.text;
      }
    } else if (message.action === "modelChanged") {
      console.log("Received modelChanged message:", message.model);
      updateModelSelect(message.model);
    } else if (message.action === "toggleSidebar") {
      toggleSidebar();
    } else if (message.action === "createNewChat") {
      createNewChat();
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    const sidebarToggle = document.getElementById("sidebar-toggle");
    if (sidebarToggle) {
      sidebarToggle.addEventListener("click", toggleSidebar);
    }

    const minimizeButton = document.getElementById("minimize-button");
    const expandSidebarButton = document.getElementById("expand-sidebar-button");
    const newChatButtonCollapsed = document.getElementById("new-chat-button-collapsed");

    minimizeButton.addEventListener("click", toggleSidebar);
    expandSidebarButton.addEventListener("click", toggleSidebar);
    newChatButtonCollapsed.addEventListener("click", () => {
      createNewChat();
      toggleSidebar();
    });
  });
});
