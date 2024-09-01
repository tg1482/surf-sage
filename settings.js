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
    const availableModels = currentProvider === "local" ? chrome.storage.local.get("localModels") || models.local : models[currentProvider];
    availableModels.forEach((model) => {
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
    if (newModel && !models.local.includes(newModel)) {
      models.local.push(newModel);
      loadModels();
      localModelInput.value = "";
      chrome.storage.local.set({ localModels: models.local });
    }
  });

  saveButton.addEventListener("click", function () {
    // Update this part to use currentProvider instead of providerSelect.value
    chrome.storage.local.set(
      {
        provider: currentProvider,
        model: settingsModelSelect.value,
        apiKey: apiKeyInput.value,
        localUrl: localUrlInput.value,
        localModels: models.local,
      },
      function () {
        updateConfiguredModels().then((modelsAvailable) => {
          if (!modelsAvailable) {
            openSettings();
          }
        });
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
    currentProvider = result.provider || "openai";
    providerTabs.forEach((tab) => {
      if (tab.dataset.provider === currentProvider) {
        tab.classList.add("active");
      } else {
        tab.classList.remove("active");
      }
    });
    toggleInputs(currentProvider);

    if (result.localModels) {
      models.local = result.localModels;
    }
    loadModels();

    settingsModelSelect.value = result.model || defaults[currentProvider].model;
    apiKeyInput.value = result.apiKey || defaults[currentProvider].apiKey || "";
    localUrlInput.value = result.localUrl || defaults.local.localUrl;

    updateConfiguredModels().then((modelsAvailable) => {
      if (!modelsAvailable) {
        openSettings();
      }
    });
  });

  return { updateConfiguredModels, openSettings };
}

export { initializeSettings };
