import { models, defaults, defaultProvider } from "./config.js";

let sidePanelOpen = false;
let currentSelectedText = "";
let currentModelIndex = 0;
let availableModels = [];

function updateAvailableModels() {
  chrome.storage.local.get(["openaiApiKey", "anthropicApiKey", "localUrl", "localModels"], (result) => {
    availableModels = [];
    if (result.openaiApiKey) {
      availableModels = availableModels.concat(models.openai.map((model) => ({ provider: "openai", model })));
    }
    if (result.anthropicApiKey) {
      availableModels = availableModels.concat(models.anthropic.map((model) => ({ provider: "anthropic", model })));
    }
    if (result.localUrl) {
      const localModels = result.localModels || models.local;
      availableModels = availableModels.concat(localModels.map((model) => ({ provider: "local", model })));
    }
  });
}

function toggleModel() {
  if (availableModels.length === 0) {
    return;
  }

  currentModelIndex = (currentModelIndex + 1) % availableModels.length;
  const { provider, model } = availableModels[currentModelIndex];

  chrome.storage.local.set({ provider, model }, () => {
    chrome.runtime.sendMessage({ action: "modelChanged", provider, model });
  });
}

// Update available models when the extension is loaded
updateAvailableModels();

// Listen for changes in storage that might affect available models
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && (changes.openaiApiKey || changes.anthropicApiKey || changes.localUrl || changes.localModels)) {
    updateAvailableModels();
  }
});

// Add this near the top of the file
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle_side_panel") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        if (sidePanelOpen) {
          if (currentSelectedText) {
            // If panel is open and text is selected, send text to input
            chrome.runtime.sendMessage({
              action: "updateInput",
              text: currentSelectedText,
            });
          } else {
            // If panel is open but no text selected, close the panel
            chrome.runtime.sendMessage({
              action: "closeSidebar",
            });
            sidePanelOpen = false;
          }
        } else {
          // Open the side panel
          chrome.sidePanel.open({ tabId: tabs[0].id });
          sidePanelOpen = true;
        }
      }
    });
  } else if (command === "toggle_model") {
    toggleModel();
  } else if (command === "toggle_sidebar") {
    chrome.runtime.sendMessage({ action: "toggleSidebar" });
  } else if (command === "create_new_chat") {
    chrome.runtime.sendMessage({ action: "createNewChat" });
  }
});

// Listen for selection changes from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateSelectedText") {
    currentSelectedText = request.selectedText;
  } else if (request.action === "getCurrentSelectedText") {
    sendResponse({ selectedText: currentSelectedText });
  } else if (request.action === "getSelectedText") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "getSelectedText" }, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse(response);
          }
        });
      } else {
        sendResponse({ error: "No active tab found" });
      }
    });
    return true;
  } else if (request.action === "sendToGPT") {
    sendToGPT(request.messages)
      .then((response) => {
        sendResponse({ response: response });
      })
      .catch((error) => {
        sendResponse({ error: error.message });
      });
    return true;
  } else if (request.action === "getCurrentTabUrl") {
    getCurrentTabUrl(sendResponse);
    return true; // Indicates we want to send a response asynchronously
  }
});

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name === "mySidepanel") {
    sidePanelOpen = true;

    port.onDisconnect.addListener(() => {
      sidePanelOpen = false;
      currentSelectedText = ""; // Clear the selected text when panel is closed
    });
  }
});

async function sendToGPT(messages) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["provider", "model", "openaiApiKey", "anthropicApiKey", "localUrl"], async function (result) {
      const provider = result.provider || "openai";
      const model = result.model || "gpt-4o-mini";
      const apiKey = provider === "anthropic" ? result.anthropicApiKey : result.openaiApiKey;
      const localUrl = result.localUrl;

      let streamHandler;
      if (provider === "local") {
        streamHandler = handleLocalStream;
      } else if (provider === "anthropic") {
        streamHandler = handleAnthropicStream;
      } else {
        streamHandler = handleOpenAIStream;
      }

      try {
        const response = await streamHandler(messages, model, apiKey, localUrl);
        chrome.runtime.sendMessage({ action: "streamEnd" });
        resolve(response);
      } catch (error) {
        chrome.runtime.sendMessage({ action: "error", error: error.message });
        reject(error);
      }
    });
  });
}

// Update the stream handlers to accept the new messages format
async function handleLocalStream(messages, model, _, localUrl) {
  try {
    const response = await fetch(localUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model,
        messages: messages,
      }),
    });

    if (response.status === 403) {
      const errorMessage =
        "Received a 403 error from the local model. This is likely due to CORS restrictions. Please run Ollama with the following command:\n\n" +
        "OLLAMA_ORIGINS=http://localhost,chrome-extension://* ollama serve\n\n" +
        "This allows the extension to communicate with your local Ollama instance.";
      chrome.runtime.sendMessage({ action: "streamResponse", content: errorMessage });
      chrome.runtime.sendMessage({ action: "streamEnd" });
      return errorMessage;
    }

    const reader = response.body.getReader();
    let fullResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = new TextDecoder().decode(value);
      const lines = chunk.split("\n").filter((line) => line.trim() !== "");

      for (const line of lines) {
        const parsedLine = JSON.parse(line);
        if (!parsedLine.done) {
          const content = parsedLine.message.content;
          fullResponse += content;
          chrome.runtime.sendMessage({ action: "streamResponse", content });
        }
      }
    }

    return fullResponse;
  } catch (error) {
    const errorMessage =
      "An error occurred while communicating with the local model: " +
      error.message +
      "\n\n Make sure the model is running and the URL is correct.";
    chrome.runtime.sendMessage({ action: "streamResponse", content: errorMessage });
    chrome.runtime.sendMessage({ action: "streamEnd" });
    return errorMessage;
  }
}

function formatAnthropicMessages(messages) {
  // Extract system message if present
  const systemMessage = messages.find((msg) => msg.role === "system");
  let userMessages = messages.filter((msg) => msg.role !== "system");

  // Combine consecutive messages of the same role
  let formattedMessages = [];
  let currentMessage = { role: "", content: "" };

  for (let i = 0; i < userMessages.length; i++) {
    if (currentMessage.role === userMessages[i].role) {
      currentMessage.content += "\n\n" + userMessages[i].content;
    } else {
      if (currentMessage.role) {
        formattedMessages.push(currentMessage);
      }
      currentMessage = { ...userMessages[i] };
    }
  }

  if (currentMessage.role) {
    formattedMessages.push(currentMessage);
  }

  // ensure first message is user. drop if not.
  if (formattedMessages[0].role !== "user") {
    formattedMessages = formattedMessages.slice(1);
  }

  return { systemMessage, formattedMessages };
}

async function handleAnthropicStream(messages, model, apiKey) {
  let modelName = model;
  if (model == "claude-3.5-sonnet") {
    modelName = "claude-3-5-sonnet-20240620";
  } else if (model == "claude-3-opus") {
    modelName = "claude-3-opus-20240229";
  }

  const { systemMessage, formattedMessages } = formatAnthropicMessages(messages);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: 4096,
      system: systemMessage?.content,
      messages: formattedMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Anthropic API error: ${errorData.error.message}`);
  }

  const reader = response.body.getReader();
  let fullResponse = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = new TextDecoder().decode(value);
    const lines = chunk.split("\n").filter((line) => line.trim() !== "");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        if (data.type === "content_block_delta" && data.delta && data.delta.text) {
          fullResponse += data.delta.text;
          chrome.runtime.sendMessage({ action: "streamResponse", content: data.delta.text });
        }
      }
    }
  }

  return fullResponse;
}

async function handleOpenAIStream(messages, model, apiKey) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      stream: true,
    }),
  });

  const reader = response.body.getReader();
  let fullResponse = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += new TextDecoder().decode(value);
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data.trim() === "[DONE]") {
          chrome.runtime.sendMessage({ action: "streamEnd" });
          return fullResponse;
        }
        try {
          const parsedData = JSON.parse(data);
          if (parsedData.choices && parsedData.choices[0].delta && parsedData.choices[0].delta.content) {
            const content = parsedData.choices[0].delta.content;
            fullResponse += content;
            chrome.runtime.sendMessage({ action: "streamResponse", content });
          }
        } catch (error) {
          console.warn("Error parsing JSON:", error, "Raw data:", data);
          // Continue processing other lines
        }
      }
    }
  }

  chrome.runtime.sendMessage({ action: "streamEnd" });
  return fullResponse;
}

chrome.runtime.onInstalled.addListener(() => {});

function getCurrentTabUrl(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0]) {
      callback(tabs[0].url);
    } else {
      callback(null);
    }
  });
}
