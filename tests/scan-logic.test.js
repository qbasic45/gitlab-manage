const { scanMembers, createExpiringFilter, createLongLivedFilter } = require('../src/scan-logic');
const { isLongLived } = require('../src/long-lived-logic');

// Mock GitLab API client
function createMockGitlabApi(groupsData, projectsData, membersData) {
    return {
        get: jest.fn(async (url, options = {}) => {
            const params = options.params || {};
            const page = params.page || 1;
            
            // Handle groups endpoint
            if (url === 'groups') {
                const pageSize = params.per_page || 100;
                const start = (page - 1) * pageSize;
                const end = start + pageSize;
                return { data: groupsData.slice(start, end) };
            }
            
            // Handle projects endpoint
            if (url === 'projects') {
                const pageSize = params.per_page || 100;
                const start = (page - 1) * pageSize;
                const end = start + pageSize;
                return { data: projectsData.slice(start, end) };
            }
            
            // Handle group members endpoint
            const groupMembersMatch = url.match(/^groups\/(\d+)\/members$/);
            if (groupMembersMatch) {
                const groupId = parseInt(groupMembersMatch[1]);
                return { data: membersData.groups[groupId] || [] };
            }
            
            // Handle project members endpoint
            const projectMembersMatch = url.match(/^projects\/(\d+)\/members$/);
            if (projectMembersMatch) {
                const projectId = parseInt(projectMembersMatch[1]);
                return { data: membersData.projects[projectId] || [] };
            }
            
            return { data: [] };
        }),
    };
}

describe('createExpiringFilter', () => {
    const NOW = new Date('2026-04-23T00:00:00.000Z');
    
    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(NOW);
    });
    
    afterEach(() => {
        jest.useRealTimers();
    });
    
    test('returns false for members without expires_at', () => {
        const filter = createExpiringFilter(30);
        const member = { id: 1, username: 'alice', expires_at: null };
        expect(filter(member, 'group', {}, NOW)).toBe(false);
    });
    
    test('returns true for members expiring within the next 30 days', () => {
        const filter = createExpiringFilter(30);
        const member = { id: 1, username: 'alice', expires_at: '2026-05-10' };
        expect(filter(member, 'group', {}, NOW)).toBe(true);
    });
    
    test('returns false for members expiring after 30 days', () => {
        const filter = createExpiringFilter(30);
        const member = { id: 1, username: 'alice', expires_at: '2026-06-01' };
        expect(filter(member, 'group', {}, NOW)).toBe(false);
    });
    
    test('returns false for already expired members', () => {
        const filter = createExpiringFilter(30);
        const member = { id: 1, username: 'alice', expires_at: '2026-04-01' };
        expect(filter(member, 'group', {}, NOW)).toBe(false);
    });
    
    test('works with different day ranges', () => {
        const filter7 = createExpiringFilter(7);
        const filter60 = createExpiringFilter(60);
        
        const member15Days = { id: 1, username: 'alice', expires_at: '2026-05-08' };
        
        expect(filter7(member15Days, 'group', {}, NOW)).toBe(false);
        expect(filter60(member15Days, 'group', {}, NOW)).toBe(true);
    });
});

describe('createLongLivedFilter', () => {
    const NOW = new Date('2026-04-23T00:00:00.000Z');
    
    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(NOW);
    });
    
    afterEach(() => {
        jest.useRealTimers();
    });
    
    test('returns true for permanent members (expires_at is null)', () => {
        const filter = createLongLivedFilter();
        const member = { id: 1, username: 'alice', expires_at: null };
        expect(filter(member, 'group', {}, NOW)).toBe(true);
    });
    
    test('returns true for members with expires_at more than 1 year away', () => {
        const filter = createLongLivedFilter();
        const member = { id: 1, username: 'alice', expires_at: '2028-01-01' };
        expect(filter(member, 'group', {}, NOW)).toBe(true);
    });
    
    test('returns false for members with expires_at within 1 year', () => {
        const filter = createLongLivedFilter();
        const member = { id: 1, username: 'alice', expires_at: '2026-12-01' };
        expect(filter(member, 'group', {}, NOW)).toBe(false);
    });
});

describe('scanMembers', () => {
    test('scans groups and projects and returns statistics', async () => {
        const groups = [
            { id: 1, name: 'group1', full_path: 'group1' },
            { id: 2, name: 'group2', full_path: 'group2' },
        ];
        const projects = [
            { id: 10, name: 'proj1', path_with_namespace: 'ns/proj1', web_url: 'http://x/proj1' },
        ];
        const membersData = {
            groups: {
                1: [{ id: 101, username: 'alice', access_level: 30, expires_at: null }],
                2: [],
            },
            projects: {
                10: [{ id: 201, username: 'bob', access_level: 40, expires_at: '2028-01-01' }],
            },
        };
        
        const mockApi = createMockGitlabApi(groups, projects, membersData);
        const items = [];
        
        const result = await scanMembers(mockApi, createLongLivedFilter(), {
            onItem: (item) => items.push(item),
        });
        
        expect(result.count).toBe(2);
        expect(result.checked_groups).toBe(2);
        expect(result.checked_projects).toBe(1);
        expect(items).toHaveLength(2);
    });
    
    test('calls onProgress callback with progress updates', async () => {
        const groups = [{ id: 1, name: 'group1', full_path: 'group1' }];
        const projects = [];
        const membersData = { groups: { 1: [] }, projects: {} };
        
        const mockApi = createMockGitlabApi(groups, projects, membersData);
        const progressCalls = [];
        
        await scanMembers(mockApi, createLongLivedFilter(), {
            onProgress: (progress) => progressCalls.push(progress),
        });
        
        expect(progressCalls.length).toBeGreaterThan(0);
        expect(progressCalls[0]).toEqual({ percent: 0, message: '正在获取组列表...', found: 0 });
    });
    
    test('handles errors gracefully and continues scanning', async () => {
        const groups = [
            { id: 1, name: 'group1', full_path: 'group1' },
            { id: 2, name: 'group2', full_path: 'group2' },
        ];
        const projects = [];
        const membersData = {
            groups: {
                1: [{ id: 101, username: 'alice', access_level: 30, expires_at: null }],
                // Group 2 will cause an error
            },
            projects: {},
        };
        
        const mockApi = createMockGitlabApi(groups, projects, membersData);
        mockApi.get.mockImplementation(async (url) => {
            if (url === 'groups/2/members') {
                throw new Error('Forbidden');
            }
            // Default implementation for other calls
            const params = {};
            if (url === 'groups') {
                return { data: groups };
            }
            if (url === 'projects') {
                return { data: projects };
            }
            if (url === 'groups/1/members') {
                return { data: membersData.groups[1] };
            }
            return { data: [] };
        });
        
        const errors = [];
        const items = [];
        
        const result = await scanMembers(mockApi, createLongLivedFilter(), {
            onItem: (item) => items.push(item),
            onError: (error) => errors.push(error),
        });
        
        expect(result.checked_groups).toBe(2);
        expect(items).toHaveLength(1);
        expect(items[0].username).toBe('alice');
        expect(errors.some(e => e.type === 'group' && e.id === 2)).toBe(true);
    });
    
    test('respects abort signal', async () => {
        const groups = [{ id: 1, name: 'group1', full_path: 'group1' }];
        const projects = [];
        const membersData = { groups: { 1: [] }, projects: {} };
        
        const mockApi = createMockGitlabApi(groups, projects, membersData);
        const controller = new AbortController();
        
        // Abort immediately
        controller.abort();
        
        await expect(scanMembers(mockApi, createLongLivedFilter(), {
            signal: controller.signal,
        })).rejects.toThrow('Scan aborted');
    });
    
    test('collects all matching items from groups and projects', async () => {
        const groups = [{ id: 1, name: 'group1', full_path: 'group1' }];
        const projects = [{ id: 10, name: 'proj1', path_with_namespace: 'ns/proj1', web_url: 'http://x' }];
        const membersData = {
            groups: {
                1: [
                    { id: 101, username: 'alice', access_level: 30, expires_at: null },
                    { id: 102, username: 'bob', access_level: 20, expires_at: '2026-05-01' },
                ],
            },
            projects: {
                10: [
                    { id: 201, username: 'carol', access_level: 40, expires_at: null },
                ],
            },
        };
        
        const mockApi = createMockGitlabApi(groups, projects, membersData);
        const items = [];
        
        await scanMembers(mockApi, createLongLivedFilter(), {
            onItem: (item) => items.push(item),
        });
        
        // Should find alice (permanent) and carol (permanent), but not bob (expiring soon)
        expect(items).toHaveLength(2);
        expect(items.map(i => i.username)).toContain('alice');
        expect(items.map(i => i.username)).toContain('carol');
    });
    
    test('formats item data correctly for groups', async () => {
        const groups = [{ id: 5, name: 'test-group', full_path: 'parent/test-group' }];
        const projects = [];
        const membersData = {
            groups: {
                5: [{ id: 101, username: 'alice', name: 'Alice', access_level: 30, expires_at: null }],
            },
            projects: {},
        };
        
        const mockApi = createMockGitlabApi(groups, projects, membersData);
        const items = [];
        
        await scanMembers(mockApi, createLongLivedFilter(), {
            onItem: (item) => items.push(item),
        });
        
        expect(items[0]).toMatchObject({
            resource_type: 'group',
            resource_id: 5,
            resource_name: 'test-group',
            resource_path: 'parent/test-group',
            resource_url: null,
            user_id: 101,
            username: 'alice',
            access_level: 30,
            expires_at: null,
        });
    });
    
    test('formats item data correctly for projects', async () => {
        const groups = [];
        const projects = [{ id: 10, name: 'test-project', path_with_namespace: 'group/test-project', web_url: 'http://example.com' }];
        const membersData = {
            groups: {},
            projects: {
                10: [{ id: 201, username: 'bob', name: 'Bob', access_level: 40, expires_at: null }],
            },
        };
        
        const mockApi = createMockGitlabApi(groups, projects, membersData);
        const items = [];
        
        await scanMembers(mockApi, createLongLivedFilter(), {
            onItem: (item) => items.push(item),
        });
        
        expect(items[0]).toMatchObject({
            resource_type: 'project',
            resource_id: 10,
            resource_name: 'test-project',
            resource_path: 'group/test-project',
            resource_url: 'http://example.com',
            user_id: 201,
            username: 'bob',
            access_level: 40,
            expires_at: null,
        });
    });
});
