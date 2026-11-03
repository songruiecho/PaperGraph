# Contributing

感谢你改进 Paper Knowledge Graph。

## 提交前

1. 不要提交论文 PDF、私人阅读摘要、绝对路径或个人身份信息。
2. 保持项目无外部前端依赖，除非新依赖确有必要。
3. 运行 `node --check dist/app.js` 检查 JavaScript 语法。
4. 在 Windows 上运行 `powershell -ExecutionPolicy Bypass -File build.ps1` 验证启动器可编译。
5. 确认 `rg -n "C:\\\\Users|/Users/|/home/" .` 不会命中私人路径。

## Pull Request

请在 PR 中说明：

- 解决的问题；
- 用户可见的变化；
- 验证方式；
- 是否涉及数据格式或隐私模型变化。

