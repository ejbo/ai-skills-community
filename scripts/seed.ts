import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: '.env.local', override: true });

const prisma = new PrismaClient();

const CATEGORIES = [
  { slug: 'coding', name: '编程辅助', description: 'Code generation, refactoring, review' },
  { slug: 'data', name: '数据分析', description: 'Data wrangling, SQL, charts' },
  { slug: 'writing', name: '写作', description: 'Drafting, editing, summarizing' },
  { slug: 'devops', name: 'DevOps', description: 'CI, infra, deployments' },
  { slug: 'docs', name: '文档', description: 'Doc generation, README, API docs' },
  { slug: 'meta', name: '元技能', description: 'Prompting, agents, workflows' },
  { slug: 'pdf', name: 'PDF / 文档处理', description: 'PDF parsing, form filling' },
  { slug: 'web', name: 'Web 抓取', description: 'Scraping, automation' },
  { slug: 'research', name: '研究', description: 'Literature review, summary, deep research' },
  { slug: 'other', name: '其他', description: 'Misc' },
];

const SAMPLE_SKILLS = [
  {
    slug: 'pdf-form-signer',
    name: 'PDF Form Signer',
    summary: '智能识别 PDF 表单字段，自动填写并放置签名。',
    body: `# PDF Form Signer\n\n## What it does\nDetects fillable fields in a PDF form, fills them based on context, and places a signature image at the right location.\n\n## Triggers\n- "sign this pdf"\n- "fill out form"\n\n## Typical workflow\n1. Open the PDF.\n2. Map fields → user data.\n3. Render & overlay signature.\n4. Return signed PDF.\n`,
    category: 'pdf',
    tags: ['pdf', 'signing', 'forms'],
    sourceType: 'external' as const,
  },
  {
    slug: 'schema-aware-sql',
    name: 'Schema-Aware SQL',
    summary: '自动读取数据库 schema，生成精准的 SQL，避免幻觉表名。',
    body: `# Schema-Aware SQL\n\n## What it does\nInspects the target database's schema before composing SQL so it never hallucinates table or column names.\n\n## Triggers\n- "write a SQL"\n- "query the database"\n`,
    category: 'data',
    tags: ['sql', 'data', 'database'],
    sourceType: 'external' as const,
  },
  {
    slug: 'changelog-from-commits',
    name: 'Changelog from Commits',
    summary: '从 git log 自动生成符合 Keep-a-Changelog 规范的 CHANGELOG。',
    body: `# Changelog from Commits\n\n## What it does\nReads recent commits and writes a Keep-a-Changelog-style entry, grouped by type.\n`,
    category: 'docs',
    tags: ['git', 'changelog', 'docs'],
    sourceType: 'curated' as const,
    externalUrl: 'https://github.com/anthropics/skills',
  },
  {
    slug: 'meeting-summarizer',
    name: 'Meeting Summarizer',
    summary: '把会议录音/转写整理成行动项 + 关键决策摘要。',
    body: `# Meeting Summarizer\n\nExtracts action items, decisions, and discussion topics from a transcript.\n`,
    category: 'writing',
    tags: ['meetings', 'summary'],
    sourceType: 'external' as const,
  },
  {
    slug: 'huawei-w3-helper',
    name: 'Huawei W3 Helper',
    summary: '与 Huawei W3 系统集成的常用查询和操作脚本。',
    body: `# Huawei W3 Helper\n\nCommon W3 lookups: org chart, internal links, mailing list resolution.\n`,
    category: 'meta',
    tags: ['huawei', 'w3', 'internal'],
    sourceType: 'internal' as const,
  },
  {
    slug: 'react-component-scaffolder',
    name: 'React Component Scaffolder',
    summary: '按你的项目风格生成 React 组件 + 测试 + 故事书。',
    body: `# React Component Scaffolder\n\nScaffolds a TSX component matching the conventions of the current project.\n`,
    category: 'coding',
    tags: ['react', 'scaffolding', 'frontend'],
    sourceType: 'curated' as const,
    externalUrl: 'https://github.com/anthropics/skills',
  },
];

async function ensureAdmin() {
  const email = (process.env.INITIAL_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD ?? 'changeme';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (!existing.isAdmin) {
      await prisma.user.update({ where: { id: existing.id }, data: { isAdmin: true } });
      console.log(`✓ Promoted existing user ${email} to admin`);
    } else {
      console.log(`✓ Admin ${email} already exists`);
    }
    return existing;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const created = await prisma.user.create({
    data: {
      email,
      handle: 'admin',
      displayName: 'Admin',
      passwordHash,
      authMethod: 'password',
      isAdmin: true,
    },
  });
  console.log(`✓ Created admin user ${email} / ${password}`);
  return created;
}

async function ensureCurator() {
  const email = 'anthropic-curator@example.com';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      email,
      handle: 'anthropic-curator',
      displayName: 'Anthropic Curator',
      authMethod: 'password',
      passwordHash: await bcrypt.hash('seed-only-no-login-' + Date.now(), 12),
      bio: 'Bot account that imports curated skills from anthropics/skills.',
      isActive: false,
    },
  });
}

async function seedCategories() {
  for (const c of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, description: c.description },
      create: c,
    });
  }
  console.log(`✓ Upserted ${CATEGORIES.length} categories`);
}

async function seedSkills(adminId: string, curatorId: string) {
  let created = 0;
  for (const s of SAMPLE_SKILLS) {
    const exists = await prisma.skill.findUnique({ where: { slug: s.slug } });
    if (exists) continue;

    const category = await prisma.category.findUnique({ where: { slug: s.category } });
    const authorId = s.sourceType === 'curated' ? curatorId : adminId;
    const tokenCost = Math.ceil(s.body.length / 4);

    const skill = await prisma.skill.create({
      data: {
        slug: s.slug,
        name: s.name,
        summary: s.summary,
        descriptionMd: s.body,
        authorId,
        categoryId: category?.id,
        sourceType: s.sourceType,
        skillFormat: 'structured',
        status: 'published',
        tokenCostEstimate: tokenCost,
        externalSourceUrl: 'externalUrl' in s ? s.externalUrl : null,
        downloadCount: Math.floor(Math.random() * 8000) + 100,
        likeCount: Math.floor(Math.random() * 400) + 5,
        subscriberCount: Math.floor(Math.random() * 200),
        avgRating: 3.8 + Math.random() * 1.2,
        reviewCount: Math.floor(Math.random() * 40),
        trendingScore: Math.random() * 1000,
      },
    });

    const version = await prisma.skillVersion.create({
      data: {
        skillId: skill.id,
        version: '1.0.0',
        major: 1,
        minor: 0,
        patch: 0,
        contentInline: s.body,
        manifestJson: { name: s.name, description: s.summary, triggers: [] },
        tokenCost,
        status: 'published',
        publishedAt: new Date(),
      },
    });
    await prisma.skill.update({ where: { id: skill.id }, data: { currentVersionId: version.id } });

    for (const tagName of s.tags) {
      const slug = tagName.toLowerCase().replace(/[^a-z0-9-]/g, '');
      const tag = await prisma.tag.upsert({
        where: { slug },
        update: { usageCount: { increment: 1 } },
        create: { slug, name: tagName, usageCount: 1 },
      });
      await prisma.skillTag.upsert({
        where: { skillId_tagId: { skillId: skill.id, tagId: tag.id } },
        update: {},
        create: { skillId: skill.id, tagId: tag.id },
      });
    }
    created += 1;
  }
  console.log(`✓ Inserted ${created} new skills (${SAMPLE_SKILLS.length - created} already existed)`);
}

async function main() {
  console.log('▶ Seeding Skills Community…');
  const admin = await ensureAdmin();
  const curator = await ensureCurator();
  await seedCategories();
  await seedSkills(admin.id, curator.id);
  console.log('✔ Seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
