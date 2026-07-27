# Obsidian Web Clipper CN · Transcript 项目规则

本文件适用于 `obsidian-web-clipper-cn-transcript/` 目录及其所有子目录，并继承上级工作区的通用规则。

## 中文与编码

- 所有文本源码统一使用 UTF-8，不得保存为 Latin-1、GBK 或其他编码。
- 所有 HTML 文件必须在 `<head>` 的最前部显式声明 `<meta charset="UTF-8">`。
- `popup.html`、`side-panel.html` 等扩展运行页面不得直接新增中文界面文案；优先使用现有 i18n，Transcript Generator 专属动态文案通过 TypeScript 的 `textContent` 写入。生产构建启用 `ascii_only`，避免 HTML 解码造成乱码。
- 修改中文文案后必须同时检查源码和 `extension/dist/`，不得出现 `å½`、`å‰`、`è§`、`é¢`、`æ²`、`æœ`、`å­—`、`å¹` 等 UTF-8 被错误解码的特征串。

## 弹窗与嵌入式一致性

- `extension/src/popup.html` 和 `extension/src/side-panel.html` 共用 `popup.js`。新增 Transcript Generator 控件时必须在两个入口保持相同 ID 和结构，业务逻辑只写在共享 TypeScript 控制器中。
- 修改 Transcript Generator 面板后必须验证弹出窗口和嵌入式构建产物，不得只检查其中一个入口。

## 验证

提交前至少执行：

```bash
npm --prefix extension run build:chrome
```

并确认：

- `extension/dist/popup.html` 与 `extension/dist/side-panel.html` 都包含 `<meta charset="UTF-8">`。
- 两个入口需要的 Transcript Generator 控件 ID 唯一且完整。
- 源码和构建产物通过乱码特征扫描。
- Webpack 体积 warning 可以记录，但构建 error 必须修复。
