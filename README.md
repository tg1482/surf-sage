# Surf Sage

![Surf Sage Demo](media/demo.gif)

Chrome Store link - https://chromewebstore.google.com/detail/surf-sage/aggdohljbidlnppellddmijmndffmiad

## Overview

Surf Sage is a Chrome extension that integrates GPT-based AI models directly into your browsing experience, providing intelligent assistance and enhancing your web surfing capabilities.

## Features

- Seamless integration with OpenAI's GPT models and Anthropic's Claude
- Side panel for easy access to AI chat functionality
- Context-aware responses based on the current webpage content
- Support for multiple chat sessions
- Customizable settings for API keys and model selection
- Keyboard shortcuts for quick access to features
- Markdown rendering for formatted AI responses
- Code syntax highlighting and copy functionality

## Usage

1. Click on the Surf Sage icon or use the keyboard shortcut (Ctrl+L) to open the side panel
2. Enter your API key in the settings (gear icon)
3. Start a new chat or continue an existing one
4. Type your query or highlight text on the webpage to get AI assistance
5. Use the model selector to switch between different AI models

## Keyboard Shortcuts

- Ctrl+L: Toggle GPT Chat Side Panel
- Ctrl+M: Toggle GPT Model
- Ctrl+B: Toggle Chat History Sidebar
- Ctrl+N: Create a new chat

## Development

To set up the project for development:

1. Clone the repository
2. Install dependencies (if any)
3. Load the extension in Chrome:
   - Go to chrome://extensions/
   - Enable "Developer mode"
   - Click "Load unpacked" and select the project directory

## Project Structure

- `content.js`: Handles interaction with the webpage content
- `background.js`: Manages background processes and communication
- `sidepanel.js`: Controls the side panel UI and functionality
- `settings.js`: Manages user settings and preferences
- `styles.css`: Contains all the styling for the extension
- `manifest.json`: Defines the extension structure and permissions

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.

## Acknowledgements

- Marked.js for Markdown rendering
- TurndownService for HTML to Markdown conversion
