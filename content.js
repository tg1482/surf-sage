let sidePanel = null;

function getPageContent() {
  let content = document.body.innerText;
  return content;
}

function getHighlightedText() {
  return window.getSelection().toString();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getSelectedText") {
    sendResponse({ selectedText: getHighlightedText() });
  } else if (request.action === "getPageContent") {
    sendResponse({ pageContent: getPageContent() });
  }
  return true;
});

console.log("Page content:", getPageContent());
