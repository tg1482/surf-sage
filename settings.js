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

function initializeSettings() {
  const providerSelect = document.getElementById("provider-select");
  const settingsModelSelect = document.getElementById("settings-model-select");
  const localModelGroup = document.getElementById("local-model-group");
  const localModelInput = document.getElementById("local-model-input");
  const addLocalModelButton = document.getElementById("add-local-model");
  const apiKeyGroup = document.getElementById("api-key-group");
  const apiKeyInput = document.getElementById("api-key-input");
  const localUrlGroup = document.getElementById("local-url-group");
  const localUrlInput = document.getElementById("local-url-input");
  const saveButton = document.getElementById("save-button");
  const settingsButton = document.getElementById("settings-button");
  const settingsModal = document.getElementById("settings-modal");
  const closeSettings = document.getElementById("close-settings");

  function loadModels() {
    const provider = providerSelect.value;
    settingsModelSelect.innerHTML = "";
    models[provider].forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      settingsModelSelect.appendChild(option);
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

  function updateConfiguredModels() {
    const modelSelect = document.getElementById("model-select");
    modelSelect.innerHTML = "";
    chrome.storage.local.get(["provider", "model", "apiKey", "localUrl", "localModels"], (result) => {
      const provider = result.provider || "openai";
      const model = result.model || defaults[provider].model;
      const apiKey = result.apiKey || defaults[provider].apiKey || "";
      const localUrl = result.localUrl || defaults.local.localUrl;
      const localModels = result.localModels || models.local;

      if ((provider === "openai" || provider === "anthropic") && apiKey) {
        models[provider].forEach((m) => {
          const option = document.createElement("option");
          option.value = m;
          option.textContent = `${provider}: ${m}`;
          modelSelect.appendChild(option);
        });
      }

      if (provider === "local" && localUrl) {
        localModels.forEach((m) => {
          const option = document.createElement("option");
          option.value = m;
          option.textContent = `local: ${m}`;
          modelSelect.appendChild(option);
        });
      }

      if (modelSelect.options.length > 0) {
        modelSelect.value = model;
      } else {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No models available";
        modelSelect.appendChild(option);
      }

      console.log(
        "Available models:",
        Array.from(modelSelect.options).map((opt) => opt.value)
      );
    });
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
    const model = settingsModelSelect.value;
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
        updateConfiguredModels();
        settingsModal.style.display = "none";
      }
    );
  });

  settingsButton.addEventListener("click", () => {
    settingsModal.style.display = "block";
  });

  closeSettings.addEventListener("click", () => {
    settingsModal.style.display = "none";
  });

  // Load saved preferences
  chrome.storage.local.get(["provider", "model", "apiKey", "localUrl", "localModels"], function (result) {
    const provider = result.provider || "openai";
    providerSelect.value = provider;
    toggleInputs(provider);

    if (result.localModels) {
      models.local = result.localModels;
    }
    loadModels();

    settingsModelSelect.value = result.model || defaults[provider].model;
    apiKeyInput.value = result.apiKey || defaults[provider].apiKey || "";
    localUrlInput.value = result.localUrl || defaults.local.localUrl;

    updateConfiguredModels();
  });

  return { updateConfiguredModels };
}

export { initializeSettings };
