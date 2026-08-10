# 长期权限查看页面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th nav page (permanent.html) listing GitLab members with permanent or >1-year permissions, with per-row and batch expiry-date setting.

**Architecture:** Pure filter functions in `src/long-lived-logic.js` (unit-tested), new `GET /api/long-lived-permissions` endpoint in `server.js` (integration-tested), frontend page `public/permanent.html` that reuses existing update endpoints.

**Tech Stack:** Node.js + Express 5, Axios, Jest + supertest, vanilla HTML/CSS/JS

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/long-lived-logic.js` | `isLongLived(member, now)`, `classifyMember(member)` |
| Create | `tests/long-lived-logic.test.js` | Unit tests for filter functions |
| Create | `tests/server-long-lived.test.js` | Integration tests for new API endpoint |
| Modify | `server.js` | Add `GET /api/long-lived-permissions` endpoint + require |
| Create | `public/permanent.html` | New frontend page |
| Modify | `public/index.html` | Add ♾️ 长期权限 nav item |
| Modify | `public/projects.html` | Add ♾️ 长期权限 nav item |
| Modify | `public/expiring.html` | Add ♾️ 长期权限 nav item |

---

## Task 1: Filter Logic Module (TDD)

**Files:**
- Create: `src/long-lived-logic.js`
- Create: `tests/long-lived-logic.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/long-lived-logic.test.js`:

```javascript
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
        expect(classifyMember({ expires_at: null })).toBe('permanent');
    });

    test('returns permanent when expires_at is undefined', () => {
        expect(classifyMember({})).toBe('permanent');
    });

    test('returns long-term when expires_at is a date string', () => {
        expect(classifyMember({ expires_at: '2028-01-01' })).toBe('long-term');
    });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd D:/workspace/git-user/web-tool
npm test -- --testPathPattern=long-lived-logic
```

Expected: FAIL — `Cannot find module '../src/long-lived-logic'`

- [ ] **Step 3: Implement the module**

Create `src/long-lived-logic.js`:

```javascript
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function isLongLived(member, now) {
    if (!member.expires_at) return true;
    return new Date(member.expires_at) > new Date(now.getTime() + ONE_YEAR_MS);
}

function classifyMember(member) {
    if (!member.expires_at) return 'permanent';
    return 'long-term';
}

module.exports = { isLongLived, classifyMember };
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- --testPathPattern=long-lived-logic
```

Expected: PASS — 9 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/long-lived-logic.js tests/long-lived-logic.test.js
git commit -m "feat: add long-lived permission filter logic with tests"
```

---

## Task 2: API Endpoint (TDD)

**Files:**
- Create: `tests/server-long-lived.test.js`
- Modify: `server.js` (add require + new endpoint before `module.exports = app`)

- [ ] **Step 1: Write the failing integration tests**

Create `tests/server-long-lived.test.js`:

```javascript
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

// Helper: compute a date string N years from now
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

    test('skips group whose members API fails and continues', async () => {
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
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- --testPathPattern=server-long-lived
```

Expected: FAIL — endpoint returns 404

- [ ] **Step 3: Add the endpoint to server.js**

In `server.js`, find the line:
```javascript
const { computeNewExpiry } = require('./src/expiring-logic');
```

Add immediately after it:
```javascript
const { isLongLived } = require('./src/long-lived-logic');
```

Then find the line `if (require.main === module) {` and insert the new endpoint **before** it:

```javascript
// API: 获取长期有效权限（永久或有效期超1年）
app.get('/api/long-lived-permissions', async (req, res) => {
    try {
        const now = new Date();
        const items = [];
        const CONCURRENCY = 5;

        // 1. 获取所有组（分页）
        const allGroups = [];
        let page = 1;
        while (true) {
            const resp = await gitlabApi.get('groups', {
                params: { per_page: 100, page, all_available: true }
            });
            if (resp.data.length === 0) break;
            allGroups.push(...resp.data);
            if (resp.data.length < 100) break;
            page++;
        }

        // 2. 并发获取各组直接成员，过滤长期有效的
        for (let i = 0; i < allGroups.length; i += CONCURRENCY) {
            const batch = allGroups.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async (group) => {
                try {
                    const resp = await gitlabApi.get(`groups/${group.id}/members`, {
                        params: { per_page: 100 }
                    });
                    resp.data.forEach(member => {
                        if (isLongLived(member, now)) {
                            items.push({
                                resource_type: 'group',
                                resource_id: group.id,
                                resource_name: group.name,
                                resource_path: group.full_path,
                                resource_url: null,
                                user_id: member.id,
                                username: member.username,
                                name: member.name,
                                access_level: member.access_level,
                                expires_at: member.expires_at || null,
                            });
                        }
                    });
                } catch (e) {
                    console.warn(`获取组 ${group.id} 成员失败:`, e.message);
                }
            }));
        }

        // 3. 获取所有项目（分页）
        const allProjects = [];
        page = 1;
        while (true) {
            const resp = await gitlabApi.get('projects', {
                params: { per_page: 100, page, membership: true, simple: true }
            });
            if (resp.data.length === 0) break;
            allProjects.push(...resp.data);
            if (resp.data.length < 100) break;
            page++;
        }

        // 4. 并发获取各项目直接成员，过滤长期有效的
        for (let i = 0; i < allProjects.length; i += CONCURRENCY) {
            const batch = allProjects.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async (project) => {
                try {
                    const resp = await gitlabApi.get(`projects/${project.id}/members`, {
                        params: { per_page: 100 }
                    });
                    resp.data.forEach(member => {
                        if (isLongLived(member, now)) {
                            items.push({
                                resource_type: 'project',
                                resource_id: project.id,
                                resource_name: project.name,
                                resource_path: project.path_with_namespace,
                                resource_url: project.web_url,
                                user_id: member.id,
                                username: member.username,
                                name: member.name,
                                access_level: member.access_level,
                                expires_at: member.expires_at || null,
                            });
                        }
                    });
                } catch (e) {
                    console.warn(`获取项目 ${project.id} 成员失败:`, e.message);
                }
            }));
        }

        // 永久权限排前，同类按资源名升序
        items.sort((a, b) => {
            if (!a.expires_at && b.expires_at) return -1;
            if (a.expires_at && !b.expires_at) return 1;
            return a.resource_name.localeCompare(b.resource_name);
        });

        res.json({
            success: true,
            items,
            count: items.length,
            checked_groups: allGroups.length,
            checked_projects: allProjects.length,
        });
    } catch (error) {
        console.error('获取长期权限失败:', error.message);
        res.status(500).json({ error: error.message });
    }
});
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- --testPathPattern=server-long-lived
```

Expected: PASS — 6 tests pass

- [ ] **Step 5: Run full test suite to check no regressions**

```bash
npm test
```

Expected: all existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/long-lived-logic.js server.js tests/server-long-lived.test.js
git commit -m "feat: add GET /api/long-lived-permissions endpoint"
```

---

## Task 3: Update Navigation on Existing Pages

**Files:**
- Modify: `public/index.html`
- Modify: `public/projects.html`
- Modify: `public/expiring.html`

- [ ] **Step 1: Update index.html nav**

In `public/index.html`, find:
```html
        <a href="expiring.html">⏰ 即将过期</a>
    </div>
```

Replace with:
```html
        <a href="expiring.html">⏰ 即将过期</a>
        <a href="permanent.html">♾️ 长期权限</a>
    </div>
```

- [ ] **Step 2: Update projects.html nav**

In `public/projects.html`, find:
```html
        <a href="expiring.html">⏰ 即将过期</a>
    </div>
```

Replace with:
```html
        <a href="expiring.html">⏰ 即将过期</a>
        <a href="permanent.html">♾️ 长期权限</a>
    </div>
```

- [ ] **Step 3: Update expiring.html nav**

In `public/expiring.html`, find:
```html
        <a href="expiring.html" class="active">⏰ 即将过期</a>
    </div>
```

Replace with:
```html
        <a href="expiring.html" class="active">⏰ 即将过期</a>
        <a href="permanent.html">♾️ 长期权限</a>
    </div>
```

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/projects.html public/expiring.html
git commit -m "feat: add 长期权限 nav link to all existing pages"
```

---

## Task 4: Create Frontend Page

**Files:**
- Create: `public/permanent.html`

- [ ] **Step 1: Create permanent.html**

Create `public/permanent.html` with the full content below:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GitLab 长期权限</title>
    <style>
        :root {
            --primary: #0ea5e9; --primary-hover: #0284c7; --primary-light: #e0f2fe;
            --primary-border: #bae6fd; --success: #10b981; --success-hover: #059669;
            --warning: #f59e0b; --danger: #ef4444; --secondary: #64748b;
            --bg-body: #f0f9ff; --bg-surface: #ffffff; --text-main: #0f172a;
            --text-muted: #64748b; --border-color: #e2e8f0; --radius-lg: 16px;
            --radius-md: 10px; --radius-sm: 6px;
            --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
            --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.04);
            --shadow-lg: 0 10px 15px -3px rgb(14 165 233 / 0.05), 0 4px 6px -4px rgb(14 165 233 / 0.05);
        }
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: var(--bg-body); color: var(--text-main); margin: 0; padding: 40px 20px; min-height: 100vh; }
        .container { max-width: 1400px; margin: 0 auto; background: var(--bg-surface); padding: 40px; border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); border: 1px solid rgba(255,255,255,0.6); }
        h1 { text-align: center; color: var(--text-main); font-size: 32px; font-weight: 800; margin: 0 0 8px 0; letter-spacing: -0.025em; }
        .subtitle { text-align: center; color: var(--text-muted); font-size: 15px; margin-bottom: 32px; }
        .nav { display: flex; margin-bottom: 30px; background: #f8fafc; padding: 6px; border-radius: 12px; border: 1px solid var(--border-color); max-width: 800px; margin-left: auto; margin-right: auto; }
        .nav a { flex: 1; text-align: center; padding: 12px 16px; text-decoration: none; color: var(--text-muted); border-radius: var(--radius-md); font-weight: 500; font-size: 14px; transition: all 0.2s ease; }
        .nav a:hover { color: var(--text-main); background: var(--bg-surface); }
        .nav a.active { background: var(--bg-surface); color: var(--primary); font-weight: 600; box-shadow: var(--shadow-sm); }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .stat-card { background: var(--bg-surface); border: 1px solid var(--border-color); padding: 20px 24px; border-radius: var(--radius-md); box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s; }
        .stat-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
        .stat-card h4 { margin: 0 0 6px 0; font-size: 13px; color: var(--text-muted); font-weight: 500; }
        .stat-card .number { font-size: 32px; font-weight: 800; }
        .stat-card:nth-child(1) .number { color: var(--text-main); }
        .stat-card:nth-child(2) .number { color: var(--primary); }
        .stat-card:nth-child(3) .number { color: var(--success); }
        .stat-card:nth-child(4) .number { color: var(--secondary); }
        .filter-bar { display: flex; gap: 12px; margin-bottom: 24px; background: #f8fafc; padding: 16px; border-radius: var(--radius-md); border: 1px solid var(--border-color); flex-wrap: wrap; align-items: center; }
        .filter-bar input, .filter-bar select { padding: 10px 16px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: 14px; background: white; color: var(--text-main); transition: border-color 0.2s; }
        .filter-bar input:focus, .filter-bar select:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(14,165,233,0.15); }
        .filter-bar input { flex: 2; min-width: 200px; }
        .filter-bar select { flex: 1; min-width: 140px; cursor: pointer; }
        button { padding: 10px 20px; background: var(--primary); color: white; border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s ease; box-shadow: var(--shadow-sm); display: inline-flex; align-items: center; gap: 6px; }
        button:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
        button:active { transform: translateY(0); }
        button.success { background: var(--success); }
        button.success:hover { background: var(--success-hover); }
        button.secondary { background: var(--secondary); }
        button.sm { padding: 5px 12px; font-size: 13px; }
        button:disabled { background: var(--border-color); color: var(--text-muted); box-shadow: none; cursor: not-allowed; transform: none; }
        .table-wrapper { border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; background: white; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 14px 16px; text-align: left; border-bottom: 1px solid var(--border-color); vertical-align: middle; word-wrap: break-word; overflow-wrap: break-word; }
        th { background: #f8fafc; font-weight: 600; font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
        tr:last-child td { border-bottom: none; }
        tr { transition: background 0.15s; }
        tr:hover { background: var(--bg-body); }
        .permission-tag { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; white-space: nowrap; }
        .perm-owner { background: #fee2e2; color: #b91c1c; }
        .perm-maintainer { background: #fef3c7; color: #b45309; }
        .perm-developer { background: #d1fae5; color: #047857; }
        .perm-reporter { background: #e0f2fe; color: #0369a1; }
        .perm-guest { background: #f1f5f9; color: #475569; }
        .type-badge { display: inline-block; padding: 3px 8px; border-radius: 5px; font-size: 11px; font-weight: 600; white-space: nowrap; }
        .type-group { background: #ede9fe; color: #6d28d9; }
        .type-project { background: #dcfce7; color: #166534; }
        .class-badge { display: inline-block; padding: 3px 8px; border-radius: 5px; font-size: 11px; font-weight: 600; white-space: nowrap; }
        .class-permanent { background: #e0f2fe; color: #0369a1; }
        .class-long-term { background: #fef3c7; color: #b45309; }
        .resource-name { font-weight: 600; color: var(--text-main); }
        .resource-path { color: var(--text-muted); font-size: 12px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px; }
        .bulk-bar { display: none; align-items: center; gap: 12px; padding: 12px 16px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: var(--radius-md); margin-bottom: 12px; flex-wrap: wrap; }
        .bulk-bar.visible { display: flex; }
        .bulk-bar .selected-count { font-size: 14px; font-weight: 600; color: #1d4ed8; flex: 1; }
        .bulk-bar input[type="date"] { padding: 7px 10px; font-size: 13px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: white; cursor: pointer; }
        .col-check { width: 40px; text-align: center; }
        input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; accent-color: var(--primary); }
        .set-form { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .set-form input[type="date"] { padding: 5px 8px; font-size: 12px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: white; cursor: pointer; color: var(--text-main); }
        .set-form input[type="date"]:focus { outline: none; border-color: var(--primary); }
        .loading-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
        .loading-state .spinner { display: inline-block; width: 36px; height: 36px; border: 3px solid var(--border-color); border-top-color: var(--primary); border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); font-size: 15px; }
        #result { margin-top: 20px; padding: 14px 18px; border-radius: var(--radius-sm); display: none; font-size: 14px; font-weight: 500; }
        .success-msg { background: #ecfdf5; color: #065f46; border: 1px solid #10b981; }
        .error-msg { background: #fef2f2; color: #991b1b; border: 1px solid #ef4444; }
        @media (max-width: 768px) { body { padding: 16px 8px; } .container { padding: 20px 12px; } .stats { grid-template-columns: repeat(2, 1fr); } th, td { padding: 10px 8px; font-size: 12px; } .filter-bar { flex-direction: column; } }
    </style>
</head>
<body>
<div class="container">
    <h1>GitLab 长期权限</h1>
    <p class="subtitle">展示永久权限及有效期超过1年的权限，支持设置到期时间</p>

    <div class="nav">
        <a href="index.html">👥 用户管理</a>
        <a href="projects.html">🛡️ 项目权限</a>
        <a href="expiring.html">⏰ 即将过期</a>
        <a href="permanent.html" class="active">♾️ 长期权限</a>
    </div>

    <div class="stats">
        <div class="stat-card"><h4>长期权限总数</h4><div class="number" id="totalCount">-</div></div>
        <div class="stat-card"><h4>永久权限</h4><div class="number" id="permanentCount">-</div></div>
        <div class="stat-card"><h4>超1年权限</h4><div class="number" id="longTermCount">-</div></div>
        <div class="stat-card"><h4>已检查 组 / 项目</h4><div class="number" id="checkedCount">-</div></div>
    </div>

    <div class="filter-bar">
        <select id="classFilter" onchange="applyFilters()">
            <option value="">所有类型</option>
            <option value="permanent">永久权限</option>
            <option value="long-term">超1年权限</option>
        </select>
        <select id="typeFilter" onchange="applyFilters()">
            <option value="">所有资源</option>
            <option value="group">组</option>
            <option value="project">项目</option>
        </select>
        <input type="text" id="searchInput" placeholder="搜索用户名或资源名..." oninput="applyFilters()">
        <button onclick="loadLongLivedPermissions()">刷新数据</button>
    </div>

    <div class="bulk-bar" id="bulkBar">
        <span class="selected-count" id="bulkCount">已选择 0 项</span>
        <input type="date" id="bulkDate">
        <button class="success" id="bulkSetBtn" onclick="batchSetExpiry()">批量设置到期时间</button>
        <button class="secondary" onclick="clearSelection()">清除选择</button>
    </div>

    <div id="loadingState" class="loading-state" style="display: none;">
        <div class="spinner"></div>
        <p style="margin: 0 0 8px 0; font-size: 15px; font-weight: 500;">正在扫描权限，请稍候...</p>
        <p style="margin: 0; font-size: 13px; color: #94a3b8;">首次加载可能需要数十秒</p>
    </div>

    <div id="tableContainer" style="display: none;">
        <div class="table-wrapper">
            <table>
                <thead>
                    <tr>
                        <th class="col-check"><input type="checkbox" id="selectAll" onchange="toggleSelectAll(this.checked)" title="全选"></th>
                        <th style="width:80px;">分类</th>
                        <th style="width:140px;">用户名</th>
                        <th style="width:110px;">权限级别</th>
                        <th style="width:56px;">类型</th>
                        <th>资源名称</th>
                        <th style="width:110px;">有效期</th>
                        <th style="width:230px;">操作</th>
                    </tr>
                </thead>
                <tbody id="tableBody"></tbody>
            </table>
        </div>
    </div>
    <div id="result"></div>
</div>

<script>
    let allItems = [];
    let filteredItems = [];
    let selectedKeys = new Set();

    function getItemKey(item) { return `${item.resource_type}-${item.resource_id}-${item.user_id}`; }

    function toggleItemSelection(key, checked) {
        if (checked) selectedKeys.add(key); else selectedKeys.delete(key);
        updateBulkBar(); updateSelectAllState();
    }

    function toggleSelectAll(checked) {
        for (const item of filteredItems) {
            const key = getItemKey(item);
            if (checked) selectedKeys.add(key); else selectedKeys.delete(key);
        }
        document.querySelectorAll('.row-check').forEach(cb => { cb.checked = checked; });
        updateBulkBar();
    }

    function clearSelection() {
        selectedKeys.clear();
        document.querySelectorAll('.row-check').forEach(cb => { cb.checked = false; });
        const sa = document.getElementById('selectAll');
        if (sa) sa.checked = false;
        updateBulkBar();
    }

    function updateSelectAllState() {
        const sa = document.getElementById('selectAll');
        if (!sa || filteredItems.length === 0) return;
        const allChecked = filteredItems.every(item => selectedKeys.has(getItemKey(item)));
        sa.checked = allChecked;
        sa.indeterminate = !allChecked && filteredItems.some(item => selectedKeys.has(getItemKey(item)));
    }

    function updateBulkBar() {
        const count = selectedKeys.size;
        const bar = document.getElementById('bulkBar');
        if (count > 0) { bar.classList.add('visible'); document.getElementById('bulkCount').textContent = `已选择 ${count} 项`; }
        else bar.classList.remove('visible');
    }

    loadLongLivedPermissions();

    async function loadLongLivedPermissions() {
        const ls = document.getElementById('loadingState');
        const tc = document.getElementById('tableContainer');
        ls.style.display = 'block'; tc.style.display = 'none';
        allItems = []; resetStats();
        try {
            const response = await fetch('/api/long-lived-permissions');
            const data = await response.json();
            ls.style.display = 'none';
            if (data.success) {
                allItems = data.items || [];
                updateStats(allItems, data.checked_groups, data.checked_projects);
                applyFilters(); tc.style.display = 'block';
            } else { showResult('error-msg', '加载失败: ' + (data.error || '未知错误')); }
        } catch (e) { ls.style.display = 'none'; showResult('error-msg', '请求失败: ' + e.message); }
    }

    function resetStats() {
        ['totalCount','permanentCount','longTermCount','checkedCount'].forEach(id => { document.getElementById(id).textContent = '-'; });
    }

    function updateStats(items, checkedGroups, checkedProjects) {
        document.getElementById('totalCount').textContent = items.length;
        document.getElementById('permanentCount').textContent = items.filter(i => !i.expires_at).length;
        document.getElementById('longTermCount').textContent = items.filter(i => i.expires_at).length;
        document.getElementById('checkedCount').textContent = (checkedGroups !== undefined && checkedProjects !== undefined) ? `${checkedGroups} / ${checkedProjects}` : '-';
    }

    function applyFilters() {
        const cf = document.getElementById('classFilter').value;
        const tf = document.getElementById('typeFilter').value;
        const search = document.getElementById('searchInput').value.toLowerCase().trim();
        filteredItems = allItems.filter(item => {
            const itemClass = item.expires_at ? 'long-term' : 'permanent';
            if (cf && itemClass !== cf) return false;
            if (tf && item.resource_type !== tf) return false;
            if (search) {
                const hay = [item.username, item.name, item.resource_name, item.resource_path].join(' ').toLowerCase();
                if (!hay.includes(search)) return false;
            }
            return true;
        });
        for (const key of [...selectedKeys]) { if (!filteredItems.some(item => getItemKey(item) === key)) selectedKeys.delete(key); }
        updateBulkBar(); renderTable(filteredItems);
    }

    function renderTable(items) {
        const tbody = document.getElementById('tableBody');
        document.getElementById('tableContainer').style.display = 'block';
        if (items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state">暂无长期权限记录</div></td></tr>';
            updateSelectAllState(); return;
        }
        const today = new Date();
        const defaultDate = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
        const defaultDateStr = formatDate(defaultDate);
        tbody.innerHTML = items.map((item, idx) => {
            const itemClass = item.expires_at ? 'long-term' : 'permanent';
            const classText = item.expires_at ? '超1年' : '永久';
            const classCss = item.expires_at ? 'class-long-term' : 'class-permanent';
            const permClass = getPermClass(item.access_level);
            const permText = getPermText(item.access_level);
            const typeClass = item.resource_type === 'group' ? 'type-group' : 'type-project';
            const typeText = item.resource_type === 'group' ? '组' : '项目';
            const expiryDisplay = item.expires_at ? formatDate(item.expires_at) : '永久';
            const nameDisplay = item.resource_url
                ? `<a href="${escapeHtml(item.resource_url)}" target="_blank" class="resource-name" style="color:var(--primary);text-decoration:none;">${escapeHtml(item.resource_name)}</a>`
                : `<span class="resource-name">${escapeHtml(item.resource_name)}</span>`;
            const inputId = `date-${idx}`;
            const itemKey = getItemKey(item);
            return `<tr>
                <td class="col-check"><input type="checkbox" class="row-check" data-key="${escapeHtml(itemKey)}" ${selectedKeys.has(itemKey) ? 'checked' : ''} onchange="toggleItemSelection('${escapeHtml(itemKey)}', this.checked)"></td>
                <td><span class="class-badge ${classCss}">${classText}</span></td>
                <td><strong>${escapeHtml(item.username)}</strong>${item.name && item.name !== item.username ? `<div style="font-size:12px;color:var(--text-muted);">${escapeHtml(item.name)}</div>` : ''}</td>
                <td><span class="permission-tag ${permClass}">${permText}</span></td>
                <td><span class="type-badge ${typeClass}">${typeText}</span></td>
                <td>${nameDisplay}<div class="resource-path" title="${escapeHtml(item.resource_path)}">${escapeHtml(item.resource_path)}</div></td>
                <td style="font-size:13px;white-space:nowrap;">${expiryDisplay}</td>
                <td><div class="set-form">
                    <input type="date" id="${inputId}" value="${defaultDateStr}">
                    <button class="sm success" onclick="setExpiry('${item.resource_type}',${item.resource_id},${item.user_id},'${escapeHtml(item.username)}',${item.access_level},'${inputId}')">设置</button>
                </div></td>
            </tr>`;
        }).join('');
        updateSelectAllState();
    }

    async function setExpiry(resourceType, resourceId, userId, username, accessLevel, inputId) {
        const inputEl = document.getElementById(inputId);
        const newExpiry = inputEl ? inputEl.value : '';
        if (!newExpiry) { showResult('error-msg', '请先选择到期时间'); return; }
        const endpoint = resourceType === 'group' ? `/api/groups/${resourceId}/members/update` : `/api/projects/${resourceId}/members/update`;
        const btn = inputEl ? inputEl.nextElementSibling : null;
        if (btn) { btn.disabled = true; btn.textContent = '处理中...'; }
        try {
            const response = await fetch(endpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ changes: [{ action: 'update', user_id: userId, username, access_level: accessLevel, expires_at: newExpiry }] })
            });
            const result = await response.json();
            if (result.errors && result.errors.length > 0) {
                showResult('error-msg', `设置失败: ${escapeHtml(result.errors[0].error)}`);
                if (btn) { btn.disabled = false; btn.textContent = '设置'; }
            } else {
                showResult('success-msg', `已将 ${escapeHtml(username)} 的到期时间设为 ${newExpiry}`);
                if (btn) btn.textContent = '已设置';
                setTimeout(() => loadLongLivedPermissions(), 1500);
            }
        } catch (e) {
            showResult('error-msg', '操作失败: ' + e.message);
            if (btn) { btn.disabled = false; btn.textContent = '设置'; }
        }
    }

    async function batchSetExpiry() {
        if (selectedKeys.size === 0) return;
        const newExpiry = document.getElementById('bulkDate').value;
        if (!newExpiry) { showResult('error-msg', '请先选择到期时间'); return; }
        const selectedItems = filteredItems.filter(item => selectedKeys.has(getItemKey(item)));
        const btn = document.getElementById('bulkSetBtn');
        btn.disabled = true; btn.textContent = '处理中...';
        const results = [], errors = [];
        for (const item of selectedItems) {
            const endpoint = item.resource_type === 'group' ? `/api/groups/${item.resource_id}/members/update` : `/api/projects/${item.resource_id}/members/update`;
            try {
                const response = await fetch(endpoint, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ changes: [{ action: 'update', user_id: item.user_id, username: item.username, access_level: item.access_level, expires_at: newExpiry }] })
                });
                const result = await response.json();
                if (result.errors && result.errors.length > 0) errors.push({ username: item.username, error: result.errors[0].error });
                else results.push(item);
            } catch (e) { errors.push({ username: item.username, error: e.message }); }
        }
        btn.disabled = false; btn.textContent = '批量设置到期时间';
        if (errors.length > 0) {
            const errMsg = errors.map(e => `${escapeHtml(e.username)}: ${escapeHtml(e.error)}`).join('<br>');
            showResult('error-msg', `批量设置完成：${results.length} 项成功，${errors.length} 项失败<br>${errMsg}`);
        } else { showResult('success-msg', `已将 ${results.length} 项权限的到期时间设为 ${newExpiry}`); }
        clearSelection();
        if (results.length > 0) loadLongLivedPermissions();
    }

    function showResult(type, message) {
        const el = document.getElementById('result');
        el.className = type; el.innerHTML = message; el.style.display = 'block';
        if (type === 'success-msg') setTimeout(() => { el.style.display = 'none'; }, 6000);
    }

    function getPermClass(level) {
        const map = { 50: 'perm-owner', 40: 'perm-maintainer', 30: 'perm-developer', 20: 'perm-reporter', 10: 'perm-guest' };
        return map[level] || '';
    }
    function getPermText(level) {
        const map = { 50: '所有者', 40: '维护者', 30: '开发者', 20: '报告者', 10: '访客' };
        return map[level] || `Level ${level}`;
    }
    function formatDate(d) {
        if (!d) return '';
        const date = typeof d === 'string' ? new Date(d) : d;
        return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    }
    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div'); div.textContent = String(text); return div.innerHTML;
    }
</script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/permanent.html
git commit -m "feat: add permanent.html long-lived permissions page"
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests pass

---

## Self-Review Checklist

- [x] Filter logic (`isLongLived`, `classifyMember`) — Task 1 ✓
- [x] API endpoint scans groups and projects — Task 2 ✓
- [x] Groups-members-fail skipped, continues — Task 2 test 6 ✓
- [x] Permanent permissions included (expires_at null) — Task 2 test 2 ✓
- [x] >1 year included, ≤1 year excluded — Task 2 tests 3 & 4 ✓
- [x] Nav updated on all 3 existing pages — Task 3 ✓
- [x] Stats: total, permanent, long-term, checked — Task 4 ✓
- [x] Filters: class, resource type, text search — Task 4 ✓
- [x] Per-row set expiry — Task 4 `setExpiry()` ✓
- [x] Batch set expiry — Task 4 `batchSetExpiry()` ✓
- [x] Type consistency: `isLongLived(member, now)` used in Task 1 tests and Task 2 server code ✓
