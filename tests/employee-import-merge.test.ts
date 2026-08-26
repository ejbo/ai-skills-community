// 端到端固化「重新上传要覆盖、不要造重复行」——用内存假库跑真实的 importEmployeeRows。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

interface Row {
  id: string;
  name: string;
  accountNumber: string | null;
  department: string;
  lab: string;
  avatarUrl: string;
  isActive: boolean;
  createdById: string | null;
  updatedAt: Date;
}

const db = vi.hoisted(() => {
  const state: { rows: any[]; users: { id: string; huaweiW3Id: string | null; department: string | null; lab: string | null }[]; seq: number; clock: number } = {
    rows: [],
    users: [],
    seq: 0,
    clock: 0,
  };
  const P2002 = (target: string) =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target },
    });
  const uniqueClash = (accountNumber: string | null | undefined, exceptId?: string) =>
    accountNumber != null && state.rows.some((r) => r.id !== exceptId && r.accountNumber === accountNumber);

  return {
    state,
    employeeDirectory: {
      findMany: vi.fn(async () =>
        [...state.rows].sort(
          (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id),
        ),
      ),
      findFirst: vi.fn(async ({ where }: any) =>
        state.rows.find((r) => r.accountNumber === where.accountNumber) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => {
        if (uniqueClash(data.accountNumber)) throw P2002('accountNumber');
        const row: Row = {
          id: `e${++state.seq}`,
          avatarUrl: '',
          isActive: true,
          createdById: null,
          ...data,
          updatedAt: new Date(1_700_000_000_000 + ++state.clock),
        };
        state.rows.push(row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        if ('accountNumber' in data && uniqueClash(data.accountNumber, row.id)) throw P2002('accountNumber');
        Object.assign(row, data, { updatedAt: new Date(1_700_000_000_000 + ++state.clock) });
        return { ...row };
      }),
      delete: vi.fn(async ({ where }: any) => {
        const at = state.rows.findIndex((r) => r.id === where.id);
        if (at < 0) throw new Error('not found');
        return state.rows.splice(at, 1)[0];
      }),
    },
    user: {
      findMany: vi.fn(async () => state.users.map((u) => ({ id: u.id, huaweiW3Id: u.huaweiW3Id }))),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const ids: string[] = where.id.in;
        let count = 0;
        for (const u of state.users) {
          if (ids.includes(u.id)) {
            u.department = data.department;
            u.lab = data.lab;
            count += 1;
          }
        }
        return { count };
      }),
    },
  };
});

vi.mock('@/lib/db', () => ({ prisma: db }));

import { importEmployeeRows } from '@/lib/employee-admin';

const line = (name: string, accountNumber = '', department = '', lab = '', avatarUrl = '') => ({
  name,
  accountNumber,
  department,
  lab,
  avatarUrl,
});

function seed(rows: Array<Partial<Row> & { name: string }>) {
  for (const r of rows) {
    db.state.rows.push({
      id: `seed${++db.state.seq}`,
      accountNumber: null,
      department: '',
      lab: '',
      avatarUrl: '',
      isActive: true,
      createdById: null,
      updatedAt: new Date(1_700_000_000_000 + ++db.state.clock),
      ...r,
    });
  }
}

const table = () =>
  db.state.rows
    .map((r) => ({ name: r.name, accountNumber: r.accountNumber, department: r.department, lab: r.lab }))
    .sort((a, b) => a.name.localeCompare(b.name) || String(a.accountNumber).localeCompare(String(b.accountNumber)));

beforeEach(() => {
  db.state.rows = [];
  db.state.users = [];
  db.state.seq = 0;
  db.state.clock = 0;
  vi.clearAllMocks();
});

describe('importEmployeeRows — 旧名单没工号，重新上传带工号', () => {
  it('更新旧行并回填工号，不产生任何重复行', async () => {
    seed([
      { name: '张三', department: 'AI事业部' },
      { name: '李四', department: '云核心网' },
      { name: '王五' },
    ]);

    const result = await importEmployeeRows(
      [
        line('张三', 'z84412632', '计算产品线', '昇腾所'),
        line('李四', 'Z10000002', '云核心网'),
        line('王五', '10000003'),
      ],
      'admin',
    );

    expect(result).toMatchObject({
      parsedRows: 3,
      added: 0,
      updated: 3,
      unchanged: 0,
      backfilledAccounts: 3,
      skipped: 0,
      mergedDuplicates: 0,
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(db.state.rows).toHaveLength(3);
    expect(table()).toEqual([
      { name: '张三', accountNumber: 'z84412632', department: '计算产品线', lab: '昇腾所' },
      { name: '李四', accountNumber: 'z10000002', department: '云核心网', lab: '' },
      { name: '王五', accountNumber: '10000003', department: '', lab: '' },
    ]);
  });

  it('再上传一次完全相同的文件 ⇒ 全部 unchanged，行数不变', async () => {
    seed([{ name: '张三', accountNumber: 'z84412632', department: '计算产品线' }]);
    const result = await importEmployeeRows([line('张三', 'z84412632', '计算产品线')], 'admin');
    expect(result).toMatchObject({ added: 0, updated: 0, unchanged: 1 });
    expect(db.state.rows).toHaveLength(1);
  });

  it('非空值覆盖旧值；留空的列默认保留原值', async () => {
    seed([{ name: '张三', accountNumber: 'z1', department: '旧部门', lab: '旧所' }]);
    await importEmployeeRows([line('张三', 'z1', '新部门')], 'admin');
    expect(table()).toEqual([{ name: '张三', accountNumber: 'z1', department: '新部门', lab: '旧所' }]);
  });

  it('clearMissing: 留空的列会被清空，但工号保留', async () => {
    seed([{ name: '张三', accountNumber: 'z1', department: '旧部门', lab: '旧所' }]);
    await importEmployeeRows([line('张三')], 'admin', { clearMissing: true });
    expect(table()).toEqual([{ name: '张三', accountNumber: 'z1', department: '', lab: '' }]);
  });
});

describe('importEmployeeRows — 清理历史重复', () => {
  it('默认保留同名无工号的旧行（只更新工号那条）', async () => {
    seed([
      { name: '张三', department: 'AI事业部' }, // 旧的、没工号
      { name: '张三', accountNumber: 'z84412632', department: '计算产品线' }, // 之前重复上传造出来的
    ]);
    const result = await importEmployeeRows([line('张三', 'z84412632', '昇腾计算')], 'admin');
    expect(result).toMatchObject({ updated: 1, added: 0, mergedDuplicates: 0 });
    expect(db.state.rows).toHaveLength(2);
  });

  it('mergeNameDuplicates: 删掉部门一致的同名无工号旧行，并逐条列出删了谁', async () => {
    seed([
      { name: '张三', department: '计算产品线' }, // 旧行：部门与工号行一致 ⇒ 同一个人
      { name: '张三', accountNumber: 'z84412632', department: '计算产品线' },
      { name: '李四' }, // 无关的人，不能被误删
    ]);
    const result = await importEmployeeRows([line('张三', 'z84412632', '昇腾计算')], 'admin', {
      mergeNameDuplicates: true,
    });
    expect(result).toMatchObject({ updated: 1, mergedDuplicates: 1 });
    expect(result.mergedRows).toEqual(['张三（计算产品线/—）']);
    expect(table()).toEqual([
      { name: '张三', accountNumber: 'z84412632', department: '昇腾计算', lab: '' },
      { name: '李四', accountNumber: null, department: '', lab: '' },
    ]);
  });

  it('mergeNameDuplicates: 同名但部门对不上的另一个人 ⇒ 不删，只告警', async () => {
    // 评审确认的高危场景：王伟/无线 的名单，不能顺手删掉 王伟/终端
    seed([
      { name: '王伟', accountNumber: 'z84412632', department: '无线' },
      { name: '王伟', department: '终端' }, // 另一个王伟，历史遗留、没工号
    ]);
    const result = await importEmployeeRows([line('王伟', 'z84412632', '无线')], 'admin', {
      mergeNameDuplicates: true,
    });
    expect(result).toMatchObject({ mergedDuplicates: 0, unchanged: 1 });
    expect(result.mergedRows).toEqual([]);
    expect(result.warnings.join()).toContain('未删除');
    expect(db.state.rows).toHaveLength(2);
  });

  it('mergeNameDuplicates: 部门为空的旧行视为同一人，可以删', async () => {
    seed([
      { name: '张三' }, // 只有名字的历史行
      { name: '张三', accountNumber: 'z1', department: '计算产品线' },
    ]);
    const result = await importEmployeeRows([line('张三', 'z1', '计算产品线')], 'admin', {
      mergeNameDuplicates: true,
    });
    expect(result).toMatchObject({ mergedDuplicates: 1 });
    expect(db.state.rows).toHaveLength(1);
  });

  it('工号是权威：命中的行即使姓名不同也会被改名（名单里工号对应的就是这个人）', async () => {
    seed([{ name: '李四', accountNumber: 'z84412632', department: 'AI事业部' }]);
    const result = await importEmployeeRows([line('张三', '84412632', '计算产品线')], 'admin');
    expect(result).toMatchObject({ added: 0, updated: 1, backfilledAccounts: 0 });
    // 工号写法保持库里原样（只按数字匹配），姓名/部门被新文件覆盖
    expect(table()).toEqual([{ name: '张三', accountNumber: 'z84412632', department: '计算产品线', lab: '' }]);
  });

  it('回填工号时撞上并发插入的同工号行 ⇒ 放弃写工号、保留其它更新并告警', async () => {
    seed([{ name: '张三', department: 'AI事业部' }]);
    // 索引建好之后、update 之前，另一个导入插进了同工号的行（唯一索引才会报 P2002）。
    db.employeeDirectory.update.mockImplementationOnce(async () => {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: 'accountNumber' },
      });
    });

    const result = await importEmployeeRows([line('张三', 'z84412632', '计算产品线')], 'admin');

    expect(result.warnings.join()).toContain('已属于另一条记录');
    expect(result).toMatchObject({ updated: 1, added: 0 });
    // 工号没写进去，但部门这次的更新保住了
    expect(table()).toEqual([{ name: '张三', accountNumber: null, department: '计算产品线', lab: '' }]);
  });
});

describe('importEmployeeRows — 歧义不猜', () => {
  it('同名多条无工号、无法用部门区分：带工号的行新建并告警', async () => {
    seed([{ name: '张三' }, { name: '张三' }]);
    const result = await importEmployeeRows([line('张三', 'z1')], 'admin');
    expect(result).toMatchObject({ added: 1, updated: 0, skipped: 0 });
    expect(result.warnings.join()).toContain('请人工核对合并');
    expect(db.state.rows).toHaveLength(3);
  });

  it('同名多条、本行没有工号：跳过而不是再加一条重复', async () => {
    seed([{ name: '张三', accountNumber: 'z1' }, { name: '张三', accountNumber: 'z2' }]);
    const result = await importEmployeeRows([line('张三', '', '新部门')], 'admin');
    expect(result).toMatchObject({ added: 0, updated: 0, skipped: 1 });
    expect(result.warnings.join()).toContain('已跳过');
    expect(db.state.rows).toHaveLength(2);
  });

  it('同名但部门能区分 ⇒ 正常回填，不算歧义', async () => {
    seed([
      { name: '张三', department: 'AI事业部' },
      { name: '张三', department: '云核心网' },
    ]);
    const result = await importEmployeeRows([line('张三', 'z1', '云核心网', '网络所')], 'admin');
    expect(result).toMatchObject({ added: 0, updated: 1, backfilledAccounts: 1 });
    expect(table()).toEqual([
      { name: '张三', accountNumber: null, department: 'AI事业部', lab: '' },
      { name: '张三', accountNumber: 'z1', department: '云核心网', lab: '网络所' },
    ]);
  });
});

describe('importEmployeeRows — 其它不变量', () => {
  it('姓名为空的行进 errors，不影响其它行', async () => {
    const result = await importEmployeeRows([line(''), line('张三', 'z1')], 'admin');
    expect(result.errors).toHaveLength(1);
    expect(result.added).toBe(1);
  });

  it('同一个文件里重复出现同一人 ⇒ 只有一条记录', async () => {
    const result = await importEmployeeRows(
      [line('张三', 'z84412632', 'A'), line('张三', '84412632', 'B')],
      'admin',
    );
    expect(result).toMatchObject({ added: 1, updated: 1 });
    expect(db.state.rows).toHaveLength(1);
    expect(table()).toEqual([{ name: '张三', accountNumber: 'z84412632', department: 'B', lab: '' }]);
  });

  it('导入后按工号把部门/研究所推给已注册用户（数字匹配）', async () => {
    db.state.users.push({ id: 'u1', huaweiW3Id: '84412632', department: null, lab: null });
    const result = await importEmployeeRows([line('张三', 'z84412632', '计算产品线', '昇腾所')], 'admin');
    expect(result.syncedUsers).toBe(1);
    expect(db.state.users[0]).toMatchObject({ department: '计算产品线', lab: '昇腾所' });
  });

  it('停用的行会被更新，但不会被导入重新启用，也不同步用户', async () => {
    db.state.users.push({ id: 'u1', huaweiW3Id: '84412632', department: null, lab: null });
    seed([{ name: '张三', accountNumber: 'z84412632', isActive: false }]);
    const result = await importEmployeeRows([line('张三', 'z84412632', '计算产品线')], 'admin');
    expect(result).toMatchObject({ updated: 1, syncedUsers: 0 });
    expect(db.state.rows[0].isActive).toBe(false);
    expect(db.state.users[0].department).toBeNull();
  });
});
