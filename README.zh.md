# TapGloss

[English](README.md) | 中文

TapGloss 是一个 Obsidian 插件，选中词/句即可快速查询或翻译（OpenAI-compatible 接口）。
我在学习 Leo 老师的[新概念英语](https://www.bilibili.com/video/BV1cu411r7pw)时，经常遇到生词与不太确定的造句，于是做了这个插件来进行释义、翻译与纠错。

![demo](docs/demo.gif)

## 安装

1. 将 `manifest.json` 和 `main.js` 复制到 `.obsidian/plugins/tapgloss/`。
2. 在 Obsidian 设置中启用插件。

## 构建

```bash
npm install
npm run build
```

## 设置

- `API Base URL` / `API Key` / `Model ID`
- `Language`：影响恢复默认提示词时使用的语言
- `Word Prompt` / `Sentence Prompt`：可编辑 + 恢复默认
- `Sentence length threshold`：默认 28
- `Canvas path`：默认 `tricky-words.canvas`
- `图标文本/大小` 与 `气泡颜色` 可用于基础主题配置

## 使用

- 在编辑器或 PDF 中选中文本，会出现 🤔 图标。
- 点击 🤔 触发 Smart Lookup。
- Commands（可绑定快捷键）：
  - `Smart Lookup`
  - `Translate Selection`
- 气泡中点击 `Add to Canvas` 可将卡片追加到指定 canvas。

## 说明

- 只有点击图标/命令才会请求，不会自动请求。
- 同一 selection + mode 会命中内存缓存。
