const { isLongLived, classifyMember } = require('../src/long-lived-logic');

const NOW = new Date('2026-04-23T00:00:00.000Z');

describe('isLongLived', () => {
    test('returns true when expires_at is null', () => {
        expect(isLongLived({ expires_at: null }, NOW)).toBe(true);
    });

    test('returns true when expires_at is undefined', () => {
        expect(isLongLived({}, NOW)).toBe(true);
    });

    test('returns true when expires_at is 366 days away', () => {
        expect(isLongLived({ expires_at: '2027-04-24' }, NOW)).toBe(true);
    });

    test('returns false when expires_at is exactly 365 days away', () => {
        expect(isLongLived({ expires_at: '2027-04-23' }, NOW)).toBe(false);
    });

    test('returns false when expires_at is 30 days away', () => {
        expect(isLongLived({ expires_at: '2026-05-23' }, NOW)).toBe(false);
    });

    test('returns false when expires_at is in the past', () => {
        expect(isLongLived({ expires_at: '2025-01-01' }, NOW)).toBe(false);
    });
});

describe('classifyMember', () => {
    test('returns permanent when expires_at is null', () => {
        expect(classifyMember({ expires_at: null }, NOW)).toBe('permanent');
    });

    test('returns permanent when expires_at is undefined', () => {
        expect(classifyMember({}, NOW)).toBe('permanent');
    });

    test('returns long-term when expires_at is more than 1 year away', () => {
        expect(classifyMember({ expires_at: '2028-01-01' }, NOW)).toBe('long-term');
    });

    test('returns active when expires_at is exactly 1 year away', () => {
        expect(classifyMember({ expires_at: '2027-04-23' }, NOW)).toBe('active');
    });

    test('returns active when expires_at is within 1 year', () => {
        expect(classifyMember({ expires_at: '2026-12-01' }, NOW)).toBe('active');
    });

    test('returns active when expires_at is in the past', () => {
        expect(classifyMember({ expires_at: '2025-01-01' }, NOW)).toBe('active');
    });
});
