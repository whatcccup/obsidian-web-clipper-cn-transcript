> 本文主要记录 v0.3.0 的安装流程。v0.4.0 新增 OpenAI Whisper 与 MLX Whisper：安装菜单先选引擎再选模型；三种引擎分别下载模型。v0.3.x 及更早 Release 不包含新增选项，完整步骤见根目录 README 的“从源码一键安装”和“本地模型目录与升级”。

# Obsidian Web Clipper CN · Transcript：macOS 从零安装与完整验证

> 适用系统：macOS + Chrome/Chromium
> 教程版本：2026-07-28
> 验证基线：Obsidian Web Clipper CN · Transcript `v0.3.0`
> 安装方式：GitHub Release macOS 安装包
> 本地识别：Faster Whisper `tiny`

这份教程只讲 **Obsidian Web Clipper CN · Transcript**，不安装 BiliNote，不使用 DMG，不使用 Docker，也不创建开机自启服务。

目标是在一台普通 Mac 上完成以下闭环：

1. 检查电脑是否已经具备所需环境。
2. 只安装缺少的 Homebrew、Node.js 或 uv。
3. 安装浏览器扩展、按需 Helper 和 Faster Whisper `tiny` 模型。
4. 使用一个没有平台字幕的 YouTube 视频生成带时间戳的 transcript。
5. 验证 `{{transcript}}` 能进入模板并保存到 Obsidian。
6. 掌握日常启动、停止、升级和故障排除方法。

---

## 1. 先理解最终会安装什么

Transcript 由三个部分组成：

```text
Chrome 扩展
    ↓ Native Messaging
一次性 Launcher
    ↓ 按需启动
Transcript Helper（127.0.0.1:8484）
    ↓
yt-dlp 下载音频 + Faster Whisper tiny 本地识别
```

三个部分分别负责：

| 组件 | 作用 | 是否一直运行 |
|---|---|---|
| Chrome 扩展 | 展示剪藏界面、模板、设置和生成按钮 | 随 Chrome 运行 |
| Launcher | 接收扩展的启动、停止、状态命令 | 执行完立即退出 |
| Helper | 下载音频、识别字幕、管理模型和缓存 | 按需启动，空闲 15 分钟后退出 |

安装完成后不会出现一个独立的 Transcript App，也不需要每天在终端启动 Python 服务。

### 1.1 安装位置

本教程以以下稳定位置为例：

```text
~/obsidian-web-clipper-cn-transcript/
```

这里保存 GitHub Release 解压后的扩展文件和安装脚本。它不是强制路径；用户也可以选择其他固定目录。Chrome 会持续读取其中的：

```text
~/obsidian-web-clipper-cn-transcript/extension/dist/
```

Helper 的实际运行副本安装在：

```text
~/Library/Application Support/ObsidianWebClipperCNTranscript/
```

模型和 transcript 缓存保存在：

```text
~/.cache/obsidian-web-clipper-cn-transcript/
```

### 1.2 不会安装什么

本教程不会：

- 安装 BiliNote。
- 使用 DMG。
- 使用 Docker。
- 创建 LaunchAgent。
- 设置开机自动启动。
- 安装独立的系统 Python。
- 安装数据库、RAG、GPT 笔记后台或 PDF 服务。

---

## 2. 开始前的准备

需要准备：

- 一台 macOS 电脑。
- 管理员账户及登录密码。
- Chrome 或 Chromium 浏览器。
- Obsidian 桌面版。
- 稳定网络。
- 建议至少预留 5 GB 磁盘空间。

Faster Whisper `tiny` 模型本身约几十 MB，但安装过程还会保存 Python 运行时、依赖和缓存，所以不要只按模型大小预留空间。

### 2.1 打开终端

最简单的方法：

1. 按 `Command + Space`。
2. 输入“终端”或 `Terminal`。
3. 按回车。

终端最后通常显示 `%`。命令粘贴在 `%` 后面，不要复制 `%` 本身。

### 2.2 认识路径

下面的命令显示当前所在目录：

```bash
pwd
```

下面的命令回到当前用户的主目录：

```bash
cd ~
```

`~` 代表当前用户的主目录。例如用户名是 `whatcccup` 时，`~` 通常代表：

```text
/Users/whatcccup
```

路径中有空格时必须使用引号，例如：

```bash
cd "$HOME/Library/Application Support"
```

### 2.3 确认 Mac 架构

下面的命令检查处理器架构：

```bash
uname -m
```

可能结果：

- `arm64`：Apple Silicon，Homebrew 标准位置是 `/opt/homebrew`。
- `x86_64`：Intel Mac，Homebrew 标准位置是 `/usr/local`。

本教程两种架构都能理解，但后文主要展示当前更常见的 Apple Silicon 路径。

---

## 3. 先检查电脑是否已经满足前置条件

很多 Mac 已经安装过 Homebrew、Node.js 或 uv。先检查，可以避免重复安装。

下面的命令只读取当前状态，不会安装或删除任何内容：

```bash
echo "Architecture: $(uname -m)"

for command_name in brew node npm uv; do
  if command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name: $(command -v "$command_name")"
  else
    echo "$command_name: NOT INSTALLED"
  fi
done

if command -v brew >/dev/null 2>&1; then
  echo "Homebrew prefix: $(brew --prefix)"
fi

if command -v node >/dev/null 2>&1; then
  echo "Node.js version: $(node --version)"
fi

if command -v npm >/dev/null 2>&1; then
  echo "npm version: $(npm --version)"
fi

if command -v uv >/dev/null 2>&1; then
  echo "uv version: $(uv --version)"
fi
```

根据结果选择后续章节：

- `brew`、`node`、`npm`、`uv` 都有路径，且 Node.js 为 `v18` 或更高版本：前置条件已经满足，直接跳到第 6 章下载 Transcript。
- `brew` 显示 `NOT INSTALLED`：继续第 4 章安装 Homebrew。
- Homebrew 已安装，但 `node`、`npm` 或 `uv` 缺失：跳到第 5 章安装前置工具。
- Node.js 低于 `v18`：跳到第 5 章，通过 Homebrew 升级 Node.js。

Apple Silicon 的 Homebrew prefix 应为 `/opt/homebrew`，Intel Mac 通常为 `/usr/local`。如果路径符合架构，就不需要卸载或重新安装 Homebrew。

---

## 4. 安装唯一的一套 Homebrew

### 4.1 安装 Apple Command Line Tools

下面的命令检查命令行工具：

```bash
xcode-select -p
```

如果显示 `/Library/Developer/CommandLineTools` 或 Xcode 内部路径，说明已经安装。

如果提示找不到，执行：

```bash
xcode-select --install
```

在系统弹窗中完成安装，然后重新打开终端。

### 4.2 执行 Homebrew 官方安装命令

下面的命令来自 Homebrew 官方安装器：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

安装期间：

- 终端会说明准备安装到哪里。
- 可能要求输入 Mac 登录密码。
- 输入密码时不会出现圆点或星号，这是正常现象。
- 出现 `Press RETURN/ENTER to continue` 时按回车。

Apple Silicon 正确目标应是：

```text
/opt/homebrew
```

如果安装器准备使用 `$HOME/.homebrew`，先中止并检查之前的环境，不要继续制造第二套 Homebrew。

### 4.3 配置 Apple Silicon PATH

Apple Silicon 用户执行下面这些命令：先确保 macOS 的标准系统命令目录存在于 PATH，再加载 Homebrew。这样当前终端和以后打开的终端都能找到 `bash`、`ls` 和 `brew`：

```bash
echo 'export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"' >> "$HOME/.zprofile"
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
source "$HOME/.zprofile"
rehash
```

Intel Mac 应使用安装器最后显示的 `Next steps`，通常是 `/usr/local/bin/brew`。

### 4.4 验证只有一套 Homebrew

下面的命令检查路径与健康状态：

```bash
command -v brew
brew --prefix
brew --version
type -a brew
brew doctor
```

Apple Silicon 的关键结果应为：

```text
/opt/homebrew/bin/brew
/opt/homebrew
```

`type -a brew` 不应再显示 `$HOME/.homebrew/bin/brew`。

---

## 5. 安装 Transcript 的最少前置工具

Release 安装包已经包含构建完成的 Chrome 扩展，所以普通用户不需要安装 npm 依赖或运行 Webpack。

但 Transcript 仍需要：

- Node.js：帮助 yt-dlp 完整解析 YouTube。
- uv：准备隔离的 Python 3.11 和 Helper 依赖。

用户不需要自己安装 Python。安装脚本会通过 uv 准备项目专用 Python 3.11，不会替换系统 Python。

### 5.1 安装 Node.js 和 uv

下面的命令通过唯一的 Homebrew 安装两项工具：

```bash
brew install node uv
```

### 5.2 验证路径和版本

下面的命令确认 Node.js、npm 和 uv 都来自当前 Homebrew：

```bash
command -v node
node --version
command -v npm
npm --version
command -v uv
uv --version
```

Transcript 要求 Node.js 18 或更高版本。Apple Silicon 的路径通常以 `/opt/homebrew/` 开头。

不需要额外执行：

```text
pip install ...
python -m venv ...
npm install ...
```

这些工作由 Release 安装脚本按项目锁定的方式完成。

---

## 6. 下载 Transcript macOS 安装包

### 6.1 下载正确文件

打开项目 Release 页面：

<https://github.com/whatcccup/obsidian-web-clipper-cn-transcript/releases/tag/v0.3.0>

下载：

```text
obsidian-web-clipper-cn-transcript-v0.3.0-macos.zip
```

不要下载：

```text
obsidian-web-clipper-cn-transcript-v0.3.0-chrome.zip
```

`-chrome.zip` 只有扩展，缺少 Helper 与 Launcher，不能单独生成本地字幕。

### 6.2 解压到稳定目录

可以在 Finder 中双击 ZIP 解压。

解压后会得到：

```text
obsidian-web-clipper-cn-transcript-v0.3.0-macos
```

安装包不强制放在 Home 根目录。桌面、下载文件夹或其他有读写权限的位置都可以，但 Chrome 会持续读取其中的扩展文件，因此应选择一个不会随手删除或移动的固定目录。

不建议放进 `Applications` 文件夹，因为这里通常用于保存应用程序。下面推荐直接放在当前用户的 Home 目录，并统一使用与项目和 GitHub 仓库相同的名称：

```text
~/obsidian-web-clipper-cn-transcript
```

也可以使用下面的终端命令解压：

```bash
cd "$HOME/Downloads"
ditto -x -k \
  obsidian-web-clipper-cn-transcript-v0.3.0-macos.zip \
  "$HOME/Downloads"
```

下面的命令把解压后的文件夹移动到 Home 目录并改名：

```bash
mv \
  "$HOME/Downloads/obsidian-web-clipper-cn-transcript-v0.3.0-macos" \
  "$HOME/obsidian-web-clipper-cn-transcript"
```

Home 目录只是推荐示例，不是强制路径。如果改用其他位置，安装完成后同样不要删除或移动该目录。

从下一节开始，教程使用 `/你的实际保存目录/obsidian-web-clipper-cn-transcript` 作为占位符。执行命令前，必须把它替换成刚才选择的真实路径。可以在 Finder 中选中文件夹，按 `Option + Command + C` 复制完整路径。

---

## 7. 一键安装 Helper，并下载 tiny 模型

### 7.1 运行安装器

下面的命令必须在刚才解压并固定保存的项目目录中执行。请替换成自己的真实路径：

```bash
cd "/你的实际保存目录/obsidian-web-clipper-cn-transcript"
bash install.sh
```

安装脚本会：

1. 检查 Node.js、npm 和 uv。
2. 使用 Release 中已经构建好的 Chrome 扩展。
3. 通过 uv 下载隔离的 Python 3.11。
4. 安装 FastAPI、Uvicorn、yt-dlp、yt-dlp-ejs、Faster Whisper 和 CTranslate2。
5. 注册 Chrome Native Messaging Host。
6. 安装按需 Launcher。
7. 询问是否立即下载 Faster Whisper 模型。

### 7.2 在模型菜单选择 tiny

安装器会显示类似菜单：

```text
1) tiny (recommended; extension default)
2) Skip
3) base
4) small
5) medium
6) large-v3
7) large-v3-turbo
```

第一次验证直接按回车即可；也可以输入：

```text
1
```

然后按回车。

本教程统一使用 `tiny`，因为它：

- 下载最快。
- 占用磁盘和内存最少。
- CPU 识别速度最快。
- 足以验证完整流程。

`tiny` 的识别精度低于更大模型。确认流程成功后，再根据需要切换 `base`、`small` 或更大的模型。

### 7.3 等待安装完成

第一次安装需要下载 Python 和多个依赖，耗时取决于网络。不要在下载过程中关闭终端。

成功时应看到类似输出：

```text
Transcript Helper installed without LaunchAgent.
Faster Whisper model installed: tiny
Obsidian Web Clipper CN · Transcript installation completed.
```

Webpack 体积 warning 只会出现在源码构建路径。Release macOS 安装包已经含有预构建扩展，正常情况下不会重新构建 Webpack。

### 7.4 检查安装结果

下面的命令检查 Helper、模型和 Native Messaging Host：

```bash
ls -la "$HOME/Library/Application Support/ObsidianWebClipperCNTranscript"
ls -la "$HOME/.cache/obsidian-web-clipper-cn-transcript/models/tiny"
ls -l "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/cn.transcript.generator.launcher.json"
```

模型目录中应至少能找到：

```text
model.bin
config.json
```

下面的命令确认没有创建 Transcript LaunchAgent：

```bash
find "$HOME/Library/LaunchAgents" \
  -maxdepth 1 \
  \( -iname '*transcript*' -o -iname '*clip*' \) \
  2>/dev/null
```

正常情况下不应出现 Transcript Generator 的 plist。

---

## 8. 在 Chrome 加载扩展

1. 打开 Chrome。
2. 地址栏输入 `chrome://extensions`。
3. 打开右上角“开发者模式”。
4. 点击“加载未打包的扩展程序”。
5. 在文件选择窗口按 `Command + Shift + G`。
6. 输入下面的路径：

```text
/你的实际保存目录/obsidian-web-clipper-cn-transcript/extension/dist
```

7. 点击“前往”。
8. 选择 `dist` 文件夹。

成功后会出现：

```text
Obsidian Web Clipper CN · Transcript
```

建议点击 Chrome 工具栏的拼图图标，把扩展固定到工具栏。

### 8.1 避免同时启用多个版本

如果 Chrome 里同时存在其他 Web Clipper 或从其他目录加载的同名扩展，先停用重复项。

- Obsidian 官方 Web Clipper。
- Obsidian Web Clipper CN。
- 从另一个目录加载的 Obsidian Web Clipper CN · Transcript。

验证期间只保留当前固定目录中 `extension/dist` 这一份启用，避免点击到错误图标。

---

## 9. 配置 Obsidian Web Clipper

### 9.1 准备 Obsidian

1. 安装并打开 Obsidian。
2. 创建或打开一个 Vault。
3. 确认 Vault 能正常创建笔记。
4. 保持 Obsidian 至少成功打开过一次。

### 9.2 打开扩展设置

在 `chrome://extensions` 中找到 Transcript 扩展，点击“详细信息”，再点击“扩展程序选项”；也可以右键工具栏扩展图标进入设置。

### 9.3 准备验证模板

创建或编辑一个 Web Clipper 模板，正文至少包含：

```markdown
# {{title}}

来源：{{url}}

## Transcript

{{transcript}}
```

必须把 `{{transcript}}` 写进模板正文。变量里有字幕并不代表每个模板都会自动展示字幕。

如果还要让 Interpreter 使用字幕，应在对应提示词或上下文中明确引用 `{{transcript}}`。

---

## 10. 配置 Transcript Generator

在扩展设置侧栏进入：

```text
Transcript Generator
```

### 10.1 基础设置

依次操作：

1. 启用 Transcript Generator。
2. 保持 Helper 地址为默认值 `http://127.0.0.1:8484`。
3. 点击“启动”或“测试连接”。
4. 等待状态显示“已就绪”。

Helper 第一次启动由 Chrome Native Messaging 完成，不需要手动运行 Python。

### 10.2 ASR 设置

选择：

```text
Faster Whisper
```

模型选择：

```text
tiny
```

点击“刷新状态”，应显示 `tiny` 已安装及模型大小。

如果安装阶段跳过了模型，可以在这里点击“下载”。下载完成前不能开始本地字幕任务。

### 10.3 Cookies 设置

第一次验证指定的公开视频时，Bilibili 和 YouTube 都先选择：

```text
不使用
```

这样可以先排除 Cookie 权限和账号状态的影响。

只有遇到登录限制、年龄限制、会员或地区限制时，再选择：

- 自动读取。
- 手动导入 Cookie Header。
- 手动导入 Netscape `cookies.txt`。

自动读取时：

1. 先在当前 Chrome 用户中登录对应网站。
2. 在设置中选择“自动读取”。
3. 点击“读取并验证”。
4. 批准 Chrome Cookies 权限。
5. 确认页面显示成功数量和更新时间。

Cookies 只保存在该扩展的 `chrome.storage.local`，不会写入 transcript 缓存或 Helper 日志。不要把 Cookie 发到课程群、GitHub Issue 或 AI 对话。

---

## 11. 使用没有字幕的 YouTube 视频完成验证

自行选择一个没有平台字幕的 YouTube 视频，用于验证“下载音轨并使用 Faster Whisper 生成 transcript”的完整流程。不要使用教程中的固定链接，因为视频字幕状态和访问策略可能随时变化。

### 11.1 打开视频

1. 使用已安装扩展的 Chrome 打开一个确认没有平台字幕的 YouTube 视频。
2. 等待 YouTube 页面完全加载。
3. 确认地址栏仍是该视频的 `watch?v=...` 地址。

### 11.2 打开剪藏界面

可以使用弹出窗口或嵌入式模式：

- 点击工具栏扩展图标打开弹出窗口。
- 或把 Web Clipper 的打开行为设为“嵌入式”。

两种入口都应显示 Transcript Generator。

如果 Web Clipper 能直接取得平台字幕，就继续使用原生 `{{transcript}}`，不应该强制启动 Helper。

如果没有可用字幕，应出现可展开的 Transcript Generator 面板。

### 11.3 开始生成字幕

展开 Transcript Generator，点击生成按钮。

预期状态顺序为：

```text
正在下载音频
正在本地识别
字幕已生成
```

任务提交后可以关闭弹窗。关闭弹窗不会取消任务；重新打开同一个视频的剪藏界面可以恢复任务状态。扩展图标可能显示 `ASR` 状态提示。

Faster Whisper `tiny` 使用 CPU 和 int8 计算。实际耗时受视频时长、网络和 Mac 性能影响。

### 11.4 验证 transcript 变量

生成完成后检查：

1. Transcript Generator 状态显示“字幕已生成”。
2. Web Clipper 的变量检查器中存在 `transcript`。
3. transcript 包含文字和时间戳。
4. 模板正文的 `{{transcript}}` 已被替换为实际字幕，而不是保留花括号。

如果变量检查器里有字幕，但模板正文没有：

1. 确认当前选中的模板就是刚才编辑的模板。
2. 确认正文使用的是精确拼写 `{{transcript}}`。
3. 切换到另一个模板再切回来，触发重新渲染。
4. 重新打开剪藏界面。

### 11.5 保存到 Obsidian

1. 选择目标 Vault 和文件夹。
2. 点击 Web Clipper 原有的保存按钮。
3. 如果 Chrome 询问是否打开 Obsidian，选择允许。
4. 在 Obsidian 中打开新笔记。

最终笔记应包含：

- 视频标题。
- 视频链接。
- `Transcript` 标题。
- 带时间戳的字幕正文。

这证明 Transcript Generator 没有建立第二套保存流程，而是把结果写回 Web Clipper 原有的 `{{transcript}}`。

---

## 12. 日常如何启动和停止

### 12.1 启动

安装完成后，日常不需要打开终端。

最自然的启动方式：

1. 打开 Chrome 中的 Bilibili 或 YouTube 视频。
2. 打开 Transcript 扩展。
3. 在无字幕视频上点击生成字幕。
4. 扩展通过 Native Messaging 自动启动 Helper。

也可以进入：

```text
扩展设置 → Transcript Generator → 启动
```

### 12.2 停止

主动停止：

```text
扩展设置 → Transcript Generator → 停止
```

不主动停止也可以。Helper 在没有任务和模型下载时，空闲约 15 分钟会自动退出。

任务执行期间不会因为弹窗关闭而停止，也不会因为空闲计时误退。

### 12.3 确认 Helper 是否仍在监听

下面的命令只检查端口：

```bash
lsof -nP -iTCP:8484 -sTCP:LISTEN
```

- 有输出：Helper 正在运行。
- 没有输出：Helper 已停止。

### 12.4 查看日志

Helper 日志位置：

```text
~/Library/Application Support/ObsidianWebClipperCNTranscript/logs/helper.log
```

下面的命令查看最近 100 行日志：

```bash
tail -n 100 \
  "$HOME/Library/Application Support/ObsidianWebClipperCNTranscript/logs/helper.log"
```

日志不应包含完整 Cookies。如果准备把日志发给别人，仍应先检查其中是否出现个人路径、视频地址或其他隐私信息。

---

## 13. 后续升级

本教程使用 Release ZIP，不是 Git clone，因此升级方式是下载新 Release，而不是执行 `git pull`。

升级步骤：

1. 下载最新版 `-macos.zip`。
2. 解压到一个新的临时目录。
3. 进入新版目录。
4. 执行覆盖安装。

下面的命令在新版目录执行覆盖安装：

```bash
cd "/新版安装包的实际目录"
bash install.sh --yes
```

完成后：

1. 打开 `chrome://extensions`。
2. 找到原 Transcript 扩展。
3. 如果 Chrome 仍指向之前解压的版本目录，应把新版安装包放到固定目录，并重新加载其中的 `extension/dist`。
4. 点击“重新加载”。

覆盖安装不会主动删除：

- 浏览器中的 Web Clipper 模板。
- Transcript 设置和 Cookies。
- `~/.cache/obsidian-web-clipper-cn-transcript/models/` 中的模型。
- transcript 缓存。

不要直接使用 Obsidian Web Clipper CN 上游 Release 覆盖当前扩展，否则会移除 Transcript 集成功能。应等待本项目合并并发布对应版本。

---

## 14. 常见故障排除

### 14.1 `brew: command not found`

Apple Silicon 先检查文件是否存在：

```bash
/bin/ls -l /opt/homebrew/bin/brew
```

如果存在，先临时恢复标准系统路径，再加载 Homebrew 环境：

```bash
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
eval "$(/opt/homebrew/bin/brew shellenv)"
rehash
```

为了让以后打开的终端也生效，确认 `.zprofile` 同时包含标准系统路径和 Homebrew 配置：

```bash
/usr/bin/grep -nE 'export PATH|brew shellenv' "$HOME/.zprofile" 2>/dev/null
```

### 14.2 Homebrew 路径与电脑架构不一致

执行：

```bash
type -a brew
command -v brew
brew --prefix
```

Apple Silicon 正常使用 `/opt/homebrew`，Intel Mac 通常使用 `/usr/local`。如果 `brew --prefix` 与电脑架构不一致，先不要继续安装 Transcript；请根据 Homebrew 官方文档修正当前 Homebrew，再重新运行第 3 章的检查。

### 14.3 安装器提示缺少 Node.js 或 uv

检查：

```bash
command -v node
node --version
command -v uv
uv --version
```

如果缺失，通过当前唯一 Homebrew 安装：

```bash
brew install node uv
```

### 14.4 `uv sync` 下载失败

先重新执行一次安装。短暂网络中断不代表环境损坏：

```bash
cd "/你的实际保存目录/obsidian-web-clipper-cn-transcript"
bash install.sh
```

如果确认官方 PyPI 在当前网络持续不可用，可以只为这次安装临时指定镜像：

```bash
cd "/你的实际保存目录/obsidian-web-clipper-cn-transcript"
UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple \
  bash install.sh
```

不要同时修改 Homebrew、npm、PyPI 和 Hugging Face 的所有数据源。先根据错误确认失败发生在哪个环节。

### 14.5 tiny 模型下载失败

模型来自 Hugging Face。先在扩展设置中选择 `tiny` 并点击重试下载。

如果确认是 Hugging Face 连接问题，可以在终端中带临时镜像环境重新运行安装器，并再次选择 `tiny`：

```bash
cd "/你的实际保存目录/obsidian-web-clipper-cn-transcript"
HF_ENDPOINT=https://hf-mirror.com bash install.sh
```

检测到已有 Helper 时，安装器会询问是否覆盖。覆盖程序文件不会删除已有模型和浏览器设置。

### 14.6 Helper 未连接

依次检查：

1. Chrome 当前加载的是固定项目目录中的 `extension/dist`。
2. Native Messaging Host 文件存在。
3. Host 配置中的扩展 ID 与 Chrome 显示的 ID 一致。
4. Helper Python 存在。
5. 查看 `helper.log`。

下面的命令查看 Host 配置：

```bash
cat "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/cn.transcript.generator.launcher.json"
```

下面的命令检查 Helper Python：

```bash
ls -l \
  "$HOME/Library/Application Support/ObsidianWebClipperCNTranscript/helper/.venv/bin/python"
```

下面的命令查看日志：

```bash
tail -n 200 \
  "$HOME/Library/Application Support/ObsidianWebClipperCNTranscript/logs/helper.log"
```

### 14.7 浏览器直接打开 `127.0.0.1:8484` 显示 401

这是正常的安全设计，不代表 Helper 损坏。

Helper 每次启动都会生成临时会话令牌。扩展通过 Native Messaging 获得令牌后才能访问 API；浏览器地址栏直接访问没有令牌，因此会返回 HTTP 401。

请使用扩展设置中的“启动”和连接状态验证，不要把直接访问根地址当作健康检查。

### 14.8 YouTube 出现 `nsig` 或 `Requested format is not available`

先确认 Node.js 路径：

```bash
command -v node
node --version
```

检查 Helper 使用的 yt-dlp 与 `yt-dlp-ejs`：

```bash
"$HOME/Library/Application Support/ObsidianWebClipperCNTranscript/helper/.venv/bin/python" \
  -c "import importlib.metadata as m; print('yt-dlp', m.version('yt-dlp')); print('yt-dlp-ejs', m.version('yt-dlp-ejs'))"
```

本项目会把 Node 路径交给 yt-dlp，并启用 EJS 解析。不要只通过 Homebrew 安装另一个系统级 yt-dlp，因为 Helper 使用的是自己 `.venv` 中的 Python 包。

如果平台策略变化导致依赖需要更新，优先升级到本项目的新 Release，不要随意修改 Helper 内部锁定依赖。

### 14.9 生成按钮没有出现

检查：

- 当前页面是否为 Bilibili 或 YouTube 视频页。
- Transcript Generator 是否已启用。
- 页面是否已经有可用平台字幕。
- 当前打开的是不是正确的 Transcript 扩展。
- 重新刷新视频页后再打开剪藏界面。

有平台字幕时不显示本地生成按钮，是“原生字幕优先”的正常行为。

### 14.10 transcript 已生成，但模板里没有内容

确认模板正文精确包含：

```markdown
{{transcript}}
```

然后：

1. 确认当前选中的模板。
2. 切换模板后切回来。
3. 重新打开同一视频的剪藏界面。
4. 在变量检查器确认 `transcript` 已有内容。

不要把 `transcript` 误写成 `transcipt`、`Transcript` 或其他拼写。

### 14.11 自动读取 Cookies 没有反应

1. 确认当前 Chrome 用户已经登录对应网站。
2. 选择“自动读取”。
3. 点击“读取并验证”。
4. 检查 Chrome 是否弹出 Cookies 权限申请。
5. 查看页面显示的成功数量或失败原因。

公开测试视频先使用“不使用”，不要让 Cookie 问题干扰基本链路验证。

### 14.12 弹窗关闭后看不到进度

任务仍会运行。重新打开同一个视频的剪藏界面，扩展会根据保存在本地的任务 ID 恢复状态。

不要切换到另一个视频后期待看到原视频的任务结果；任务状态与视频 URL 关联。

---

## 15. 把问题交给 AI Agent 时怎么描述

不要只说“安装失败”。把系统、命令、路径和完整错误一起提供。

可以使用下面的 Prompt：

```text
请帮我诊断 Obsidian Web Clipper CN · Transcript 的 macOS 安装问题。

限制：
- 不使用 Docker。
- 不创建第二套 Homebrew。
- 不创建 LaunchAgent。
- 不删除文件，除非先向我说明并获得确认。

请先检查：
- uname -m
- command -v brew && brew --prefix
- type -a brew
- command -v node && node --version
- command -v uv && uv --version
- Chrome 加载的扩展目录
- Native Messaging Host 文件
- Transcript Helper 日志
- tiny 模型目录

我的完整错误如下：
[在这里粘贴错误]

请定位根因，直接执行安全的检查和修复，并在每一步说明验证结果。
```

提交日志前删除或遮盖：

- Cookies。
- API Key。
- Chrome 个人资料路径。
- 私有视频地址。
- Helper 会话令牌。

---

## 16. 最终验收清单

完成课程验证时逐项确认：

- [ ] `uname -m` 与 Homebrew 安装位置匹配。
- [ ] Apple Silicon 只存在 `/opt/homebrew` 一套 Homebrew。
- [ ] `node --version` 正常且版本不低于 18。
- [ ] `uv --version` 正常。
- [ ] 安装使用 `v0.3.0-macos.zip`，不是 `-chrome.zip`。
- [ ] Chrome 加载固定项目目录中的 `extension/dist`。
- [ ] Native Messaging Host 已注册。
- [ ] 没有创建 Transcript LaunchAgent。
- [ ] Helper 可以由扩展按需启动。
- [ ] Helper 监听 `127.0.0.1:8484`。
- [ ] Faster Whisper 选择 `tiny`。
- [ ] tiny 模型状态显示已安装。
- [ ] 没有平台字幕的 YouTube 视频可以进入音频下载阶段。
- [ ] Faster Whisper 可以完成本地识别。
- [ ] 关闭弹窗不会取消任务。
- [ ] 生成结果进入原有 `{{transcript}}` 变量。
- [ ] 模板正文能显示 transcript。
- [ ] 笔记可以保存到 Obsidian。
- [ ] 设置中的“停止”可以结束 Helper。
- [ ] 不主动停止时，Helper 会在空闲约 15 分钟后退出。

---

## 17. 数据位置与隐私边界

| 数据 | 位置 | 是否上传 |
|---|---|---:|
| 扩展设置 | `chrome.storage.local` | 否 |
| Bilibili / YouTube Cookies | `chrome.storage.local` | 否 |
| Faster Whisper 模型 | `~/.cache/obsidian-web-clipper-cn-transcript/models/` | 否 |
| transcript 缓存 | `~/.cache/obsidian-web-clipper-cn-transcript/transcripts/` | 否 |
| 临时音频 | macOS 临时目录 | 任务后删除 |
| 临时 cookiefile | macOS 临时目录 | 任务后删除 |
| Helper 日志 | `~/Library/Application Support/ObsidianWebClipperCNTranscript/logs/` | 否 |

Faster Whisper 模式下，音频和识别留在本机。

如果改选 BCut，音频会上传到必剪的非官方公开接口；BCut 与 Faster Whisper 不会在失败时未经用户确认自动互相切换。

---

## 18. 官方参考

- Transcript 项目：<https://github.com/whatcccup/obsidian-web-clipper-cn-transcript>
- Transcript v0.3.0 Release：<https://github.com/whatcccup/obsidian-web-clipper-cn-transcript/releases/tag/v0.3.0>
- Homebrew 安装文档：<https://docs.brew.sh/Installation>
- Homebrew 官网：<https://brew.sh/>
- uv 安装文档：<https://docs.astral.sh/uv/getting-started/installation/>
- Node.js 官网：<https://nodejs.org/>
- Obsidian：<https://obsidian.md/>

本项目仅支持 macOS + Chrome/Chromium，不支持 Windows 或 Linux，也没有开发其他桌面系统版本的当前计划。
