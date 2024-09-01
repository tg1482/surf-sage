import { models, defaults, defaultProvider } from "./config.js";

// background.js
let sidePanelOpen = false;
let currentSelectedText = "";
let currentModelIndex = 0;

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
    console.log("Side panel opened");
    sidePanelOpen = true;

    port.onDisconnect.addListener(() => {
      console.log("Side panel closed");
      sidePanelOpen = false;
      currentSelectedText = ""; // Clear the selected text when panel is closed
    });
  }
});

async function sendToGPT(messages) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["provider", "model", "apiKey", "localUrl"], async function (result) {
      const provider = result.provider || "openai";
      const model = result.model || "gpt-4o-mini";
      const apiKey = result.apiKey;
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
    console.log(error);
    const errorMessage =
      "An error occurred while communicating with the local model: " +
      error.message +
      "\n\n Make sure the model is running and the URL is correct.";
    chrome.runtime.sendMessage({ action: "streamResponse", content: errorMessage });
    chrome.runtime.sendMessage({ action: "streamEnd" });
    return errorMessage;
  }
}

async function handleAnthropicStream(messages, model, apiKey) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = new TextDecoder().decode(value);
    const lines = chunk.split("\n").filter((line) => line.trim() !== "");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        if (data.delta && data.delta.text) {
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = new TextDecoder().decode(value);
    const lines = chunk.split("\n").filter((line) => line.trim() !== "");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        if (line.includes("[DONE]")) {
          // Stream has ended
          chrome.runtime.sendMessage({ action: "streamEnd" });
          return fullResponse;
        }
        try {
          const data = JSON.parse(line.slice(6));
          if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
            const content = data.choices[0].delta.content;
            fullResponse += content;
            chrome.runtime.sendMessage({ action: "streamResponse", content });
          }
        } catch (error) {
          console.error("Error parsing JSON:", error);
        }
      }
    }
  }

  chrome.runtime.sendMessage({ action: "streamEnd" });
  return fullResponse;
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("GPT Chat Assistant installed or updated");
});

function getCurrentTabUrl(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0]) {
      callback(tabs[0].url);
    } else {
      callback(null);
    }
  });
}

// Modify the toggleModel function in background.js
function toggleModel() {
  chrome.storage.local.get(["provider", "localModels"], (result) => {
    const provider = result.provider || defaultProvider;
    let availableModels = models[provider];

    if (provider === "local" && result.localModels && result.localModels.length > 0) {
      availableModels = result.localModels;
    }

    if (availableModels.length === 0) {
      console.log("No models available for the current provider");
      return;
    }

    currentModelIndex = (currentModelIndex + 1) % availableModels.length;
    const newModel = availableModels[currentModelIndex];

    chrome.storage.local.set({ model: newModel }, () => {
      console.log(`Model switched to: ${newModel}`);
      // Notify the sidepanel about the model change
      chrome.runtime.sendMessage({ action: "modelChanged", model: newModel });
    });
  });
}
