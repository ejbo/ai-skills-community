// One-off content repair: bodies stored while the editor's image serializer
// glued the next block onto the image's line (`![a](/a.jpg)## Heading`).
// Detection + repair rules live in lib/glued-images.ts (pure, unit-tested in
// tests/repair-glued-images.test.ts); this script only walks the tables.
//
// DRY-RUN BY DEFAULT — it prints a per-table report and writes nothing. Run it
// on production BEFORE and AFTER deploying the serializer fix (a body saved in
// between would otherwise stay glued), read the samples, then re-run with
// --apply.
//
//   pnpm content:repair-glued-images                      # report only
//   pnpm content:repair-glued-images --verbose            # + every row id and samples
//   pnpm content:repair-glued-images --only=ZonePost.bodyMd,Event.descriptionMd
//   pnpm content:repair-glued-images --apply              # write the repairs
//
// Which fields run is decided in lib/glued-images.ts (GLUED_IMAGE_TARGETS). A
// field marked `optIn` — Skill.descriptionMd (package READMEs) and
// VideoComment.bodyMd (plain-textarea composer) — is NOT scanned by default:
// hand-written markdown there contains shapes the rules cannot tell apart from
// glue (`- ![py](/py.png)Python` icon lists). Name it in --only to scan it, and
// read every --verbose sample before adding --apply.
//
// Write safety, all deliberate:
//  • every write is GUARDED on the body still being exactly what was read
//    (`updateMany where { id, field: original }`) — a row someone edited while
//    the script ran is reported as skipped, never overwritten;
//  • `updatedAt` is written back unchanged where the model has one, so a repair
//    does not bump "last edited" ordering or flip an 已编辑 marker;
//  • a model/field that does not exist in this Prisma client, or a table the
//    database does not have yet (a pending migration), is reported and skipped;
//  • ZoneWikiRevision snapshots are repaired too — restoring a revision re-saves
//    its body, and a glued snapshot would bring the damage back.
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: '.env.local', override: true });

/** The 版块 right-rail custom cards are markdown too, inside `Zone.sidebar` JSON (lib/zones/sidebar.ts). */
const SIDEBAR_LABEL = 'Zone.sidebar[custom].bodyMd';

const PAGE = 200;

interface TableReport {
  label: string;
  candidates: number;
  glued: number;
  fixes: number;
  written: number;
  skipped: number;
  note?: string;
}

type Row = Record<string, unknown>;
interface Delegate {
  findMany(args: unknown): Promise<Row[]>;
  updateMany(args: unknown): Promise<{ count: number }>;
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const verbose = argv.includes('--verbose');
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const unknown = argv.filter((a) => a.startsWith('--') && a !== '--apply' && a !== '--verbose' && !a.startsWith('--only='));
  return { apply, verbose, only, unknown };
}

function delegateName(model: string): string {
  return model[0].toLowerCase() + model.slice(1);
}

function isMissingTable(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 'P2021' || code === 'P2022';
}

async function main() {
  const { apply, verbose, only, unknown } = parseArgs(process.argv.slice(2));
  if (unknown.length > 0) {
    console.error(`Unknown option(s): ${unknown.join(' ')}\nUsage: pnpm content:repair-glued-images [--apply] [--verbose] [--only=Model.field,…]`);
    process.exit(2);
  }

  // Dynamic imports so env is populated before @/lib/env validates it.
  const { prisma } = await import('@/lib/db');
  const { Prisma } = await import('@prisma/client');
  const { GLUED_IMAGE_TARGETS, gluedImageTargetLabel, repairGluedImages, selectGluedImageTargets } = await import('@/lib/glued-images');
  const { parseSidebarLayout } = await import('@/lib/zones/sidebar');

  const models = Prisma.dmmf.datamodel.models;
  const client = prisma as unknown as Record<string, Delegate>;
  const reports: TableReport[] = [];

  console.log(apply ? '== APPLY: glued image repairs will be WRITTEN ==' : '== DRY RUN: nothing will be written (pass --apply to write) ==');
  if (only) {
    const known = new Set([...GLUED_IMAGE_TARGETS.map(gluedImageTargetLabel), SIDEBAR_LABEL]);
    const unknownFields = [...only].filter((l) => !known.has(l));
    if (unknownFields.length > 0) {
      console.error(`Unknown --only field(s): ${unknownFields.join(', ')}\nKnown: ${[...known].join(', ')}`);
      process.exit(2);
    }
  } else {
    for (const t of GLUED_IMAGE_TARGETS.filter((x) => x.optIn)) {
      console.log(`  (not scanned by default: ${gluedImageTargetLabel(t)} — ${t.optIn}; name it in --only to include it)`);
    }
  }

  for (const target of selectGluedImageTargets(only)) {
    const label = gluedImageTargetLabel(target);
    const report: TableReport = { label, candidates: 0, glued: 0, fixes: 0, written: 0, skipped: 0 };
    reports.push(report);

    const model = models.find((m) => m.name === target.model);
    const field = model?.fields.find((f) => f.name === target.field && f.type === 'String');
    const idField = model?.fields.find((f) => f.isId)?.name;
    if (!model || !field || !idField) {
      report.note = 'model/field not in this Prisma client — skipped';
      continue;
    }
    const updatedAtField = model.fields.find((f) => f.isUpdatedAt)?.name;
    const delegate = client[delegateName(target.model)];

    let cursor: string | null = null;
    try {
      for (;;) {
        const rows: Row[] = await delegate.findMany({
          // Only rows that contain an image at all — the repair needs one to fire.
          where: { OR: [{ [target.field]: { contains: '![' } }, { [target.field]: { contains: '<img ' } }] },
          select: { [idField]: true, [target.field]: true, ...(updatedAtField ? { [updatedAtField]: true } : {}) },
          orderBy: { [idField]: 'asc' },
          take: PAGE,
          ...(cursor ? { cursor: { [idField]: cursor }, skip: 1 } : {}),
        });
        if (rows.length === 0) break;
        cursor = String(rows[rows.length - 1][idField]);
        report.candidates += rows.length;

        for (const row of rows) {
          const body = row[target.field];
          if (typeof body !== 'string') continue;
          const result = repairGluedImages(body, { splitImageRuns: target.splitImageRuns ?? true });
          if (result.fixes === 0) continue;
          report.glued += 1;
          report.fixes += result.fixes;
          if (verbose) console.log(`  ${label} ${String(row[idField])}: ${result.fixes} fix(es)  ${result.samples.map((s) => JSON.stringify(s)).join('  ')}`);
          if (!apply) continue;
          const { count } = await delegate.updateMany({
            where: { [idField]: row[idField], [target.field]: body },
            data: { [target.field]: result.text, ...(updatedAtField ? { [updatedAtField]: row[updatedAtField] } : {}) },
          });
          if (count === 1) report.written += 1;
          else {
            report.skipped += 1;
            console.log(`  ! ${label} ${String(row[idField])}: changed since it was read — skipped`);
          }
        }
        if (rows.length < PAGE) break;
      }
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      report.note = 'table/column missing in this database (pending migration?) — skipped';
    }
  }

  if (!only || only.has(SIDEBAR_LABEL)) {
    const report: TableReport = { label: SIDEBAR_LABEL, candidates: 0, glued: 0, fixes: 0, written: 0, skipped: 0 };
    reports.push(report);
    try {
      const zones = await prisma.zone.findMany({ select: { id: true, sidebar: true, updatedAt: true } });
      for (const zone of zones) {
        const layout = parseSidebarLayout(zone.sidebar);
        if (!layout.custom.some((c) => c.bodyMd.includes('![') || c.bodyMd.includes('<img '))) continue;
        report.candidates += 1;
        let fixes = 0;
        const samples: string[] = [];
        // Rewrite the STORED object (not the parsed one): parseSidebarLayout
        // normalises order/hidden, and a repair must not change anything else.
        const raw = zone.sidebar as { custom?: unknown } | null;
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.custom)) continue;
        const custom = raw.custom.map((card) => {
          if (!card || typeof card !== 'object') return card;
          const c = card as { bodyMd?: unknown };
          if (typeof c.bodyMd !== 'string') return card;
          const r = repairGluedImages(c.bodyMd);
          fixes += r.fixes;
          samples.push(...r.samples);
          return r.fixes > 0 ? { ...c, bodyMd: r.text } : card;
        });
        if (fixes === 0) continue;
        report.glued += 1;
        report.fixes += fixes;
        if (verbose) console.log(`  ${SIDEBAR_LABEL} zone ${zone.id}: ${fixes} fix(es)  ${samples.slice(0, 3).map((s) => JSON.stringify(s)).join('  ')}`);
        if (!apply) continue;
        const { count } = await prisma.zone.updateMany({
          where: { id: zone.id, sidebar: { equals: zone.sidebar ?? {} } },
          data: { sidebar: { ...(raw as object), custom }, updatedAt: zone.updatedAt },
        });
        if (count === 1) report.written += 1;
        else {
          report.skipped += 1;
          console.log(`  ! ${SIDEBAR_LABEL} zone ${zone.id}: changed since it was read — skipped`);
        }
      }
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      report.note = 'column missing in this database — skipped';
    }
  }

  console.log('');
  const w = Math.max(...reports.map((r) => r.label.length), 5);
  console.log(`${'table'.padEnd(w)}  ${'with img'.padStart(8)}  ${'glued'.padStart(6)}  ${'fixes'.padStart(6)}${apply ? `  ${'written'.padStart(7)}  ${'skipped'.padStart(7)}` : ''}`);
  for (const r of reports) {
    console.log(
      `${r.label.padEnd(w)}  ${String(r.candidates).padStart(8)}  ${String(r.glued).padStart(6)}  ${String(r.fixes).padStart(6)}` +
        (apply ? `  ${String(r.written).padStart(7)}  ${String(r.skipped).padStart(7)}` : '') +
        (r.note ? `  (${r.note})` : ''),
    );
  }
  const total = reports.reduce((a, r) => ({ glued: a.glued + r.glued, fixes: a.fixes + r.fixes, written: a.written + r.written, skipped: a.skipped + r.skipped }), { glued: 0, fixes: 0, written: 0, skipped: 0 });
  console.log(`\n${total.glued} glued row(s), ${total.fixes} boundary fix(es)` + (apply ? `; ${total.written} written, ${total.skipped} skipped.` : '.'));
  if (!apply && total.glued > 0) console.log('Re-run with --apply to write these repairs (add --verbose to see every row first).');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
