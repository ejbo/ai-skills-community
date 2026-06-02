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

export interface SkillMeta {
  name: string;
  summary: string;
}

export const DEFAULT_MAX_CONTEXT_CHARS = 150 * 1024;

function rank(path: string): number {
  if (/^references\//i.test(path)) return 0;
  if (/^scripts\//i.test(path)) return 1;
  return 2;
}

export function assembleSkillContext(
  meta: SkillMeta,
  skillMd: string,
  files: ContextFile[],
  maxChars: number = DEFAULT_MAX_CONTEXT_CHARS,
): string {
  const header =
    `You have the following skill installed. Its files are provided below. ` +
    `Use it whenever relevant to the user's request, and you can answer questions about how to use it.\n\n` +
    `--- SKILL: ${meta.name} ---\n${meta.summary}\n\n# SKILL.md\n${skillMd}\n`;

  const parts: string[] = [header];
  const omitted: string[] = [];
  let used = header.length;

  const supporting = files
    .filter(
      (file) =>
        file.isText &&
        typeof file.content === 'string' &&
        file.content.length > 0 &&
        !/(^|\/)SKILL\.md$/i.test(file.path),
    )
    .sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));

  for (const file of supporting) {
    const block = `\n--- FILE: ${file.path} ---\n${file.content}\n`;
    if (used + block.length > maxChars) {
      omitted.push(file.path);
      continue;
    }
    parts.push(block);
    used += block.length;
  }

  let out = parts.join('') + `\n--- END SKILL ---\n`;
  if (omitted.length > 0) {
    out += `\n(omitted for length: ${omitted.join(', ')})\n`;
  }
  return out;
}
