let sidePanel = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "openSidePanel") {
    if (!sidePanel) {
      createSidePanel();
    }
    toggleSidePanel();
  }
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
  iframe.src = chrome.runtime.getURL("chat.html");

  sidePanel.appendChild(iframe);
  document.body.appendChild(sidePanel);
}

function toggleSidePanel() {
  if (sidePanel.style.right === "0px") {
    sidePanel.style.right = "-400px";
  } else {
    sidePanel.style.right = "0px";
    const selectedText = window.getSelection().toString();
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
