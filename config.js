export const models = {
  openai: ["gpt-4o-mini", "gpt-4o"],
  anthropic: ["claude-3.5-sonnet", "claude-3.5-haiku"],
  local: ["llama3.1"],
};

export const defaults = {
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

export const defaultProvider = "openai";
