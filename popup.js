document.addEventListener("DOMContentLoaded", function () {
  const modelSelect = document.getElementById("model-select");
  const apiKeyGroup = document.getElementById("api-key-group");
  const apiKeyInput = document.getElementById("api-key-input");
  const localUrlGroup = document.getElementById("local-url-group");
  const localUrlInput = document.getElementById("local-url-input");
  const saveButton = document.getElementById("save-button");

  // Load saved preferences
  chrome.storage.local.get(["model", "apiKey", "localUrl"], function (result) {
    if (result.model) {
      modelSelect.value = result.model;
      toggleInputs(result.model);
    }
    if (result.apiKey) {
      apiKeyInput.value = result.apiKey;
    }
    if (result.localUrl) {
      localUrlInput.value = result.localUrl;
    }
  });

  modelSelect.addEventListener("change", function () {
    toggleInputs(this.value);
  });

  saveButton.addEventListener("click", function () {
    const model = modelSelect.value;
    const apiKey = apiKeyInput.value;
    const localUrl = localUrlInput.value;

    chrome.storage.local.set(
      {
        model: model,
        apiKey: apiKey,
        localUrl: localUrl,
      },
      function () {
        showSavedMessage();
      }
    );
  });

  function toggleInputs(model) {
    if (model === "local") {
      apiKeyGroup.style.display = "none";
      localUrlGroup.style.display = "block";
    } else {
      apiKeyGroup.style.display = "block";
      localUrlGroup.style.display = "none";
    }
  }

  function showSavedMessage() {
    saveButton.textContent = "Saved!";
    saveButton.disabled = true;
    setTimeout(() => {
      saveButton.textContent = "Save Settings";
      saveButton.disabled = false;
    }, 2000);
  }
});
