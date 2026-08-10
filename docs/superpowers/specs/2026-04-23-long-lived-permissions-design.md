# 长期权限查看页面 设计文档

**日期：** 2026-04-23  
**状态：** 已批准

---

## 1. 目标

在现有 GitLab 用户管理工具中新增第四个顶级导航页面，用于查看和管理"长期有效"的成员权限，具体指：
- **永久权限**：`expires_at` 为 null（无到期时间）
- **超1年权限**：`expires_at` 有值，但距今超过 365 天

页面支持为这两类权限设置或修改到期时间（逐行操作 + 批量操作）。

---

## 2. 架构概览

```
浏览器 (permanent.html)
  │
  ├─ GET  /api/long-lived-permissions     ← 新增端点，扫描并过滤成员
  │
  ├─ POST /api/groups/:id/members/update  ← 复用现有端点（设置到期时间）
  └─ POST /api/projects/:id/members/update
```

新增文件：
| 文件 | 作用 |
|------|------|
| `src/long-lived-logic.js` | 过滤逻辑（纯函数，可单元测试） |
| `tests/long-lived-logic.test.js` | 单元测试 |
| `tests/server-long-lived.test.js` | API 集成测试 |
| `public/permanent.html` | 前端页面 |

修改文件：
| 文件 | 修改内容 |
|------|----------|
| `server.js` | 新增 `/api/long-lived-permissions` 端点 |
| `public/index.html` | 导航栏加第四项 |
| `public/projects.html` | 导航栏加第四项 |
| `public/expiring.html` | 导航栏加第四项 |

---

## 3. 过滤逻辑模块（`src/long-lived-logic.js`）

### 3.1 `isLongLived(member, now)`

- `member.expires_at` 为 null / undefined → 返回 `true`（永久）
- `member.expires_at` 有值，且 `new Date(member.expires_at) > now + 365天` → 返回 `true`
- 否则 → 返回 `false`

**关键设计：** `now` 作为参数传入，而非函数内部 `new Date()`，使测试中可完全控制时间，避免时间敏感的测试不稳定。

### 3.2 `classifyMember(member, now)`

- `expires_at` 为 null → 返回 `'permanent'`
- `expires_at` 有值且 > now + 365天 → 返回 `'long-term'`

---

## 4. 后端 API

### `GET /api/long-lived-permissions`

**扫描逻辑：**
1. 分页获取所有组（`groups?per_page=100`），并发批次 5
2. 获取每个组的直接成员（`groups/:id/members`），对每个成员调用 `isLongLived(member, now)`
3. 分页获取所有项目（`projects?membership=true&simple=true`），并发批次 5
4. 获取每个项目的直接成员（`projects/:id/members`），同样过滤

**响应格式：**
```json
{
  "success": true,
  "items": [
    {
      "resource_type": "group" | "project",
      "resource_id": 10,
      "resource_name": "my-group",
      "resource_path": "namespace/my-group",
      "resource_url": "https://...",
      "user_id": 101,
      "username": "alice",
      "name": "Alice",
      "access_level": 30,
      "expires_at": null
    }
  ],
  "count": 42,
  "checked_groups": 5,
  "checked_projects": 20
}
```

`items` 按资源名称升序排列，永久权限排在超1年权限之前。

### 设置到期时间（复用现有端点）

单行操作和批量操作均复用：
- `POST /api/groups/:groupId/members/update`
- `POST /api/projects/:projectId/members/update`

请求体 `changes` 数组，`action: 'update'`，设置 `expires_at` 字段。

---

## 5. 前端页面（`public/permanent.html`）

### 5.1 导航

所有四个页面的导航栏统一更新为：
```
👥 用户管理 | 🛡️ 项目权限 | ⏰ 即将过期 | ♾️ 长期权限
```

### 5.2 统计卡片（4张）

| 卡片 | 数据来源 |
|------|----------|
| 长期权限总数 | `items.length` |
| 永久权限数 | `items.filter(i => !i.expires_at).length` |
| 超1年权限数 | `items.filter(i => i.expires_at).length` |
| 已检查 组/项目 | `checked_groups / checked_projects` |

### 5.3 筛选栏

- 分类筛选：全部 / 永久权限 / 超1年权限
- 资源类型：全部 / 组 / 项目
- 文本搜索：用户名或资源名称
- 刷新按钮

### 5.4 批量操作栏

勾选行后出现，包含：
- 已选数量提示
- 日期选择器（设置统一到期时间）
- "批量设置" 按钮
- "清除选择" 按钮

### 5.5 表格列

| 列 | 说明 |
|----|------|
| 复选框 | 支持全选/反选 |
| 分类 | 永久 / 超1年（色标） |
| 用户名 | username + name 副标题 |
| 权限级别 | Owner/Maintainer/... 彩色标签 |
| 类型 | 组 / 项目 |
| 资源名称 | 可点击跳转（项目有链接） |
| 有效期 | 永久 或 具体日期 |
| 操作 | 日期选择器 + 设置按钮 |

---

## 6. 测试策略（TDD）

### 6.1 单元测试（`tests/long-lived-logic.test.js`）

覆盖 `isLongLived` 和 `classifyMember`：
- expires_at 为 null → 视为永久
- expires_at 为 undefined → 视为永久
- expires_at 距今恰好 365 天 → 不满足（边界）
- expires_at 距今 366 天 → 满足
- expires_at 距今 30 天 → 不满足
- expires_at 已过期 → 不满足

### 6.2 API 集成测试（`tests/server-long-lived.test.js`）

- 正常返回 `success: true` 及 items 数组
- `expires_at = null` 的成员被包含
- `expires_at` 超1年的成员被包含
- `expires_at` 在30天内的成员不被包含
- GitLab API 失败时返回 500 + error

---

## 7. 错误处理

- 单个组或项目的成员获取失败 → 记录 warn，跳过该资源，继续扫描（与现有 expiring 端点行为一致）
- 设置到期时间失败 → 显示错误提示，不影响其他行操作

---

## 8. 不在范围内

- 删除权限（仅设置到期时间，不支持移除成员）
- 修改权限级别（仅修改 expires_at）
- 子组成员（仅扫描直接成员，与现有 expiring 端点一致）
