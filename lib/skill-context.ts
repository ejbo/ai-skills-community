export interface ContextFile {
  path: string;
  content: string | null;
  isText: boolean;
}

export function selectReadme(files: ContextFile[]): string | null {
  const readmes = files.filter(
    (file) =>
      file.isText &&
      typeof file.content === 'string' &&
      file.content.length > 0 &&
      /(^|\/)readme(\.md|\.markdown|\.txt)?$/i.test(file.path),
  );
  if (readmes.length === 0) return null;
  readmes.sort((a, b) => {
    const depthA = a.path.split('/').length;
    const depthB = b.path.split('/').length;
    if (depthA !== depthB) return depthA - depthB;
    return a.path.length - b.path.length;
  });
  return readmes[0].content;
}
