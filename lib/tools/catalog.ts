// 导航「工具」下的工具目录（docs/contracts/reports.md §0）。纯模块：/tools 页、导航悬停面板都读它。
// 加一个工具 = 这里加一行 + messages 的 `tools` 命名空间加 title / desc + /tools 页的图标表。

export interface ToolEntry {
  id: 'chat-report';
  href: string;
  /** `tools` 命名空间里的键。 */
  titleKey: string;
  descKey: string;
}

export const TOOLS: ToolEntry[] = [{ id: 'chat-report', href: '/tools/chat-report', titleKey: 'chat_report_title', descKey: 'chat_report_desc' }];
