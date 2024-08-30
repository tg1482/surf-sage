document.addEventListener("DOMContentLoaded", function () {
  const providerSelect = document.getElementById("provider-select");
  const modelGroup = document.getElementById("model-group");
  const modelSelect = document.getElementById("model-select");
  const localModelGroup = document.getElementById("local-model-group");
  const localModelInput = document.getElementById("local-model-input");
  const addLocalModelButton = document.getElementById("add-local-model");
  const apiKeyGroup = document.getElementById("api-key-group");
  const apiKeyInput = document.getElementById("api-key-input");
  const localUrlGroup = document.getElementById("local-url-group");
  const localUrlInput = document.getElementById("local-url-input");
  const saveButton = document.getElementById("save-button");

  const models = {
    openai: ["gpt-4o", "gpt-4o-mini"],
    anthropic: ["claude-3.5-sonnet", "claude-3.5-haiku"],
    local: ["llama3.1"],
  };

  const defaults = {
    openai: {
      model: "gpt-4o-mini",
      apiKey: "",
    },
    anthropic: {
      model: "claude-3.5-sonnet",
      apiKey: "",
    },
    local: {
      model: "llama3.1",
      localUrl: "http://localhost:11434/api/chat",
    },
  };

  function loadModels() {
    const provider = providerSelect.value;
    modelSelect.innerHTML = "";
    models[provider].forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
    });
  }

  function toggleInputs(provider) {
    if (provider === "local") {
      apiKeyGroup.style.display = "none";
      localUrlGroup.style.display = "block";
      localModelGroup.style.display = "block";
    } else {
      apiKeyGroup.style.display = "block";
      localUrlGroup.style.display = "none";
      localModelGroup.style.display = "none";
    }
  }

  providerSelect.addEventListener("change", function () {
    toggleInputs(this.value);
    loadModels();
  });

  addLocalModelButton.addEventListener("click", function () {
    const newModel = localModelInput.value.trim();
    if (newModel && !models.local.includes(newModel)) {
      models.local.push(newModel);
      loadModels();
      localModelInput.value = "";
      chrome.storage.local.set({ localModels: models.local });
    }
  });

  saveButton.addEventListener("click", function () {
    const provider = providerSelect.value;
    const model = modelSelect.value;
    const apiKey = apiKeyInput.value;
    const localUrl = localUrlInput.value;

    chrome.storage.local.set(
      {
        provider: provider,
        model: model,
        apiKey: apiKey,
        localUrl: localUrl,
        localModels: models.local,
      },
      function () {
        showSavedMessage();
      }
    );
  });

  function showSavedMessage() {
    saveButton.textContent = "Saved!";
    saveButton.disabled = true;
    setTimeout(() => {
      saveButton.textContent = "Save Settings";
      saveButton.disabled = false;
    }, 2000);
  }

  // Load saved preferences
  chrome.storage.local.get(["provider", "model", "apiKey", "localUrl", "localModels"], function (result) {
    const provider = result.provider || "openai";
    providerSelect.value = provider;
    toggleInputs(provider);

    if (result.localModels) {
      models.local = result.localModels;
    }
    loadModels();

    modelSelect.value = result.model || defaults[provider].model;
    apiKeyInput.value = result.apiKey || defaults[provider].apiKey || "";
    localUrlInput.value = result.localUrl || defaults.local.localUrl;
  });
});
