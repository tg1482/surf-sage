// content.js
let sidePanel = null;

// Function to get the main content of the page
function getPageContent() {
  // This is a simple implementation. You might need to adjust this based on the structure of the websites you're targeting.
  let content = document.body.innerText;
  console.log("Page content:", content);
  return content;
}

// Function to get the highlighted text
function getHighlightedText() {
  return window.getSelection().toString();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "openSidePanel") {
    if (!sidePanel) {
      createSidePanel();
    }
    toggleSidePanel();
  } else if (request.action === "getSelectedText") {
    sendResponse({ selectedText: getHighlightedText() });
  } else if (request.action === "getPageContent") {
    sendResponse({ pageContent: getPageContent() });
  }
  return true;
});

function createSidePanel() {
  sidePanel = document.createElement("div");
  sidePanel.id = "gpt-side-panel";
  sidePanel.style.cssText = `
    position: fixed;
    top: 0;
    right: -400px;
    width: 400px;
    height: 100%;
    background-color: white;
    box-shadow: -2px 0 5px rgba(0,0,0,0.2);
    transition: right 0.3s;
    z-index: 9999;
  `;

  const iframe = document.createElement("iframe");
  iframe.style.cssText = `
    width: 100%;
    height: 100%;
    border: none;
  `;
  iframe.src = chrome.runtime.getURL("sidepanel.html");

  sidePanel.appendChild(iframe);
  document.body.appendChild(sidePanel);
}

function toggleSidePanel() {
  if (sidePanel.style.right === "0px") {
    sidePanel.style.right = "-400px";
  } else {
    sidePanel.style.right = "0px";
    const selectedText = getHighlightedText();
    if (selectedText) {
      sidePanel.querySelector("iframe").contentWindow.postMessage(
        {
          type: "selectedText",
          text: selectedText,
        },
        "*"
      );
    }
  }
}

// Print page content to console when the script loads
console.log("Page content:", getPageContent());
