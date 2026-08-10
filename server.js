const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 3010;

// 配置常量：通过环境变量注入，请勿硬编码真实凭据
const GIT_LAB_API_BASE_URL = process.env.GIT_LAB_API_BASE_URL || "https://git.example.com/api/v4/";
const GIT_LAB_ACCESS_TOKEN = process.env.GIT_LAB_ACCESS_TOKEN || "YOUR_GITLAB_ACCESS_TOKEN";
const DEFAULT_PASSWORD_LENGTH = 12;
const DEFAULT_INITIAL_PASSWORD = process.env.GIT_LAB_DEFAULT_PASSWORD || "YourDefaultPassword";

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Axios 实例配置
const gitlabApi = axios.create({
    baseURL: GIT_LAB_API_BASE_URL,
    headers: {
        'PRIVATE-TOKEN': GIT_LAB_ACCESS_TOKEN,
        'Content-Type': 'application/json'
    }
});

// 带限流重试的 GET 封装：遇到 429 读 Retry-After 等待后重试
async function gitlabGet(url, config = {}) {
    const MAX_RETRIES = 4;
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await gitlabApi.get(url, config);
        } catch (err) {
            lastErr = err;
            if (err.response && err.response.status === 429 && attempt < MAX_RETRIES) {
                const waitSec = parseInt(err.response.headers['retry-after'] || '10');
                console.warn(`[限流] ${url} 触发 429，等待 ${waitSec}s 后重试 (第 ${attempt + 1} 次)`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
            } else {
                throw err;
            }
        }
    }
    throw lastErr;
}

const SCAN_CONCURRENCY = 2;          // 扫描时并发数，防止触发 429
const SCAN_BATCH_INTERVAL_MS = 100;  // 每批次间隔，ms

// 辅助函数：生成随机密码
function generateRandomPassword() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+";
    let password = "";
    // 确保包含各类字符
    const specialChars = "!@#$%^&*()_+";
    const numbers = "0123456789";
    const upperCase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const allChars = chars;

    password += specialChars.charAt(Math.floor(Math.random() * specialChars.length));
    password += numbers.charAt(Math.floor(Math.random() * numbers.length));
    password += upperCase.charAt(Math.floor(Math.random() * upperCase.length));

    for (let i = 3; i < DEFAULT_PASSWORD_LENGTH; i++) {
        password += allChars.charAt(Math.floor(Math.random() * allChars.length));
    }
    
    // 简单打乱
    return password.split('').sort(() => 0.5 - Math.random()).join('');
}

// 辅助函数：根据用户名获取ID
async function getUserId(username) {
    const response = await gitlabApi.get(`users?username=${username}`);
    if (response.data.length > 0) {
        return response.data[0].id;
    }
    return -1;
}

// API: 创建用户
app.post('/api/create', async (req, res) => {
    try {
        const { username, email, name, generatePassword } = req.body;
        
        if (!username || !email || !name) {
            return res.status(400).json({ error: "缺少必要参数: username, email, name" });
        }

        const password = generatePassword ? generateRandomPassword() : DEFAULT_INITIAL_PASSWORD;
        
        const payload = {
            username,
            email,
            name,
            password,
            reset_password: true,
            skip_confirmation: true,
            projects_limit: 100
        };

        const response = await gitlabApi.post('users', payload);
        res.json({ success: true, user: response.data, initial_password: password });

    } catch (error) {
        console.error("创建失败:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: error.response ? error.response.data.message : error.message });
    }
});

// API: 禁用用户 (Block)
app.post('/api/disable', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ error: "缺少用户名" });

        const userId = await getUserId(username);
        if (userId === -1) return res.status(404).json({ error: `用户 ${username} 不存在` });

        await gitlabApi.post(`users/${userId}/block`);
        res.json({ success: true, message: `用户 ${username} 已禁用` });

    } catch (error) {
        res.status(500).json({ error: error.response ? error.response.data.message : error.message });
    }
});

// API: 启用用户 (Unblock/Active)
app.post('/api/enable', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ error: "缺少用户名" });

        const userId = await getUserId(username);
        if (userId === -1) return res.status(404).json({ error: `用户 ${username} 不存在` });

        // 获取当前状态
        const userInfo = await gitlabApi.get(`users/${userId}`);
        const currentState = userInfo.data.state;

        if (currentState === 'active') {
            return res.json({ success: true, message: `用户 ${username} 已经是启用状态` });
        }

        if (currentState === 'blocked') {
            await gitlabApi.post(`users/${userId}/unblock`);
        } else {
            // 针对其它非 active/blocked 状态，尝试 put active (虽然通常 unblock 就够了)
            await gitlabApi.put(`users/${userId}`, { state: 'active' });
        }

        res.json({ success: true, message: `用户 ${username} 已启用` });

    } catch (error) {
        res.status(500).json({ error: error.response ? error.response.data.message : error.message });
    }
});

// API: 获取用户列表
app.get('/api/users', async (req, res) => {
    try {
        const page = req.query.page || 1;
        const per_page = req.query.per_page || 20;
        const search = req.query.search || '';
        const state = req.query.state || ''; // active, blocked

        console.log(`[调试] 收到请求参数: page=${page}, search='${search}', state='${state}'`);

        // 构建基础 URL
        let apiParams = `page=${page}&per_page=${per_page}`;
        
        if (search) {
            apiParams += `&search=${encodeURIComponent(search)}`;
        }
        
        if (state === 'active') {
            apiParams += `&active=true`; 
        } else if (state === 'blocked') {
            apiParams += `&blocked=true`;
        }

        const url = `users?${apiParams}`;
        console.log(`[调试] 转发给 GitLab API 的 URL: ${url}`);
        
        const response = await gitlabApi.get(url);
        
        // GitLab API 在 header 中返回分页信息
        const totalPages = parseInt(response.headers['x-total-pages'] || 1);
        
        res.json({ 
            users: response.data,
            page: parseInt(page),
            per_page: parseInt(per_page),
            total_pages: totalPages,
            debug: { received_search: search, received_state: state, api_url: url }
        });
    } catch (error) {
        console.error("获取用户列表失败:", error.message);
        res.status(500).json({ error: error.response ? error.response.data.message : error.message });
    }
});

// API: 获取顶级组列表（包含成员信息）
app.get('/api/groups', async (req, res) => {
    try {
        console.log('[调试] 开始获取顶级组列表...');
        
        // 只获取顶级组（parent_id为null的组）
        const response = await gitlabApi.get('groups', {
            params: { 
                per_page: 100,
                top_level_only: true,
                all_available: true
            }
        });
        
        const topGroups = response.data.map(group => ({
            id: group.id,
            name: group.name,
            full_path: group.full_path || group.name,
            description: group.description || '',
            parent_id: group.parent_id,
            has_subgroups: true,  // 默认显示展开按钮，由懒加载实际获取子组
            children: [],
            members: [],
            members_loaded: false
        }));
        
        console.log(`[调试] 获取到 ${topGroups.length} 个顶级组，开始获取成员信息...`);
        
        // 并发获取每个顶级组的成员信息
        const CONCURRENCY = 5;
        for (let i = 0; i < topGroups.length; i += CONCURRENCY) {
            const batch = topGroups.slice(i, i + CONCURRENCY);
            const batchPromises = batch.map(async (group) => {
                try {
                    const membersResponse = await gitlabApi.get(`groups/${group.id}/members/all`);
                    group.members = membersResponse.data.map(member => ({
                        username: member.username,
                        access_level: member.access_level,
                        expires_at: member.expires_at
                    }));
                    group.members_loaded = true;
                } catch (memberError) {
                    console.warn(`获取组 ${group.id} 的成员失败:`, memberError.message);
                    group.members = [];
                }
            });
            await Promise.all(batchPromises);
        }
        
        console.log(`[调试] 获取到 ${topGroups.length} 个顶级组的成员信息`);
        
        res.json({ 
            success: true,
            groups: topGroups
        });
        
    } catch (error) {
        console.error("获取组列表失败:", error.message);
        res.status(500).json({ 
            error: error.response ? error.response.data.message : error.message 
        });
    }
});

// API: 获取指定组的子组和成员信息
app.get('/api/groups/:groupId/children', async (req, res) => {
    try {
        const groupId = req.params.groupId;
        console.log(`[调试] 开始获取组 ${groupId} 的子组和成员...`);
        
        // 获取子组
        const subgroupsResponse = await gitlabApi.get(`groups/${groupId}/subgroups`, {
            params: { per_page: 100, all_available: true }
        });
        
        // 获取当前组的成员
        const membersResponse = await gitlabApi.get(`groups/${groupId}/members/all`);
        const members = membersResponse.data.map(member => ({
            username: member.username,
            access_level: member.access_level,
            expires_at: member.expires_at
        }));
        
        // 处理子组 - 同时获取每个子组的成员信息
        const subgroups = await Promise.all(subgroupsResponse.data.map(async (group) => {
            let subgroupMembers = [];
            try {
                const subgroupMembersResponse = await gitlabApi.get(`groups/${group.id}/members/all`);
                subgroupMembers = subgroupMembersResponse.data.map(member => ({
                    username: member.username,
                    access_level: member.access_level,
                    expires_at: member.expires_at
                }));
            } catch (memberError) {
                console.warn(`获取子组 ${group.id} 的成员失败:`, memberError.message);
            }
            
            return {
                id: group.id,
                name: group.name,
                full_path: group.full_path || group.name,
                description: group.description || '',
                parent_id: group.parent_id,
                has_subgroups: true,  // 默认显示展开按钮，由懒加载实际获取子组
                children: [],
                members: subgroupMembers,
                members_loaded: true
            };
        }));
        
        console.log(`[调试] 组 ${groupId}: ${subgroups.length} 个子组, ${members.length} 个成员`);
        
        res.json({
            success: true,
            groupId: groupId,
            members: members,
            subgroups: subgroups
        });
        
    } catch (error) {
        console.error(`获取组 ${req.params.groupId} 的子组失败:`, error.message);
        res.status(500).json({
            error: error.response ? error.response.data.message : error.message
        });
    }
});

// API: 获取指定组的项目及其成员权限
app.get('/api/groups/:groupId/projects', async (req, res) => {
    try {
        const groupId = req.params.groupId;
        console.log(`[调试] 开始获取组 ${groupId} 的项目...`);
        
        // 获取组内项目
        const projectsResponse = await gitlabApi.get(`groups/${groupId}/projects?per_page=100`);
        const projects = projectsResponse.data;
        
        console.log(`[调试] 组 ${groupId}: 获取到 ${projects.length} 个项目`);
        
        // 获取每个项目的成员权限
        const projectsWithMembers = [];
        
        for (const project of projects) {
            try {
                const membersResponse = await gitlabApi.get(`projects/${project.id}/members/all`);
                const members = membersResponse.data.map(member => ({
                    username: member.username,
                    access_level: member.access_level,
                    expires_at: member.expires_at
                }));
                
                projectsWithMembers.push({
                    id: project.id,
                    name: project.name,
                    path_with_namespace: project.path_with_namespace,
                    description: project.description,
                    web_url: project.web_url,
                    members: members
                });
            } catch (memberError) {
                console.warn(`获取项目 ${project.id} 的成员失败:`, memberError.message);
                projectsWithMembers.push({
                    id: project.id,
                    name: project.name,
                    path_with_namespace: project.path_with_namespace,
                    description: project.description,
                    web_url: project.web_url,
                    members: []
                });
            }
        }
        
        res.json({ 
            success: true,
            projects: projectsWithMembers
        });
        
    } catch (error) {
        console.error(`获取组 ${req.params.groupId} 的项目失败:`, error.message);
        res.status(500).json({ 
            error: error.response ? error.response.data.message : error.message 
        });
    }
});

// 保留旧的API以保持兼容性（可选）
app.get('/api/projects', async (req, res) => {
    try {
        console.log("[调试] 开始获取GitLab组和项目信息...");
        
        // 1. 获取所有组（分页获取）
        const allGroups = [];
        let page = 1;
        const perPage = 100;
        let hasMoreGroups = true;
        
        while (hasMoreGroups) {
            const groupsResponse = await gitlabApi.get(`groups?per_page=${perPage}&page=${page}&with_custom_attributes=true`);
            const groups = groupsResponse.data;
            
            if (groups.length > 0) {
                allGroups.push(...groups);
                page++;
            } else {
                hasMoreGroups = false;
            }
        }
        
        console.log(`[调试] 获取到 ${allGroups.length} 个组`);
        
        // 2. 获取每个组的项目和成员信息
        const groupsWithProjects = [];
        
        for (const group of allGroups) {
            const groupData = {
                id: group.id,
                name: group.name,
                full_path: group.full_path || group.name,
                description: group.description || '',
                projects: []
            };
            
            try {
                // 获取组内项目
                const projectsResponse = await gitlabApi.get(`groups/${group.id}/projects?per_page=100`);
                const projects = projectsResponse.data;
                
                // 获取每个项目的成员权限
                for (const project of projects) {
                    try {
                        const membersResponse = await gitlabApi.get(`projects/${project.id}/members/all`);
                        const members = membersResponse.data.map(member => ({
                            username: member.username,
                            access_level: member.access_level,
                            expires_at: member.expires_at
                        }));
                        
                        groupData.projects.push({
                            id: project.id,
                            name: project.name,
                            path_with_namespace: project.path_with_namespace,
                            description: project.description,
                            web_url: project.web_url,
                            members: members
                        });
                    } catch (memberError) {
                        console.warn(`获取项目 ${project.id} 的成员失败:`, memberError.message);
                        groupData.projects.push({
                            id: project.id,
                            name: project.name,
                            path_with_namespace: project.path_with_namespace,
                            description: project.description,
                            web_url: project.web_url,
                            members: []
                        });
                    }
                }
                
                groupsWithProjects.push(groupData);
                console.log(`[调试] 组 '${group.name}': ${groupData.projects.length} 个项目`);
                
            } catch (projectError) {
                console.warn(`获取组 ${group.id} 的项目失败:`, projectError.message);
                groupsWithProjects.push(groupData);
            }
        }
        
        res.json({ 
            success: true,
            groups: groupsWithProjects
        });
        
    } catch (error) {
        console.error("获取项目列表失败:", error.message);
        res.status(500).json({ 
            error: error.response ? error.response.data.message : error.message 
        });
    }
});

// API: 获取组成员详情（包含user_id，用于编辑权限）
app.get('/api/groups/:groupId/members/detail', async (req, res) => {
    try {
        const groupId = req.params.groupId;
        const membersResponse = await gitlabApi.get(`groups/${groupId}/members/all`);
        
        const members = membersResponse.data.map(member => ({
            user_id: member.id,
            username: member.username,
            name: member.name,
            access_level: member.access_level,
            expires_at: member.expires_at
        }));
        
        res.json({ members });
    } catch (error) {
        console.error(`获取组 ${req.params.groupId} 的成员详情失败:`, error.message);
        res.status(500).json({ error: error.response ? error.response.data.message : error.message });
    }
});

// API: 获取项目成员详情（包含user_id，用于编辑权限）
app.get('/api/projects/:projectId/members/detail', async (req, res) => {
    try {
        const projectId = req.params.projectId;
        const membersResponse = await gitlabApi.get(`projects/${projectId}/members/all`);
        
        const members = membersResponse.data.map(member => ({
            user_id: member.id,
            username: member.username,
            name: member.name,
            access_level: member.access_level,
            expires_at: member.expires_at
        }));
        
        res.json({ members });
    } catch (error) {
        console.error(`获取项目 ${req.params.projectId} 的成员详情失败:`, error.message);
        res.status(500).json({ error: error.response ? error.response.data.message : error.message });
    }
});

// API: 批量更新组成员权限
app.post('/api/groups/:groupId/members/update', async (req, res) => {
    try {
        const groupId = req.params.groupId;
        const { changes } = req.body;
        
        if (!changes || !Array.isArray(changes)) {
            return res.status(400).json({ error: "缺少changes参数" });
        }
        
        const results = [];
        const errors = [];
        
        for (const change of changes) {
            try {
                const { action, user_id, access_level, expires_at } = change;
                
                if (action === 'add') {
                    // 添加成员
                    await gitlabApi.post(`groups/${groupId}/members`, {
                        user_id,
                        access_level,
                        expires_at: expires_at || undefined
                    });
                    results.push({ action, user_id, status: 'added' });
                } else if (action === 'update') {
                    // 更新成员权限
                    await gitlabApi.put(`groups/${groupId}/members/${user_id}`, {
                        access_level,
                        expires_at: expires_at || undefined
                    });
                    results.push({ action, user_id, status: 'updated' });
                } else if (action === 'remove') {
                    // 删除成员
                    await gitlabApi.delete(`groups/${groupId}/members/${user_id}`);
                    results.push({ action, user_id, status: 'removed' });
                }
            } catch (error) {
                console.error(`处理变更失败:`, error.message);
                errors.push({ 
                    username: change.username || change.user_id, 
                    error: error.response ? error.response.data.message : error.message 
                });
            }
        }
        
        res.json({ results, errors });
    } catch (error) {
        console.error(`更新组 ${req.params.groupId} 的成员权限失败:`, error.message);
        res.status(500).json({ error: error.response ? error.response.data.message : error.message });
    }
});

// API: 批量更新项目成员权限
app.post('/api/projects/:projectId/members/update', async (req, res) => {
    try {
        const projectId = req.params.projectId;
        const { changes } = req.body;
        
        if (!changes || !Array.isArray(changes)) {
            return res.status(400).json({ error: "缺少changes参数" });
        }
        
        const results = [];
        const errors = [];
        
        for (const change of changes) {
            try {
                const { action, user_id, access_level, expires_at } = change;
                
                if (action === 'add') {
                    // 添加成员
                    await gitlabApi.post(`projects/${projectId}/members`, {
                        user_id,
                        access_level,
                        expires_at: expires_at || undefined
                    });
                    results.push({ action, user_id, status: 'added' });
                } else if (action === 'update') {
                    // 更新成员权限
                    await gitlabApi.put(`projects/${projectId}/members/${user_id}`, {
                        access_level,
                        expires_at: expires_at || undefined
                    });
                    results.push({ action, user_id, status: 'updated' });
                } else if (action === 'remove') {
                    // 删除成员
                    await gitlabApi.delete(`projects/${projectId}/members/${user_id}`);
                    results.push({ action, user_id, status: 'removed' });
                }
            } catch (error) {
                console.error(`处理变更失败:`, error.message);
                errors.push({ 
                    username: change.username || change.user_id, 
                    error: error.response ? error.response.data.message : error.message 
                });
            }
        }
        
        res.json({ results, errors });
    } catch (error) {
        console.error(`更新项目 ${req.params.projectId} 的成员权限失败:`, error.message);
        res.status(500).json({ error: error.response ? error.response.data.message : error.message });
    }
});

// API: 搜索用户
app.get('/api/users/search', async (req, res) => {
    try {
        const search = req.query.search || '';
        if (!search || search.length < 2) {
            return res.json({ success: true, users: [] });
        }
        
        const response = await gitlabApi.get(`users?search=${encodeURIComponent(search)}&per_page=20`);
        
        const users = response.data.map(user => ({
            id: user.id,
            username: user.username,
            name: user.name,
            email: user.email
        }));
        
        res.json({ users });
    } catch (error) {
        console.error("搜索用户失败:", error.message);
        res.status(500).json({ error: error.response ? error.response.data.message : error.message });
    }
});

// API: 更新组备注 (Description)
app.put('/api/groups/:groupId/description', async (req, res) => {
    try {
        const { groupId } = req.params;
        const { description } = req.body;
        
        console.log(`[调试] 更新组 ${groupId} 的备注: ${description}`);
        
        const response = await gitlabApi.put(`groups/${groupId}`, { description });
        
        res.json({ success: true, group: response.data });
    } catch (error) {
        console.error(`更新组 ${req.params.groupId} 备注失败:`, error.message);
        res.status(500).json({ error: error.response ? error.response.data.message : error.message });
    }
});

// API: 更新项目备注 (Description)
app.put('/api/projects/:projectId/description', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { description } = req.body;
        
        console.log(`[调试] 更新项目 ${projectId} 的备注: ${description}`);
        
        const response = await gitlabApi.put(`projects/${projectId}`, { description });
        
        res.json({ success: true, project: response.data });
    } catch (error) {
        console.error(`更新项目 ${req.params.projectId} 备注失败:`, error.message);
        res.status(500).json({ error: error.response ? error.response.data.message : error.message });
    }
});

// API: 获取即将过期的权限（SSE 流式，带进度）
app.get('/api/expiring-permissions/stream', async (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    let closed = false;
    req.on('close', () => { closed = true; });

    const send = (event, data) => {
        if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
        const days = parseInt(req.query.days || 30);
        const now = new Date();
        const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        let foundCount = 0;

        // Phase 1: 获取所有组
        send('progress', { percent: 0, message: '正在获取组列表...', found: 0 });
        const allGroups = [];
        let page = 1;
        while (true) {
            if (closed) return res.end();
            const resp = await gitlabGet('groups', {
                params: { per_page: 100, page, all_available: true }
            });
            if (resp.data.length === 0) break;
            allGroups.push(...resp.data);
            if (resp.data.length < 100) break;
            page++;
        }

        // Phase 2: 扫描组直接成员
        let doneGroups = 0;
        send('progress', { percent: 5, message: `扫描组成员（共 ${allGroups.length} 个组）`, found: 0 });
        for (let i = 0; i < allGroups.length; i += SCAN_CONCURRENCY) {
            if (closed) return res.end();
            const batch = allGroups.slice(i, i + SCAN_CONCURRENCY);
            await Promise.all(batch.map(async (group) => {
                try {
                    const resp = await gitlabGet(`groups/${group.id}/members`, {
                        params: { per_page: 100 }
                    });
                    resp.data.forEach(member => {
                        if (member.expires_at) {
                            const expiryDate = new Date(member.expires_at);
                            if (expiryDate >= now && expiryDate <= cutoff) {
                                foundCount++;
                                send('item', {
                                    resource_type: 'group',
                                    resource_id: group.id,
                                    resource_name: group.name,
                                    resource_path: group.full_path,
                                    user_id: member.id,
                                    username: member.username,
                                    name: member.name,
                                    access_level: member.access_level,
                                    expires_at: member.expires_at,
                                });
                            }
                        }
                    });
                } catch (e) {
                    console.warn(`获取组 ${group.id} 成员失败:`, e.message);
                }
            }));
            doneGroups = Math.min(i + SCAN_CONCURRENCY, allGroups.length);
            const pct = allGroups.length > 0 ? 5 + Math.round(doneGroups / allGroups.length * 45) : 50;
            send('progress', { percent: pct, message: `扫描组成员 ${doneGroups}/${allGroups.length}`, found: foundCount });
            await new Promise(r => setTimeout(r, SCAN_BATCH_INTERVAL_MS));
        }

        // Phase 3: 获取所有项目
        send('progress', { percent: 50, message: '正在获取项目列表...', found: foundCount });
        const allProjects = [];
        page = 1;
        while (true) {
            if (closed) return res.end();
            const resp = await gitlabGet('projects', {
                params: { per_page: 100, page, simple: true }
            });
            if (resp.data.length === 0) break;
            allProjects.push(...resp.data);
            if (resp.data.length < 100) break;
            page++;
        }

        // Phase 4: 扫描项目直接成员
        let doneProjects = 0;
        send('progress', { percent: 55, message: `扫描项目成员（共 ${allProjects.length} 个项目）`, found: foundCount });
        for (let i = 0; i < allProjects.length; i += SCAN_CONCURRENCY) {
            if (closed) return res.end();
            const batch = allProjects.slice(i, i + SCAN_CONCURRENCY);
            await Promise.all(batch.map(async (project) => {
                try {
                    const resp = await gitlabGet(`projects/${project.id}/members`, {
                        params: { per_page: 100 }
                    });
                    resp.data.forEach(member => {
                        if (member.expires_at) {
                            const expiryDate = new Date(member.expires_at);
                            if (expiryDate >= now && expiryDate <= cutoff) {
                                foundCount++;
                                send('item', {
                                    resource_type: 'project',
                                    resource_id: project.id,
                                    resource_name: project.name,
                                    resource_path: project.path_with_namespace,
                                    resource_url: project.web_url,
                                    user_id: member.id,
                                    username: member.username,
                                    name: member.name,
                                    access_level: member.access_level,
                                    expires_at: member.expires_at,
                                });
                            }
                        }
                    });
                } catch (e) {
                    console.warn(`获取项目 ${project.id} 成员失败:`, e.message);
                }
            }));
            doneProjects = Math.min(i + SCAN_CONCURRENCY, allProjects.length);
            const pct = allProjects.length > 0 ? 55 + Math.round(doneProjects / allProjects.length * 44) : 99;
            send('progress', { percent: pct, message: `扫描项目成员 ${doneProjects}/${allProjects.length}`, found: foundCount });
            await new Promise(r => setTimeout(r, SCAN_BATCH_INTERVAL_MS));
        }

        send('done', { count: foundCount, checked_groups: allGroups.length, checked_projects: allProjects.length });
    } catch (error) {
        console.error('SSE 即将过期权限扫描失败:', error.message);
        send('fail', { error: error.message });
    }

    res.end();
});

// API: 获取即将过期的权限（默认30天内）
app.get('/api/expiring-permissions', async (req, res) => {
    try {
        const days = parseInt(req.query.days || 30);
        const now = new Date();
        const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        const expiringItems = [];

        console.log(`[调试] 开始扫描 ${days} 天内即将过期的权限...`);

        // 1. 获取所有组（分页）
        const allGroups = [];
        let page = 1;
        while (true) {
            const resp = await gitlabGet('groups', {
                params: { per_page: 100, page, all_available: true }
            });
            if (resp.data.length === 0) break;
            allGroups.push(...resp.data);
            if (resp.data.length < 100) break;
            page++;
        }
        console.log(`[调试] 共找到 ${allGroups.length} 个组`);

        // 2. 并发获取各组直接成员，过滤出即将过期的
        for (let i = 0; i < allGroups.length; i += SCAN_CONCURRENCY) {
            const batch = allGroups.slice(i, i + SCAN_CONCURRENCY);
            await Promise.all(batch.map(async (group) => {
                try {
                    const resp = await gitlabGet(`groups/${group.id}/members`, {
                        params: { per_page: 100 }
                    });
                    resp.data.forEach(member => {
                        if (member.expires_at) {
                            const expiryDate = new Date(member.expires_at);
                            if (expiryDate >= now && expiryDate <= cutoff) {
                                expiringItems.push({
                                    resource_type: 'group',
                                    resource_id: group.id,
                                    resource_name: group.name,
                                    resource_path: group.full_path,
                                    user_id: member.id,
                                    username: member.username,
                                    name: member.name,
                                    access_level: member.access_level,
                                    expires_at: member.expires_at
                                });
                            }
                        }
                    });
                } catch (e) {
                    console.warn(`获取组 ${group.id} 成员失败:`, e.message);
                }
            }));
            await new Promise(r => setTimeout(r, SCAN_BATCH_INTERVAL_MS));
        }

        // 3. 获取所有项目（分页）
        const allProjects = [];
        page = 1;
        while (true) {
            const resp = await gitlabGet('projects', {
                params: { per_page: 100, page, simple: true }
            });
            if (resp.data.length === 0) break;
            allProjects.push(...resp.data);
            if (resp.data.length < 100) break;
            page++;
        }
        console.log(`[调试] 共找到 ${allProjects.length} 个项目`);

        // 4. 并发获取各项目直接成员，过滤出即将过期的
        for (let i = 0; i < allProjects.length; i += SCAN_CONCURRENCY) {
            const batch = allProjects.slice(i, i + SCAN_CONCURRENCY);
            await Promise.all(batch.map(async (project) => {
                try {
                    const resp = await gitlabGet(`projects/${project.id}/members`, {
                        params: { per_page: 100 }
                    });
                    resp.data.forEach(member => {
                        if (member.expires_at) {
                            const expiryDate = new Date(member.expires_at);
                            if (expiryDate >= now && expiryDate <= cutoff) {
                                expiringItems.push({
                                    resource_type: 'project',
                                    resource_id: project.id,
                                    resource_name: project.name,
                                    resource_path: project.path_with_namespace,
                                    resource_url: project.web_url,
                                    user_id: member.id,
                                    username: member.username,
                                    name: member.name,
                                    access_level: member.access_level,
                                    expires_at: member.expires_at
                                });
                            }
                        }
                    });
                } catch (e) {
                    console.warn(`获取项目 ${project.id} 成员失败:`, e.message);
                }
            }));
            await new Promise(r => setTimeout(r, SCAN_BATCH_INTERVAL_MS));
        }

        // 按过期时间升序排序（最快过期的在前）
        expiringItems.sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at));

        console.log(`[调试] 找到 ${expiringItems.length} 个即将过期的权限`);

        res.json({
            success: true,
            items: expiringItems,
            count: expiringItems.length,
            checked_groups: allGroups.length,
            checked_projects: allProjects.length
        });
    } catch (error) {
        console.error('获取即将过期权限失败:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// API: 批量延期多个权限
const { computeNewExpiry } = require('./src/expiring-logic');
const { isLongLived } = require('./src/long-lived-logic');

app.post('/api/batch-extend-permissions', async (req, res) => {
    try {
        const { items, days } = req.body;

        if (!items || !Array.isArray(items)) {
            return res.status(400).json({ error: '缺少 items 参数或格式错误' });
        }
        if (!days || typeof days !== 'number' || days <= 0) {
            return res.status(400).json({ error: 'days 必须为正整数' });
        }

        const results = [];
        const errors = [];

        for (const item of items) {
            try {
                const { resource_type, resource_id, user_id, username, access_level, expires_at } = item;
                const newExpiry = computeNewExpiry(expires_at, days);
                const endpoint = resource_type === 'group'
                    ? `groups/${resource_id}/members/${user_id}`
                    : `projects/${resource_id}/members/${user_id}`;

                await gitlabApi.put(endpoint, { access_level, expires_at: newExpiry });
                results.push({ user_id, username, resource_type, resource_id, new_expiry: newExpiry, status: 'extended' });
            } catch (err) {
                errors.push({
                    username: item.username,
                    resource_type: item.resource_type,
                    resource_id: item.resource_id,
                    error: err.response ? err.response.data.message : err.message,
                });
            }
        }

        res.json({ success: true, results, errors });
    } catch (error) {
        console.error('批量延期失败:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// API: 获取长期有效权限（SSE 流式，带进度）
app.get('/api/long-lived-permissions/stream', async (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    let closed = false;
    req.on('close', () => { closed = true; });

    const send = (event, data) => {
        if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
        const now = new Date();
        let foundCount = 0;

        // Phase 1: 获取所有组
        send('progress', { percent: 0, message: '正在获取组列表...', found: 0 });
        const allGroups = [];
        let page = 1;
        while (true) {
            if (closed) return res.end();
            const resp = await gitlabGet('groups', {
                params: { per_page: 100, page, all_available: true }
            });
            if (resp.data.length === 0) break;
            allGroups.push(...resp.data);
            if (resp.data.length < 100) break;
            page++;
        }

        // Phase 2: 扫描组成员
        let doneGroups = 0;
        send('progress', { percent: 5, message: `扫描组成员（共 ${allGroups.length} 个组）`, found: 0 });
        for (let i = 0; i < allGroups.length; i += SCAN_CONCURRENCY) {
            if (closed) return res.end();
            const batch = allGroups.slice(i, i + SCAN_CONCURRENCY);
            await Promise.all(batch.map(async (group) => {
                try {
                    const resp = await gitlabGet(`groups/${group.id}/members`, {
                        params: { per_page: 100 }
                    });
                    resp.data.forEach(member => {
                        if (isLongLived(member, now)) {
                            foundCount++;
                            send('item', {
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
            doneGroups = Math.min(i + SCAN_CONCURRENCY, allGroups.length);
            const pct = allGroups.length > 0 ? 5 + Math.round(doneGroups / allGroups.length * 45) : 50;
            send('progress', { percent: pct, message: `扫描组成员 ${doneGroups}/${allGroups.length}`, found: foundCount });
            await new Promise(r => setTimeout(r, SCAN_BATCH_INTERVAL_MS));
        }

        // Phase 3: 获取所有项目
        send('progress', { percent: 50, message: '正在获取项目列表...', found: foundCount });
        const allProjects = [];
        page = 1;
        while (true) {
            if (closed) return res.end();
            const resp = await gitlabGet('projects', {
                params: { per_page: 100, page, simple: true }
            });
            if (resp.data.length === 0) break;
            allProjects.push(...resp.data);
            if (resp.data.length < 100) break;
            page++;
        }

        // Phase 4: 扫描项目成员
        let doneProjects = 0;
        send('progress', { percent: 55, message: `扫描项目成员（共 ${allProjects.length} 个项目）`, found: foundCount });
        for (let i = 0; i < allProjects.length; i += SCAN_CONCURRENCY) {
            if (closed) return res.end();
            const batch = allProjects.slice(i, i + SCAN_CONCURRENCY);
            await Promise.all(batch.map(async (project) => {
                try {
                    const resp = await gitlabGet(`projects/${project.id}/members`, {
                        params: { per_page: 100 }
                    });
                    resp.data.forEach(member => {
                        if (isLongLived(member, now)) {
                            foundCount++;
                            send('item', {
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
            doneProjects = Math.min(i + SCAN_CONCURRENCY, allProjects.length);
            const pct = allProjects.length > 0 ? 55 + Math.round(doneProjects / allProjects.length * 44) : 99;
            send('progress', { percent: pct, message: `扫描项目成员 ${doneProjects}/${allProjects.length}`, found: foundCount });
            await new Promise(r => setTimeout(r, SCAN_BATCH_INTERVAL_MS));
        }

        send('done', { count: foundCount, checked_groups: allGroups.length, checked_projects: allProjects.length });
    } catch (error) {
        console.error('SSE 长期权限扫描失败:', error.message);
        send('fail', { error: error.message });
    }

    res.end();
});

// API: 获取长期有效权限（永久或有效期超1年）
app.get('/api/long-lived-permissions', async (req, res) => {
    try {
        const now = new Date();
        const items = [];

        // 1. 获取所有组（分页）
        const allGroups = [];
        let page = 1;
        while (true) {
            const resp = await gitlabGet('groups', {
                params: { per_page: 100, page, all_available: true }
            });
            if (resp.data.length === 0) break;
            allGroups.push(...resp.data);
            if (resp.data.length < 100) break;
            page++;
        }

        // 2. 并发获取各组直接成员，过滤长期有效的
        for (let i = 0; i < allGroups.length; i += SCAN_CONCURRENCY) {
            const batch = allGroups.slice(i, i + SCAN_CONCURRENCY);
            await Promise.all(batch.map(async (group) => {
                try {
                    const resp = await gitlabGet(`groups/${group.id}/members`, {
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
            await new Promise(r => setTimeout(r, SCAN_BATCH_INTERVAL_MS));
        }

        // 3. 获取所有项目（分页）
        const allProjects = [];
        page = 1;
        while (true) {
            const resp = await gitlabGet('projects', {
                params: { per_page: 100, page, simple: true }
            });
            if (resp.data.length === 0) break;
            allProjects.push(...resp.data);
            if (resp.data.length < 100) break;
            page++;
        }

        // 4. 并发获取各项目直接成员，过滤长期有效的
        for (let i = 0; i < allProjects.length; i += SCAN_CONCURRENCY) {
            const batch = allProjects.slice(i, i + SCAN_CONCURRENCY);
            await Promise.all(batch.map(async (project) => {
                try {
                    const resp = await gitlabGet(`projects/${project.id}/members`, {
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
            await new Promise(r => setTimeout(r, SCAN_BATCH_INTERVAL_MS));
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

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`GitLab用户管理工具运行在 http://localhost:${PORT}`);
    });
}

module.exports = app;
