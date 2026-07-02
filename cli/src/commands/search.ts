import kleur from 'kleur';
import { loadConfig } from '../config.js';
import { ApiClient } from '../api.js';

export async function searchCommand(query: string) {
  const cfg = await loadConfig();
  const api = new ApiClient(cfg);
  const { items } = await api.search(query);
  if (items.length === 0) {
    console.log(kleur.dim('  没有匹配的 Skill。'));
    return;
  }
  for (const s of items) {
    const src =
      s.sourceType === 'internal'
        ? kleur.blue('内部')
        : s.sourceType === 'curated'
          ? kleur.magenta('搬运')
          : kleur.green('外部');
    const dl = kleur.dim(`⬇ ${s.downloadCount}`);
    const rating = s.avgRating > 0 ? kleur.yellow(`★ ${s.avgRating.toFixed(1)}`) : kleur.dim('★ —');
    console.log(`  ${kleur.bold(s.slug)}  ${src}  ${dl}  ${rating}`);
    console.log(`    ${kleur.dim(s.summary)}`);
  }
}
