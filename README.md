# ChatGPT 快捷删除 / 归档 / 多选批量删除（油猴脚本）

适用于 https://chatgpt.com/ 。在 Tampermonkey 中安装 `chatgpt-delete-archive.user.js`。

## 功能

| 功能 | 默认快捷键（macOS） | Windows |
| --- | --- | --- |
| 删除当前对话 | ⌥⇧D | Alt+Shift+D |
| 归档当前对话 | ⌥⇧A | Alt+Shift+A |
| 开启 / 退出多选 | ⌥⇧M | Alt+Shift+M |
| 选中 / 取消选中当前对话 | ⌥⇧S | Alt+Shift+S |
| 删除已选对话 | 未设置 | 未设置 |
| 打开设置 | ⌥⇧, | Alt+Shift+, |

- **删除当前对话**：默认弹出 ChatGPT 原生的 “Delete chat?” 确认框（通过侧边栏该对话的菜单触发）；可在设置中关闭确认，改为直接删除。
- **多选**：点击 Recents 标题右侧的多选图标或按快捷键。对话左侧出现圆圈，点圆圈选中，点对话本身正常打开查看；按快捷键选中正在查看的对话。顶部出现可拖动的工具栏（双击空白处复位），可全选、批量归档、批量删除（需确认）。
- **设置**：仿 ChatGPT “Keyboard shortcuts” 对话框，修改即时生效；每个快捷键都可开关和重新录制。入口：工具栏齿轮、快捷键、Tampermonkey 菜单。

## 样式

界面直接复用 ChatGPT 页面中的 class、图标 sprite 与 CSS 变量，跟随浅色/深色主题。
强调色读取自 ChatGPT 设置（`--color-background-composer-primary` 等变量），切换后即时生效；使用默认强调色时为灰色主题。

## 实现说明

批量删除、归档、无确认删除调用网页端自身接口 `PATCH /backend-api/conversation/{id}`（`is_visible: false` / `is_archived: true`）。
