# Transcript Helper

Obsidian Web Clipper CN · Transcript 的本地字幕生成助手。它只监听 `127.0.0.1:8484`，负责下载 Bilibili/YouTube 音轨，并调用 BCut 在线 ASR 或 Faster Whisper、OpenAI Whisper、MLX Whisper 本地 ASR。

## 安装与启动

```bash
uv sync --python 3.11
uv run transcript-helper
```

这里的 Python 3.11 是由 `uv` 管理的隔离运行时，不要求系统预装 Python 3.11，也不会替换用户已有的 Python 3.12、3.13 或更高版本。

YouTube 的完整格式解析还需要本机安装 Node.js。模型和 transcript 缓存默认位于 `~/.cache/obsidian-web-clipper-cn-transcript/`；任务音频及 Cookies 使用临时文件，任务结束后清理。

## 隐私边界

- 三种本地 Whisper 模式都不上传音频。
- BCut 模式会把音频上传至必剪接口。
- Helper 不持久化 Cookies，也不会在健康状态或日志中返回 Cookies。

## 本地引擎

- `faster-whisper`：CPU / INT8，旧模型目录和默认设置保持不变。
- `openai-whisper`：OpenAI 官方 Python 实现，CPU / FP32。
- `mlx-whisper`：Apple 芯片 Mac 的 GPU 实现；Intel Mac 或 Rosetta x86_64 Python 不支持。

`uv sync` 会安装前两种引擎，在 macOS arm64 上同时安装 MLX。三种引擎的模型分别下载，不能共用文件。OpenAI 与 MLX 通过 PyAV 解码成单声道 16 kHz 数组，不依赖外部 ffmpeg。OpenAI 的下载使用公开加载 API 验证权重，因此大模型下载阶段也需要加载模型的内存。

模型 API 在原有路径上增加 `provider` 查询参数，省略时仍为 `faster-whisper`：

```text
POST   /v1/models/tiny/download?provider=mlx-whisper
GET    /v1/models/tiny/status?provider=mlx-whisper
DELETE /v1/models/tiny?provider=mlx-whisper
```

转写请求的 `provider` 可为 `bcut`、`faster-whisper`、`openai-whisper`、`mlx-whisper`。新引擎仍使用 `whisperModel` 字段；结果包含 `source`、`language`、`fullText` 和带起止时间的 `segments`。缺少引擎或模型时返回 409，不自动切换其他引擎。

验证：

```bash
uv sync --python 3.11 --group dev
uv run --group dev python -m unittest discover -s tests -v
```

自动化测试使用临时目录和模拟识别器，不读取真实 Cookies、不安装 Native Host、不下载模型。真实模型验证需要另外下载对应权重。
