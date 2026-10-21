// 知识库能不能收这个附件——纯函数版（客户端也用：工具详情页只给能收录的文件显示「分享到知识库」）。
// 与 lib/library/storage.ts#detectLibraryFormat 同一张表；那边带 node 依赖，客户端不能 import。

const INGESTIBLE_EXT = new Set(['pdf', 'epub', 'html', 'htm', 'pptx', 'docx']);

export function isLibraryIngestible(name: string, mimeType = ''): boolean {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  if (m && INGESTIBLE_EXT.has(m[1].toLowerCase())) return true;
  return /pdf|epub|html|presentationml|wordprocessingml/i.test(mimeType);
}
