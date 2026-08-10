const request = require('supertest');

// mock axios before requiring server
jest.mock('axios', () => {
    const mockInstance = {
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
    };
    return {
        create: jest.fn(() => mockInstance),
        _mockInstance: mockInstance,
    };
});

const axios = require('axios');
const mockApi = axios._mockInstance;

const app = require('../server');

beforeEach(() => {
    jest.clearAllMocks();
});

describe('POST /api/batch-extend-permissions', () => {
    test('returns 400 when items is missing', async () => {
        const res = await request(app)
            .post('/api/batch-extend-permissions')
            .send({ days: 30 });
        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
    });

    test('returns 400 when days is missing', async () => {
        const res = await request(app)
            .post('/api/batch-extend-permissions')
            .send({ items: [] });
        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
    });

    test('returns 400 when items is not an array', async () => {
        const res = await request(app)
            .post('/api/batch-extend-permissions')
            .send({ items: 'wrong', days: 30 });
        expect(res.status).toBe(400);
    });

    test('returns 400 when days is not a positive number', async () => {
        const res = await request(app)
            .post('/api/batch-extend-permissions')
            .send({ items: [], days: 0 });
        expect(res.status).toBe(400);
    });

    test('returns success with empty results for empty items array', async () => {
        const res = await request(app)
            .post('/api/batch-extend-permissions')
            .send({ items: [], days: 30 });
        expect(res.status).toBe(200);
        expect(res.body.results).toEqual([]);
        expect(res.body.errors).toEqual([]);
    });

    test('calls GitLab group members update API for group items', async () => {
        mockApi.put.mockResolvedValue({ data: {} });

        const res = await request(app)
            .post('/api/batch-extend-permissions')
            .send({
                items: [{
                    resource_type: 'group',
                    resource_id: 10,
                    user_id: 101,
                    username: 'alice',
                    access_level: 30,
                    expires_at: '2026-05-01',
                }],
                days: 30,
            });

        expect(res.status).toBe(200);
        expect(mockApi.put).toHaveBeenCalledWith(
            'groups/10/members/101',
            expect.objectContaining({
                access_level: 30,
                expires_at: '2026-05-31',
            })
        );
        expect(res.body.results).toHaveLength(1);
        expect(res.body.results[0].status).toBe('extended');
    });

    test('calls GitLab project members update API for project items', async () => {
        mockApi.put.mockResolvedValue({ data: {} });

        const res = await request(app)
            .post('/api/batch-extend-permissions')
            .send({
                items: [{
                    resource_type: 'project',
                    resource_id: 55,
                    user_id: 202,
                    username: 'bob',
                    access_level: 40,
                    expires_at: '2026-04-22',
                }],
                days: 60,
            });

        expect(res.status).toBe(200);
        expect(mockApi.put).toHaveBeenCalledWith(
            'projects/55/members/202',
            expect.objectContaining({ access_level: 40 })
        );
    });

    test('collects errors for failed items without stopping other updates', async () => {
        mockApi.put
            .mockResolvedValueOnce({ data: {} })
            .mockRejectedValueOnce(new Error('GitLab error'));

        const res = await request(app)
            .post('/api/batch-extend-permissions')
            .send({
                items: [
                    { resource_type: 'group', resource_id: 1, user_id: 1, username: 'alice', access_level: 30, expires_at: '2026-05-01' },
                    { resource_type: 'group', resource_id: 1, user_id: 2, username: 'bob', access_level: 20, expires_at: '2026-05-01' },
                ],
                days: 30,
            });

        expect(res.status).toBe(200);
        expect(res.body.results).toHaveLength(1);
        expect(res.body.errors).toHaveLength(1);
        expect(res.body.errors[0].username).toBe('bob');
    });
});
