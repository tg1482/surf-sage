// background.js
let sidePanelOpen = false;
let currentSelectedText = "";

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
    sendToGPT(request.message)
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

async function sendToGPT(message) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["provider", "model", "apiKey", "localUrl"], async function (result) {
      const provider = result.provider || "openai";
      const model = result.model || "gpt-4o-mini";
      const apiKey = result.apiKey;
      const localUrl = result.localUrl;

      if (provider === "local") {
        try {
          const response = await fetch(localUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: model,
              messages: [{ role: "user", content: message }],
            }),
          });
          const data = await response.json();
          resolve(data.response);
        } catch (error) {
          reject(error);
        }
      } else {
        const apiUrl = provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://api.anthropic.com/v1/complete";

        try {
          const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: model,
              messages: [{ role: "user", content: message }],
            }),
          });
          const data = await response.json();
          resolve(data.choices[0].message.content);
        } catch (error) {
          reject(error);
        }
      }
    });
  });
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
