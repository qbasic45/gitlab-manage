const request = require('supertest');

jest.mock('axios', () => {
    const mockInstance = {
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
    };
    return { create: jest.fn(() => mockInstance), _mockInstance: mockInstance };
});

const axios = require('axios');
const mockApi = axios._mockInstance;
const app = require('../server');

beforeEach(() => jest.clearAllMocks());

function yearFromNow(years) {
    const d = new Date();
    d.setFullYear(d.getFullYear() + years);
    return d.toISOString().split('T')[0];
}

function daysFromNow(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

describe('GET /api/long-lived-permissions', () => {
    test('returns success:true with items array on happy path', async () => {
        mockApi.get.mockImplementation((url) => {
            if (url === 'groups') return Promise.resolve({ data: [{ id: 1, name: 'grp', full_path: 'grp' }] });
            if (url === 'groups/1/members') return Promise.resolve({ data: [] });
            if (url === 'projects') return Promise.resolve({ data: [] });
            return Promise.resolve({ data: [] });
        });

        const res = await request(app).get('/api/long-lived-permissions');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.items)).toBe(true);
        expect(typeof res.body.checked_groups).toBe('number');
        expect(typeof res.body.checked_projects).toBe('number');
    });

    test('includes members with expires_at null (permanent)', async () => {
        mockApi.get.mockImplementation((url) => {
            if (url === 'groups') return Promise.resolve({ data: [{ id: 1, name: 'grp', full_path: 'grp' }] });
            if (url === 'groups/1/members') return Promise.resolve({
                data: [{ id: 101, username: 'alice', name: 'Alice', access_level: 30, expires_at: null }]
            });
            if (url === 'projects') return Promise.resolve({ data: [] });
            return Promise.resolve({ data: [] });
        });

        const res = await request(app).get('/api/long-lived-permissions');
        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0].username).toBe('alice');
        expect(res.body.items[0].expires_at).toBeNull();
        expect(res.body.items[0].resource_type).toBe('group');
    });

    test('includes members with expires_at more than 1 year away', async () => {
        mockApi.get.mockImplementation((url) => {
            if (url === 'groups') return Promise.resolve({ data: [] });
            if (url === 'projects') return Promise.resolve({
                data: [{ id: 5, name: 'proj', path_with_namespace: 'ns/proj', web_url: 'http://x/proj' }]
            });
            if (url === 'projects/5/members') return Promise.resolve({
                data: [{ id: 202, username: 'bob', name: 'Bob', access_level: 40, expires_at: yearFromNow(2) }]
            });
            return Promise.resolve({ data: [] });
        });

        const res = await request(app).get('/api/long-lived-permissions');
        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0].username).toBe('bob');
        expect(res.body.items[0].resource_type).toBe('project');
    });

    test('excludes members with expires_at within 30 days', async () => {
        mockApi.get.mockImplementation((url) => {
            if (url === 'groups') return Promise.resolve({ data: [{ id: 1, name: 'grp', full_path: 'grp' }] });
            if (url === 'groups/1/members') return Promise.resolve({
                data: [{ id: 101, username: 'carol', name: 'Carol', access_level: 30, expires_at: daysFromNow(30) }]
            });
            if (url === 'projects') return Promise.resolve({ data: [] });
            return Promise.resolve({ data: [] });
        });

        const res = await request(app).get('/api/long-lived-permissions');
        expect(res.body.items).toHaveLength(0);
    });

    test('returns 500 when GitLab groups API fails', async () => {
        mockApi.get.mockRejectedValue(new Error('network error'));

        const res = await request(app).get('/api/long-lived-permissions');
        expect(res.status).toBe(500);
        expect(res.body.error).toBeDefined();
    });

    test('skips group whose members API fails and continues scanning', async () => {
        mockApi.get.mockImplementation((url) => {
            if (url === 'groups') return Promise.resolve({
                data: [
                    { id: 1, name: 'ok-group', full_path: 'ok-group' },
                    { id: 2, name: 'bad-group', full_path: 'bad-group' },
                ]
            });
            if (url === 'groups/1/members') return Promise.resolve({
                data: [{ id: 101, username: 'alice', name: 'Alice', access_level: 30, expires_at: null }]
            });
            if (url === 'groups/2/members') return Promise.reject(new Error('forbidden'));
            if (url === 'projects') return Promise.resolve({ data: [] });
            return Promise.resolve({ data: [] });
        });

        const res = await request(app).get('/api/long-lived-permissions');
        expect(res.status).toBe(200);
        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0].username).toBe('alice');
    });
});
