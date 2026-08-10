# GitLab 用户管理工具

一个基于 Node.js + Express 的 GitLab 用户与权限管理 Web 工具，提供用户创建、权限管理、过期权限扫描、长期权限监控等功能。

## 功能特性

- **用户管理**：创建用户（支持随机密码或默认密码）、禁用/启用用户、搜索用户
- **权限管理**：查看组/项目成员及权限级别，批量添加、更新、移除成员权限
- **即将过期权限**：扫描未来 N 天内到期的权限（支持 SSE 实时进度），一键批量延期
- **长期权限监控**：识别永久权限和超 1 年权限，支持设置到期时间
- **限流重试**：自动处理 GitLab API 的 429 限流，避免批量扫描被中断

## 快速开始

### 环境要求

- Node.js 18+
- 一个 GitLab 实例和具有 API 权限的 Access Token

### 安装与启动

```bash
npm install
npm start
```

启动后访问 http://localhost:3010/

### 环境变量配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `GIT_LAB_API_BASE_URL` | GitLab API 地址 | `https://git.example.com/api/v4/` |
| `GIT_LAB_ACCESS_TOKEN` | GitLab Access Token（必填，建议使用 `glpat-` 开头的 token） | `YOUR_GITLAB_ACCESS_TOKEN` |
| `GIT_LAB_DEFAULT_PASSWORD` | 创建用户时的默认初始密码 | `YourDefaultPassword` |

示例：

```bash
# Windows (PowerShell)
$env:GIT_LAB_API_BASE_URL = "https://git.example.com/api/v4/"
$env:GIT_LAB_ACCESS_TOKEN = "glpat-xxxxxxxxxxxx"
npm start

# Linux / macOS
GIT_LAB_API_BASE_URL="https://git.example.com/api/v4/" GIT_LAB_ACCESS_TOKEN="glpat-xxxxxxxxxxxx" npm start
```

> **安全提示**：请通过环境变量注入凭据，切勿将真实 Token 硬编码到代码中或提交到仓库。

## 页面说明

| 页面 | 路径 | 功能 |
|------|------|------|
| 用户管理 | `/index.html` | 创建、禁用、启用、搜索用户 |
| 项目权限 | `/projects.html` | 查看组/项目成员，编辑权限级别与到期时间 |
| 即将过期 | `/expiring.html` | 扫描即将过期的权限，批量延期 |
| 长期权限 | `/permanent.html` | 查看永久/超1年权限，设置到期时间 |

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/create` | 创建用户 |
| POST | `/api/disable` | 禁用用户 |
| POST | `/api/enable` | 启用用户 |
| GET | `/api/users` | 获取用户列表（分页/搜索/状态过滤） |
| GET | `/api/groups` | 获取顶级组及成员信息 |
| GET | `/api/groups/:id/children` | 获取组子组和成员 |
| GET | `/api/groups/:id/projects` | 获取组内项目及成员 |
| POST | `/api/groups/:id/members/update` | 批量更新组成员权限 |
| POST | `/api/projects/:id/members/update` | 批量更新项目成员权限 |
| GET | `/api/expiring-permissions` | 获取即将过期权限 |
| GET | `/api/expiring-permissions/stream` | SSE 流式扫描即将过期权限 |
| GET | `/api/long-lived-permissions` | 获取长期有效权限 |
| GET | `/api/long-lived-permissions/stream` | SSE 流式扫描长期权限 |
| POST | `/api/batch-extend-permissions` | 批量延期权限 |

## 测试

```bash
npm test
```

包含单元测试（`src/` 下的纯逻辑）与 API 集成测试（`tests/`）。

## 项目结构

```
├── server.js              # Express 服务与全部 API
├── src/
│   ├── expiring-logic.js  # 过期/延期计算逻辑
│   └── long-lived-logic.js # 长期权限判定逻辑
├── public/                # 前端静态页面
├── tests/                 # Jest 测试
└── start.bat              # Windows 一键启动
```

## 许可

ISC
