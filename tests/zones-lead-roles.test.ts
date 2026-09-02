import { describe, expect, it } from 'vitest';
import { buildLeadRoles, leadRoleOf } from '@/lib/zones/lead-roles';

describe('buildLeadRoles', () => {
  it('maps every moderator handle and the owner', () => {
    expect(buildLeadRoles('alice', ['bob', 'carol'])).toEqual({ alice: 'owner', bob: 'moderator', carol: 'moderator' });
  });

  it('owner wins when the owner also holds the moderator role', () => {
    expect(buildLeadRoles('alice', ['alice', 'bob'])).toEqual({ alice: 'owner', bob: 'moderator' });
  });

  it('ignores empty / blank handles and duplicates', () => {
    expect(buildLeadRoles('', ['', '  ', 'bob', 'bob'])).toEqual({ bob: 'moderator' });
    expect(buildLeadRoles('   ', [])).toEqual({});
  });

  it('compares handles exactly — never lowercased', () => {
    const leads = buildLeadRoles('Alice', ['Bob']);
    expect(leadRoleOf(leads, 'Alice')).toBe('owner');
    expect(leadRoleOf(leads, 'alice')).toBeNull();
    expect(leadRoleOf(leads, 'bob')).toBeNull();
  });

  it('carries only the role — no identity fields can ride along', () => {
    const leads = buildLeadRoles('alice', ['bob']);
    expect(Object.values(leads).every((v) => v === 'owner' || v === 'moderator')).toBe(true);
  });
});

describe('leadRoleOf', () => {
  const leads = buildLeadRoles('alice', ['bob']);

  it('answers the role for a lead and null for a stranger', () => {
    expect(leadRoleOf(leads, 'alice')).toBe('owner');
    expect(leadRoleOf(leads, 'bob')).toBe('moderator');
    expect(leadRoleOf(leads, 'dave')).toBeNull();
  });

  it('is null-safe for a missing map or handle', () => {
    expect(leadRoleOf(null, 'alice')).toBeNull();
    expect(leadRoleOf(undefined, 'alice')).toBeNull();
    expect(leadRoleOf(leads, '')).toBeNull();
  });

  it('never answers from the prototype chain', () => {
    expect(leadRoleOf(leads, 'toString')).toBeNull();
    expect(leadRoleOf(leads, '__proto__')).toBeNull();
    expect(leadRoleOf(leads, 'constructor')).toBeNull();
  });
});
