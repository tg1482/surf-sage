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
  const fullContent = document.body.innerHTML;
  const selectedText = window.getSelection().toString();

  // Convert HTML to Markdown
  const turndownService = new TurndownService();
  const markdownContent = turndownService.turndown(fullContent);
  const markdownSelection = turndownService.turndown(selectedText);

  // Extend context to 10,000 words above and below the selection
  const words = markdownContent.split(/\s+/);
  const selectionStart = words.indexOf(markdownSelection.split(/\s+/)[0]);
  const contextStart = Math.max(0, selectionStart - 10000);
  const contextEnd = Math.min(words.length, selectionStart + markdownSelection.split(/\s+/).length + 10000);
  const contextContent = words.slice(contextStart, contextEnd).join(" ");

  return {
    pageContent: contextContent,
    selectedText: markdownSelection,
  };
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

function cleanSelectedText(text) {
  return text
    .trim()
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function checkSelection() {
  const selectedText = window.getSelection().toString().trim();
  if (selectedText !== previousSelectedText) {
    previousSelectedText = selectedText;
    const cleanedText = cleanSelectedText(selectedText);
    chrome.runtime.sendMessage({
      action: "updateSelectedText",
      selectedText: cleanedText,
    });
  }
}

// Check selection every 500ms
setInterval(checkSelection, 500);

console.log("Content script loaded");
