# TapGloss

[中文](README.zh.md) | English

TapGloss is an Obsidian plugin for instant word/sentence lookup and translation with an OpenAI-compatible LLM.
I built it while studying Leo's New Concept English course, where I kept running into unfamiliar words and sentences I wasn't confident about.

![demo](docs/demo.gif)

## Install

1. Copy `manifest.json` and `main.js` into `.obsidian/plugins/tapgloss/`.
2. Enable the plugin in Obsidian settings.

## Build

```bash
npm install
npm run build
```

## Settings

- `API Base URL`, `API Key`, `Model ID`
- `Language`: affects default prompts when you restore defaults.
- `Word Prompt` / `Sentence Prompt`: editable + restore defaults
- `Sentence length threshold`: default 28
- `Canvas path`: default `tricky-words.canvas`
- `Icon text`, `Icon size`, and popover colors for basic theming

## Usage

- Select text in the editor (or PDF) to show the `🤔` icon.
- Click the icon to run Smart Lookup.
- Commands (bindable to hotkeys):
  - `Smart Lookup`
  - `Translate Selection`
- Use `Add to Canvas` to save a card to the configured canvas file.

## Notes

- Requests are only triggered on click or command (not on selection change).
- The plugin keeps a session cache for identical selections + mode.
