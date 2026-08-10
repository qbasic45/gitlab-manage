/**
 * 通用扫描逻辑模块
 * 用于扫描 GitLab 组和项目成员的权限信息
 * 支持流式和非流式两种模式
 */

const { isLongLived } = require('./long-lived-logic');

/**
 * 扫描所有组和项目的成员
 * @param {Object} gitlabApi - GitLab API 客户端实例
 * @param {Function} filterFn - 过滤函数，接收 (member, resourceType, resource, now) 参数
 * @param {Object} options - 选项配置
 * @param {Function} options.onProgress - 进度回调函数
 * @param {Function} options.onItem - 单个项目回调函数
 * @param {Function} options.onError - 错误回调函数
 * @param {AbortSignal} options.signal - 可选的中止信号
 * @returns {Promise<Object>} 扫描结果统计
 */
async function scanMembers(gitlabApi, filterFn, { onProgress, onItem, onError, signal } = {}) {
    const SCAN_CONCURRENCY = 2;
    const SCAN_BATCH_INTERVAL_MS = 100;
    
    const now = new Date();
    let foundCount = 0;
    let checkedGroups = 0;
    let checkedProjects = 0;

    // Phase 1: 获取所有组
    if (onProgress) {
        onProgress({ percent: 0, message: '正在获取组列表...', found: 0 });
    }
    
    const allGroups = [];
    let page = 1;
    while (true) {
        if (signal && signal.aborted) {
            throw new Error('Scan aborted');
        }
        
        try {
            const resp = await gitlabApi.get('groups', {
                params: { per_page: 100, page, all_available: true }
            });
            if (resp.data.length === 0) break;
            allGroups.push(...resp.data);
            if (resp.data.length < 100) break;
            page++;
        } catch (e) {
            console.warn(`获取组列表第 ${page} 页失败:`, e.message);
            break;
        }
    }

    // Phase 2: 扫描组成员
    let doneGroups = 0;
    if (onProgress) {
        onProgress({ percent: 5, message: `扫描组成员（共 ${allGroups.length} 个组）`, found: 0 });
    }
    
    for (let i = 0; i < allGroups.length; i += SCAN_CONCURRENCY) {
        if (signal && signal.aborted) {
            throw new Error('Scan aborted');
        }
        
        const batch = allGroups.slice(i, i + SCAN_CONCURRENCY);
        await Promise.all(batch.map(async (group) => {
            try {
                const resp = await gitlabApi.get(`groups/${group.id}/members`, {
                    params: { per_page: 100 }
                });
                resp.data.forEach(member => {
                    const result = filterFn(member, 'group', group, now);
                    if (result) {
                        foundCount++;
                        if (onItem) {
                            onItem({
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
                    }
                });
            } catch (e) {
                console.warn(`获取组 ${group.id} 成员失败:`, e.message);
                if (onError) {
                    onError({ type: 'group', id: group.id, error: e.message });
                }
            }
        }));
        
        doneGroups = Math.min(i + SCAN_CONCURRENCY, allGroups.length);
        checkedGroups = doneGroups;
        const pct = allGroups.length > 0 ? 5 + Math.round(doneGroups / allGroups.length * 45) : 50;
        if (onProgress) {
            onProgress({ percent: pct, message: `扫描组成员 ${doneGroups}/${allGroups.length}`, found: foundCount });
        }
        await new Promise(r => setTimeout(r, SCAN_BATCH_INTERVAL_MS));
    }

    // Phase 3: 获取所有项目
    if (onProgress) {
        onProgress({ percent: 50, message: '正在获取项目列表...', found: foundCount });
    }
    
    const allProjects = [];
    page = 1;
    while (true) {
        if (signal && signal.aborted) {
            throw new Error('Scan aborted');
        }
        
        try {
            const resp = await gitlabApi.get('projects', {
                params: { per_page: 100, page, simple: true }
            });
            if (resp.data.length === 0) break;
            allProjects.push(...resp.data);
            if (resp.data.length < 100) break;
            page++;
        } catch (e) {
            console.warn(`获取项目列表第 ${page} 页失败:`, e.message);
            break;
        }
    }

    // Phase 4: 扫描项目成员
    let doneProjects = 0;
    if (onProgress) {
        onProgress({ percent: 55, message: `扫描项目成员（共 ${allProjects.length} 个项目）`, found: foundCount });
    }
    
    for (let i = 0; i < allProjects.length; i += SCAN_CONCURRENCY) {
        if (signal && signal.aborted) {
            throw new Error('Scan aborted');
        }
        
        const batch = allProjects.slice(i, i + SCAN_CONCURRENCY);
        await Promise.all(batch.map(async (project) => {
            try {
                const resp = await gitlabApi.get(`projects/${project.id}/members`, {
                    params: { per_page: 100 }
                });
                resp.data.forEach(member => {
                    const result = filterFn(member, 'project', project, now);
                    if (result) {
                        foundCount++;
                        if (onItem) {
                            onItem({
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
                    }
                });
            } catch (e) {
                console.warn(`获取项目 ${project.id} 成员失败:`, e.message);
                if (onError) {
                    onError({ type: 'project', id: project.id, error: e.message });
                }
            }
        }));
        
        doneProjects = Math.min(i + SCAN_CONCURRENCY, allProjects.length);
        checkedProjects = doneProjects;
        const pct = allProjects.length > 0 ? 55 + Math.round(doneProjects / allProjects.length * 44) : 99;
        if (onProgress) {
            onProgress({ percent: pct, message: `扫描项目成员 ${doneProjects}/${allProjects.length}`, found: foundCount });
        }
        await new Promise(r => setTimeout(r, SCAN_BATCH_INTERVAL_MS));
    }

    return {
        count: foundCount,
        checked_groups: checkedGroups,
        checked_projects: checkedProjects,
    };
}

/**
 * 创建即将过期权限的过滤器
 * @param {number} days - 天数
 * @returns {Function} 过滤函数
 */
function createExpiringFilter(days) {
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    
    return function filterExpiring(member, resourceType, resource, currentTime) {
        if (!member.expires_at) return false;
        const expiryDate = new Date(member.expires_at);
        return expiryDate >= currentTime && expiryDate <= cutoff;
    };
}

/**
 * 创建长期权限的过滤器
 * @returns {Function} 过滤函数
 */
function createLongLivedFilter() {
    return function filterLongLived(member, resourceType, resource, currentTime) {
        return isLongLived(member, currentTime);
    };
}

module.exports = {
    scanMembers,
    createExpiringFilter,
    createLongLivedFilter,
};
