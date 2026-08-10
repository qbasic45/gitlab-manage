const {
    computeNewExpiry,
    groupItemsByResource,
    buildExtendChanges,
} = require('../src/expiring-logic');

describe('computeNewExpiry', () => {
    test('adds days to expiry date correctly', () => {
        expect(computeNewExpiry('2026-05-01', 30)).toBe('2026-05-31');
    });

    test('handles month boundary correctly', () => {
        expect(computeNewExpiry('2026-01-31', 30)).toBe('2026-03-02');
    });

    test('handles year boundary correctly', () => {
        expect(computeNewExpiry('2026-12-15', 30)).toBe('2027-01-14');
    });

    test('returns YYYY-MM-DD format', () => {
        const result = computeNewExpiry('2026-04-22', 90);
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('throws on invalid date string', () => {
        expect(() => computeNewExpiry('not-a-date', 30)).toThrow();
    });

    test('throws on missing expiry', () => {
        expect(() => computeNewExpiry(null, 30)).toThrow();
    });
});

describe('groupItemsByResource', () => {
    test('groups multiple items from same group into one entry', () => {
        const items = [
            { resource_type: 'group', resource_id: 1, user_id: 101 },
            { resource_type: 'group', resource_id: 1, user_id: 102 },
        ];
        const grouped = groupItemsByResource(items);
        expect(grouped).toHaveLength(1);
        expect(grouped[0].items).toHaveLength(2);
    });

    test('separates items from different resources', () => {
        const items = [
            { resource_type: 'group', resource_id: 1, user_id: 101 },
            { resource_type: 'project', resource_id: 5, user_id: 101 },
            { resource_type: 'group', resource_id: 2, user_id: 102 },
        ];
        const grouped = groupItemsByResource(items);
        expect(grouped).toHaveLength(3);
    });

    test('preserves resource_type and resource_id on each group entry', () => {
        const items = [
            { resource_type: 'project', resource_id: 99, user_id: 1 },
        ];
        const grouped = groupItemsByResource(items);
        expect(grouped[0].resource_type).toBe('project');
        expect(grouped[0].resource_id).toBe(99);
    });

    test('returns empty array for empty input', () => {
        expect(groupItemsByResource([])).toEqual([]);
    });

    test('same resource_id but different resource_type are separate entries', () => {
        const items = [
            { resource_type: 'group', resource_id: 1, user_id: 101 },
            { resource_type: 'project', resource_id: 1, user_id: 102 },
        ];
        const grouped = groupItemsByResource(items);
        expect(grouped).toHaveLength(2);
    });
});

describe('buildExtendChanges', () => {
    test('builds update action for each item', () => {
        const items = [
            { user_id: 101, username: 'alice', access_level: 30, expires_at: '2026-04-30' },
            { user_id: 102, username: 'bob', access_level: 40, expires_at: '2026-04-25' },
        ];
        const changes = buildExtendChanges(items, 30);
        expect(changes).toHaveLength(2);
        expect(changes[0].action).toBe('update');
        expect(changes[1].action).toBe('update');
    });

    test('sets new expiry date based on current expiry plus days', () => {
        const items = [
            { user_id: 101, username: 'alice', access_level: 30, expires_at: '2026-05-01' },
        ];
        const changes = buildExtendChanges(items, 30);
        expect(changes[0].expires_at).toBe('2026-05-31');
    });

    test('preserves user_id, username, and access_level', () => {
        const items = [
            { user_id: 42, username: 'carol', access_level: 50, expires_at: '2026-04-30' },
        ];
        const changes = buildExtendChanges(items, 60);
        expect(changes[0].user_id).toBe(42);
        expect(changes[0].username).toBe('carol');
        expect(changes[0].access_level).toBe(50);
    });

    test('returns empty array for empty items', () => {
        expect(buildExtendChanges([], 30)).toEqual([]);
    });
});
