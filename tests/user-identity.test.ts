import { describe, expect, it } from 'vitest';
import { toPublicAuthor, toPublicAuthorOrNull } from '@/lib/user-identity';

const base = {
  handle: 'z0012345',
  displayName: '张三',
  avatarUrl: '/api/uploads/a.png',
  department: 'AI事业部',
  lab: '计算视觉所',
  isPrivate: false,
};

describe('toPublicAuthor', () => {
  it('passes department/lab through for public accounts', () => {
    expect(toPublicAuthor(base)).toEqual(base);
  });

  it('strips department/lab for private accounts when the viewer is not admin', () => {
    const out = toPublicAuthor({ ...base, isPrivate: true });
    expect(out).toEqual({ ...base, isPrivate: true, department: null, lab: null });
  });

  it('keeps department/lab for admins even when private', () => {
    const out = toPublicAuthor({ ...base, isPrivate: true }, true);
    expect(out.department).toBe('AI事业部');
    expect(out.lab).toBe('计算视觉所');
    expect(out.isPrivate).toBe(true);
  });

  it('normalizes empty strings to null and never leaks extra fields', () => {
    const out = toPublicAuthor({
      ...base,
      department: '',
      lab: '',
      // Simulate an over-selected row — extra fields must not pass through.
      ...({ id: 'u1', email: 'x@y.com' } as object),
    });
    expect(out.department).toBeNull();
    expect(out.lab).toBeNull();
    expect(Object.keys(out).sort()).toEqual([
      'avatarUrl', 'department', 'displayName', 'handle', 'isPrivate', 'lab',
    ]);
  });
});

describe('toPublicAuthorOrNull', () => {
  it('passes null/undefined through', () => {
    expect(toPublicAuthorOrNull(null)).toBeNull();
    expect(toPublicAuthorOrNull(undefined)).toBeNull();
  });
});
