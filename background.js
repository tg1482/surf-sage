chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "_execute_action") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.sidePanel.open({ tabId: tabs[0].id });
      }
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getSelectedText") {
    chrome.tabs.sendMessage(sender.tab.id, { action: "getSelectedText" }, (response) => {
      sendResponse(response);
    });
    return true;
  } else if (request.action === "sendToGPT") {
    // Implement API call to OpenAI or other provider here
    // This is a placeholder function
    sendToGPT(request.message).then((response) => {
      sendResponse(response);
    });
    return true;
  }
});

async function sendToGPT(message) {
  // Implement your API call here
  // This is a placeholder implementation
  return { response: "This is a placeholder response from GPT." };
}
