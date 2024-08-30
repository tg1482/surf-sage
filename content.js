let sidePanel = null;
let previousSelectedText = "";

function getPageContent() {
  let content = document.body.innerText;
  return content;
}

function getHighlightedText() {
  return window.getSelection().toString();
}

function getPageContentAndSelection() {
  const fullContent = document.body.innerText;
  const selectedText = window.getSelection().toString();

  let pageContent = fullContent;

  if (fullContent.length > 2000) {
    const selectionStart = fullContent.indexOf(selectedText);
    if (selectionStart !== -1) {
      const start = Math.max(0, selectionStart - 1000);
      const end = Math.min(fullContent.length, selectionStart + selectedText.length + 1000);
      pageContent = fullContent.substring(start, end);
    } else {
      // If no selection or selection not found, take the first 2000 characters
      pageContent = fullContent.substring(0, 2000);
    }
  }

  return { pageContent, selectedText };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getSelectedText") {
    sendResponse({ selectedText: window.getSelection().toString() });
  } else if (request.action === "getPageContent") {
    sendResponse({ pageContent: document.body.innerText });
  } else if (request.action === "getPageContentAndSelection") {
    sendResponse(getPageContentAndSelection());
  }
  return true;
});

function checkSelection() {
  const selectedText = window.getSelection().toString().trim();
  if (selectedText !== previousSelectedText) {
    previousSelectedText = selectedText;
    chrome.runtime.sendMessage({
      action: "updateSelectedText",
      selectedText: selectedText,
    });
  }
}

// Check selection every 500ms
setInterval(checkSelection, 500);

console.log("Content script loaded");
