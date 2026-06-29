// Derive a short plain-text summary from an announcement's markdown body, for
// the notification/email preview (the full body is rendered on the detail page).
export function plainSummary(md: string, max = 160): string {
  const text = md
    .replace(/```[\s\S]*?```/g, ' ') // code fences
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
    .replace(/[#>*_`~-]/g, ' ') // md markers
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
