# Transcript Helper

Obsidian Web Clipper CN · Transcript 的本地字幕生成助手。它只监听 `127.0.0.1:8484`，负责下载 Bilibili/YouTube 音轨，并调用 BCut 在线 ASR 或 Faster Whisper 本地 ASR。

## 安装与启动

```bash
uv sync --python 3.11
uv run clip-note-helper
```

这里的 Python 3.11 是由 `uv` 管理的隔离运行时，不要求系统预装 Python 3.11，也不会替换用户已有的 Python 3.12、3.13 或更高版本。

YouTube 的完整格式解析还需要本机安装 Node.js。模型和 transcript 缓存默认位于 `~/.cache/clip-note/`；任务音频及 Cookies 使用临时文件，任务结束后清理。

## 隐私边界

- Faster Whisper 模式不上传音频。
- BCut 模式会把音频上传至必剪接口。
- Helper 不持久化 Cookies，也不会在健康状态或日志中返回 Cookies。
