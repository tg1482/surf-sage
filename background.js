// background.js
let sidePanelOpen = false;

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle_side_panel") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        if (sidePanelOpen) {
          chrome.runtime.sendMessage({ action: "closeSidebar" });
          sidePanelOpen = false;
        } else {
          chrome.sidePanel.open({ tabId: tabs[0].id });
          sidePanelOpen = true;
        }
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

chrome.runtime.onInstalled.addListener(() => {
  console.log("GPT Chat Assistant installed or updated");
});

chrome.commands.onCommand.addListener((command) => {
  console.log("Command received:", command);
});
