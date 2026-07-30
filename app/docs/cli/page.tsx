import { headers } from 'next/headers';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { getTranslations } from 'next-intl/server';

export default async function CliDocsPage() {
  const t = await getTranslations('docs_page');
  // Bake the live site origin into the commands so they're copy-paste ready
  // (tracks whatever host serves the page — localhost / AWS / intranet).
  const h = headers();
  const host = h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? 'http';
  // Include the deploy basePath (…/ai-community) — the tarball + API live under it on a subpath
  // deploy. The commands also pass `--registry <base>` so the CLI targets THIS server.
  const base = host
    ? `${proto}://${host}${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}`
    : t('cli_site_placeholder');

  // Prose + the trailing `#` comments of the samples are translated; the commands
  // themselves stay verbatim. `<SITE_URL>` is the origin sentinel baked into the
  // command samples — replaced with the live origin below.
  const CONTENT = `
# ${t('cli_title')}

${t('cli_intro')}

## ${t('cli_h_prereq')}

${t('cli_prereq_p1')}

\`\`\`bash
node -v        # ${t('cli_cmt_node_version')}
npm -v
\`\`\`

## ${t('cli_h_install')}

\`\`\`bash
npm i -g <SITE_URL>/skills-cli.tgz   # ${t('cli_cmt_install_global')}
skills --version                      # ${t('cli_cmt_verify_install')}
\`\`\`

## ${t('cli_h_login')}

${t('cli_login_p1', { site: base })}

\`\`\`bash
skills login --registry <SITE_URL>   # ${t('cli_cmt_login')}
\`\`\`

${t('cli_login_p2')}

## ${t('cli_h_install_skill')}

\`\`\`bash
skills install <slug>              # ${t('cli_cmt_install_project')}
skills install <slug> -g           # ${t('cli_cmt_install_global_skill')}
skills install <slug>@1.2.0 -s     # ${t('cli_cmt_install_version')}
skills install <a> <b> <c>         # ${t('cli_cmt_install_many')}
skills install pack:<${t('cli_arg_pack_slug')}>     # ${t('cli_cmt_install_pack')}
\`\`\`

${t('cli_install_p1')}

${t('cli_install_p2')}

## ${t('cli_h_common')}

\`\`\`bash
skills search "${t('cli_arg_keyword')}"   # ${t('cli_cmt_search')}
skills list -a           # ${t('cli_cmt_list')}
skills update -a         # ${t('cli_cmt_update')}
skills subscribe <slug>  # ${t('cli_cmt_subscribe')}
skills logout            # ${t('cli_cmt_logout')}
\`\`\`

## ${t('cli_h_upgrade')}

${t('cli_upgrade_p1')}

\`\`\`bash
skills upgrade           # ${t('cli_cmt_upgrade')}
\`\`\`

${t('cli_upgrade_p2')}

${t('cli_upgrade_p3')}

\`\`\`bash
npm i -g <SITE_URL>/skills-cli.tgz
skills --version
\`\`\`

## ${t('cli_h_uninstall')}

\`\`\`bash
npm uninstall -g @skills-community/cli   # ${t('cli_cmt_uninstall_cli')}
rm -rf ~/.skills                          # ${t('cli_cmt_uninstall_config')}
rm -rf ~/.npm/_npx                        # ${t('cli_cmt_uninstall_npx')}
\`\`\`

${t('cli_uninstall_p1')}
`;

  const content = CONTENT.replaceAll('<SITE_URL>', base);

  return (
    <div className="prose prose-zinc max-w-none dark:prose-invert">
      <MarkdownRenderer content={content} />
    </div>
  );
}
