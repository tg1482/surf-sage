import { models, defaults, defaultProvider } from "./config.js";

function initializeSettings() {
  const providerTabs = document.querySelectorAll(".provider-tab");
  let currentProvider = "openai";

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
    settingsModelSelect.innerHTML = "";
    chrome.storage.local.get("localModels", (result) => {
      const availableModels = currentProvider === "local" ? result.localModels || models.local : models[currentProvider];
      availableModels.forEach((model) => {
        const option = document.createElement("option");
        option.value = model;
        option.textContent = model;
        settingsModelSelect.appendChild(option);
      });
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

    // Load the appropriate API key
    chrome.storage.local.get(["openaiApiKey", "anthropicApiKey", "apiKey"], (result) => {
      // Debugging line
      if (provider === "openai") {
        apiKeyInput.value = result.openaiApiKey || result.apiKey || "";
      } else if (provider === "anthropic") {
        apiKeyInput.value = result.anthropicApiKey || "";
      }
      // Debugging line
    });
  }

  providerTabs.forEach((tab) => {
    tab.addEventListener("click", function () {
      providerTabs.forEach((t) => t.classList.remove("active"));
      this.classList.add("active");
      currentProvider = this.dataset.provider;
      toggleInputs(currentProvider);
      loadModels();
    });
  });

  function updateConfiguredModels() {
    const modelSelect = document.getElementById("model-select");
    modelSelect.innerHTML = "";
    return new Promise((resolve) => {
      chrome.storage.local.get(["provider", "model", "openaiApiKey", "anthropicApiKey", "localUrl", "localModels"], (result) => {
        const currentProvider = result.provider || defaultProvider;
        const currentModel = result.model || defaults[currentProvider].model;
        const localModels = result.localModels || models.local;

        let availableModels = [];

        if (result.openaiApiKey) {
          availableModels = availableModels.concat(models.openai.map((model) => ({ provider: "openai", model })));
        }
        if (result.anthropicApiKey) {
          availableModels = availableModels.concat(models.anthropic.map((model) => ({ provider: "anthropic", model })));
        }
        if (result.localUrl) {
          availableModels = availableModels.concat(localModels.map((model) => ({ provider: "local", model })));
        }

        availableModels.forEach(({ provider, model }) => {
          const option = document.createElement("option");
          option.value = JSON.stringify({ provider, model });
          option.textContent = `${provider}: ${model}`;
          modelSelect.appendChild(option);
        });

        // Set the current model
        const currentModelOption = Array.from(modelSelect.options).find((option) => {
          const { provider, model } = JSON.parse(option.value);
          return provider === currentProvider && model === currentModel;
        });

        if (currentModelOption) {
          modelSelect.value = currentModelOption.value;
        }

        const modelsAvailable = modelSelect.options.length > 0;
        resolve(modelsAvailable);
      });
    });
  }

  function openSettings() {
    settingsModal.style.display = "block";
  }

  addLocalModelButton.addEventListener("click", function () {
    const newModel = localModelInput.value.trim();
    if (newModel) {
      chrome.storage.local.get("localModels", (result) => {
        const localModels = result.localModels || models.local;
        if (!localModels.includes(newModel)) {
          localModels.push(newModel);
          chrome.storage.local.set({ localModels: localModels }, () => {
            loadModels();
            localModelInput.value = "";
          });
        }
      });
    }
  });

  saveButton.addEventListener("click", function () {
    const newSettings = {
      provider: currentProvider,
      model: settingsModelSelect.value,
      localUrl: localUrlInput.value,
      localModels: models.local,
    };

    // Save API key for the current provider
    if (currentProvider === "openai") {
      newSettings.openaiApiKey = apiKeyInput.value;
      newSettings.apiKey = apiKeyInput.value; // For backwards compatibility
    } else if (currentProvider === "anthropic") {
      newSettings.anthropicApiKey = apiKeyInput.value;
    }

    // Debugging line

    chrome.storage.local.set(newSettings, function () {
      if (chrome.runtime.lastError) {
        console.error("Error saving settings:", chrome.runtime.lastError);
      } else {
      }
      updateConfiguredModels().then((modelsAvailable) => {
        if (!modelsAvailable) {
          openSettings();
        }
      });
      settingsModal.style.display = "none";
    });
  });

  settingsButton.addEventListener("click", () => {
    settingsModal.style.display = "block";
  });

  closeSettings.addEventListener("click", () => {
    settingsModal.style.display = "none";
  });

  // Load saved preferences
  chrome.storage.local.get(
    ["provider", "model", "openaiApiKey", "anthropicApiKey", "apiKey", "localUrl", "localModels"],
    function (result) {
      // Debugging line
      currentProvider = result.provider || defaultProvider;
      providerTabs.forEach((tab) => {
        if (tab.dataset.provider === currentProvider) {
          tab.classList.add("active");
        } else {
          tab.classList.remove("active");
        }
      });

      // Set API key based on the current provider
      if (currentProvider === "openai") {
        apiKeyInput.value = result.openaiApiKey || result.apiKey || "";
      } else if (currentProvider === "anthropic") {
        apiKeyInput.value = result.anthropicApiKey || "";
      }
      // Debugging line

      toggleInputs(currentProvider);

      if (result.localModels) {
        models.local = result.localModels;
      } else {
        // Initialize localModels if not present
        chrome.storage.local.set({ localModels: models.local });
      }
      loadModels();

      settingsModelSelect.value = result.model || defaults[currentProvider].model;

      localUrlInput.value = result.localUrl || defaults.local.localUrl;

      updateConfiguredModels().then((modelsAvailable) => {
        if (!modelsAvailable) {
          openSettings();
        }
      });
    }
  );

  return { updateConfiguredModels, openSettings };
}

export { initializeSettings };
