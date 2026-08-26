import { describe, expect, it, vi } from 'vitest';

// employee-match imports the key helpers from employee-directory, which imports prisma.
// The matcher itself never touches the DB — this mock only keeps the import graph loadable.
vi.mock('@/lib/db', () => ({ prisma: {} }));

import {
  DirectoryIndex,
  applyImportFields,
  classifyNameDuplicates,
  resolveImportTarget,
  type DirectoryRowLite,
} from '@/lib/employee-match';

let seq = 0;
function row(over: Partial<DirectoryRowLite> = {}): DirectoryRowLite {
  return {
    id: `e${++seq}`,
    name: '张三',
    accountNumber: null,
    department: '',
    lab: '',
    avatarUrl: '',
    isActive: true,
    ...over,
  };
}

const imp = (over: Partial<Parameters<typeof resolveImportTarget>[0]> = {}) => ({
  name: '张三',
  accountNumber: null as string | null,
  department: '',
  lab: '',
  ...over,
});

describe('resolveImportTarget — 工号 匹配', () => {
  it('工号命中已有行（数字相同即可）', () => {
    const existing = row({ accountNumber: '84412632' });
    const target = resolveImportTarget(imp({ accountNumber: 'z84412632' }), new DirectoryIndex([existing]));
    expect(target).toEqual({ kind: 'update', entry: existing, matchedBy: 'account', backfillAccount: false });
  });

  it('工号命中时姓名可以完全不同（改过名/名单写法不一致）', () => {
    const existing = row({ name: '李四', accountNumber: 'z84412632' });
    const target = resolveImportTarget(imp({ name: '张三', accountNumber: '84412632' }), new DirectoryIndex([existing]));
    expect(target).toMatchObject({ kind: 'update', entry: existing, matchedBy: 'account' });
  });
});

describe('resolveImportTarget — 用户的场景：旧名单没工号，重新上传带工号', () => {
  it('按姓名找到那条无工号的旧行并回填工号（而不是新建重复行）', () => {
    const old = row({ accountNumber: null, department: 'AI事业部' });
    const target = resolveImportTarget(
      imp({ accountNumber: 'z84412632', department: '计算产品线' }),
      new DirectoryIndex([old]),
    );
    expect(target).toEqual({ kind: 'update', entry: old, matchedBy: 'name', backfillAccount: true });
  });

  it('姓名的空格/全角/大小写差异不影响匹配', () => {
    const old = row({ name: '李明' });
    const index = new DirectoryIndex([old]);
    expect(resolveImportTarget(imp({ name: '李 明', accountNumber: 'z1' }), index)).toMatchObject({ entry: old });
    const en = row({ name: 'Li Wei' });
    expect(
      resolveImportTarget(imp({ name: 'liwei', accountNumber: 'z2' }), new DirectoryIndex([en])),
    ).toMatchObject({ entry: en });
  });

  it('同名多条无工号时用部门（再研究所）收敛', () => {
    const a = row({ department: 'AI事业部', lab: '视觉所' });
    const b = row({ department: '云核心网', lab: '网络所' });
    const target = resolveImportTarget(
      imp({ accountNumber: 'z1', department: '云核心网' }),
      new DirectoryIndex([a, b]),
    );
    expect(target).toMatchObject({ kind: 'update', entry: b, backfillAccount: true });
  });

  it('同名多条无工号且无法区分 ⇒ 歧义，绝不瞎猜', () => {
    const a = row();
    const b = row();
    const target = resolveImportTarget(imp({ accountNumber: 'z1' }), new DirectoryIndex([a, b]));
    expect(target).toEqual({ kind: 'ambiguous', candidates: [a, b] });
  });

  it('同名行已有别的工号 ⇒ 是另一个人，新建（绝不改写别人的工号）', () => {
    const other = row({ accountNumber: 'z99999999' });
    const target = resolveImportTarget(imp({ accountNumber: 'z84412632' }), new DirectoryIndex([other]));
    expect(target).toEqual({ kind: 'create', reason: 'new' });
  });

  it('名单里没有这个人 ⇒ 新建', () => {
    expect(resolveImportTarget(imp({ name: '新人', accountNumber: 'z1' }), new DirectoryIndex([row()]))).toEqual({
      kind: 'create',
      reason: 'new',
    });
  });
});

describe('resolveImportTarget — 导入行本身没有工号', () => {
  it('优先命中无工号的旧行', () => {
    const free = row({ accountNumber: null });
    const withAccount = row({ accountNumber: 'z1' });
    const target = resolveImportTarget(imp(), new DirectoryIndex([withAccount, free]));
    expect(target).toEqual({ kind: 'update', entry: free, matchedBy: 'name', backfillAccount: false });
  });

  it('没有无工号旧行时，命中唯一的同名行（其工号原样保留）', () => {
    const only = row({ accountNumber: 'z1', department: '旧部门' });
    const target = resolveImportTarget(imp({ department: '新部门' }), new DirectoryIndex([only]));
    expect(target).toEqual({ kind: 'update', entry: only, matchedBy: 'name', backfillAccount: false });
    expect(applyImportFields(only, { ...imp({ department: '新部门' }), avatarUrl: '' }, { backfillAccount: false, clearMissing: false }))
      .toEqual({ department: '新部门' });
  });

  it('多条同名且都有工号 ⇒ 歧义（调用方会跳过，避免再加一条重复）', () => {
    const a = row({ accountNumber: 'z1' });
    const b = row({ accountNumber: 'z2' });
    expect(resolveImportTarget(imp(), new DirectoryIndex([a, b]))).toEqual({ kind: 'ambiguous', candidates: [a, b] });
  });
});

describe('DirectoryIndex', () => {
  it('按加载顺序返回（最近更新的在前）', () => {
    const newer = row({ accountNumber: 'z84412632' });
    const older = row({ accountNumber: '84412632' });
    const index = new DirectoryIndex([newer, older]);
    expect(index.byAccount('84412632').map((r) => r.id)).toEqual([newer.id, older.id]);
  });

  it('replace 会重新建索引：回填工号后，同一工号的下一行命中的是同一条', () => {
    const before = row({ accountNumber: null });
    const index = new DirectoryIndex([before]);
    const after = { ...before, accountNumber: 'z84412632' };
    index.replace(before, after);
    expect(index.byAccount('84412632')).toEqual([after]);
    expect(index.byPersonName('张三')).toEqual([after]);
    // 同一份文件里重复出现的第二行会更新同一条，而不是再建一条
    expect(resolveImportTarget(imp({ accountNumber: 'z84412632' }), index)).toMatchObject({
      kind: 'update',
      entry: after,
      matchedBy: 'account',
    });
  });

  it('remove 后不再被匹配到', () => {
    const r = row({ accountNumber: 'z1' });
    const index = new DirectoryIndex([r]);
    index.remove(r);
    expect(index.byAccount('z1')).toEqual([]);
    expect(index.byPersonName('张三')).toEqual([]);
  });

  it('空姓名/空工号不进索引', () => {
    const index = new DirectoryIndex([row({ name: '   ', accountNumber: '' })]);
    expect(index.byPersonName('   ')).toEqual([]);
    expect(index.byAccount('')).toEqual([]);
  });
});

describe('classifyNameDuplicates', () => {
  it('只考虑同名、无工号、且不是刚命中的那条', () => {
    const kept = row({ accountNumber: 'z84412632' });
    const stale = row({ accountNumber: null });
    const otherPerson = row({ name: '王五', accountNumber: null });
    const hasOwnAccount = row({ accountNumber: 'z777' });
    const index = new DirectoryIndex([kept, stale, otherPerson, hasOwnAccount]);
    expect(classifyNameDuplicates(imp(), kept, kept, index)).toEqual({ merge: [stale], refused: [] });
  });

  it('部门不矛盾才删：空的、与导入行相同的、与保留行（更新前/后）相同的', () => {
    const kept = row({ accountNumber: 'z1', department: '无线' });
    const blank = row({ department: '' });
    const sameAsImport = row({ department: '无线' });
    const sameAsKeptBefore = row({ department: '旧部门' });
    const keptBefore = { ...kept, department: '旧部门' };
    const index = new DirectoryIndex([kept, blank, sameAsImport, sameAsKeptBefore]);
    const { merge, refused } = classifyNameDuplicates(imp({ department: '无线' }), kept, keptBefore, index);
    expect(merge).toEqual([blank, sameAsImport, sameAsKeptBefore]);
    expect(refused).toEqual([]);
  });

  it('同名但部门对不上 ⇒ 可能是另一个人，拒绝删除（这正是评审抓到的数据丢失）', () => {
    // 王伟/z84412632/无线 与历史遗留的 王伟//终端 —— 后者是另一个人
    const kept = row({ name: '王伟', accountNumber: 'z84412632', department: '无线' });
    const otherWangWei = row({ name: '王伟', accountNumber: null, department: '终端' });
    const index = new DirectoryIndex([kept, otherWangWei]);
    const { merge, refused } = classifyNameDuplicates(
      imp({ name: '王伟', accountNumber: 'z84412632', department: '无线' }),
      kept,
      kept,
      index,
    );
    expect(merge).toEqual([]);
    expect(refused).toEqual([otherWangWei]);
  });

  it('研究所对不上同样拒绝', () => {
    const kept = row({ accountNumber: 'z1', department: '无线', lab: '甲所' });
    const otherLab = row({ department: '无线', lab: '乙所' });
    const index = new DirectoryIndex([kept, otherLab]);
    const { merge, refused } = classifyNameDuplicates(imp({ department: '无线', lab: '甲所' }), kept, kept, index);
    expect(merge).toEqual([]);
    expect(refused).toEqual([otherLab]);
  });

  it('与 resolveImportTarget 保持一致：narrow() 判为另一个人的那条，绝不会被合并删掉', () => {
    const a = row({ name: '王伟', department: '无线' });
    const b = row({ name: '王伟', department: '终端' });
    const index = new DirectoryIndex([a, b]);
    const importRow = imp({ name: '王伟', accountNumber: 'z1', department: '无线' });
    const target = resolveImportTarget(importRow, index);
    expect(target).toMatchObject({ kind: 'update', entry: a }); // 选中了 无线 那条
    const after = { ...a, accountNumber: 'z1' };
    index.replace(a, after);
    // 于是 终端 那条必须留着
    expect(classifyNameDuplicates(importRow, after, a, index)).toEqual({ merge: [], refused: [b] });
  });
});

describe('applyImportFields', () => {
  const entry = row({ accountNumber: null, department: '旧部门', lab: '旧所', avatarUrl: '/a.png' });

  it('非空值覆盖，空值默认不动', () => {
    const changes = applyImportFields(
      entry,
      { name: '张三', accountNumber: 'z1', department: '新部门', lab: '', avatarUrl: '' },
      { backfillAccount: true, clearMissing: false },
    );
    expect(changes).toEqual({ accountNumber: 'z1', department: '新部门' });
  });

  it('clearMissing 时空值清空 部门/研究所/头像 —— 但工号永不清空', () => {
    const withAccount = row({ accountNumber: 'z1', department: '旧部门', lab: '旧所', avatarUrl: '/a.png' });
    const changes = applyImportFields(
      withAccount,
      { name: '张三', accountNumber: null, department: '', lab: '', avatarUrl: '' },
      { backfillAccount: false, clearMissing: true },
    );
    expect(changes).toEqual({ department: '', lab: '', avatarUrl: '' });
    expect(changes).not.toHaveProperty('accountNumber');
  });

  it('backfillAccount 为 false 时不写工号（哪怕导入行带了工号）', () => {
    const withAccount = row({ accountNumber: 'z1' });
    const changes = applyImportFields(
      withAccount,
      { name: '张三', accountNumber: 'z2', department: '', lab: '', avatarUrl: '' },
      { backfillAccount: false, clearMissing: false },
    );
    expect(changes).not.toHaveProperty('accountNumber');
  });

  it('字段完全一致时不产生任何改动', () => {
    expect(
      applyImportFields(
        entry,
        { name: entry.name, accountNumber: null, department: '旧部门', lab: '旧所', avatarUrl: '/a.png' },
        { backfillAccount: false, clearMissing: false },
      ),
    ).toEqual({});
  });

  it('姓名写法变了会被覆盖（保留导入的写法）', () => {
    expect(
      applyImportFields(
        entry,
        { name: '张 三', accountNumber: null, department: '', lab: '', avatarUrl: '' },
        { backfillAccount: false, clearMissing: false },
      ),
    ).toEqual({ name: '张 三' });
  });
});
