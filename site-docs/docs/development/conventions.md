# 编码规范

## Python

- 命名风格：`snake_case`
- 所有函数加类型标注
- 数据结构使用 Pydantic
- 每个源文件开头写一行注释说明用途
- API 端点在装饰器中写 `summary` 和 `description`
- 代码检查工具：ruff

```python
# 会话名称持久化存储
from pydantic import BaseModel

class SessionName(BaseModel):
    session_id: str
    name: str

def get_name(session_id: str) -> str | None:
    """获取会话名称。"""
    ...
```

## TypeScript

- 命名风格：`camelCase`
- 严格模式 (`strict: true`)
- Lit 装饰器定义组件
- 每个源文件开头写一行注释说明用途
- 代码检查工具：eslint

```typescript
// 会话摘要卡片组件
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('session-card')
export class SessionCard extends LitElement {
  @property() sessionId = '';
  // ...
}
```

## 文件组织

- 路由：`backend/routers/` — 每个资源一个文件
- 服务：`backend/services/` — 每个关注点一个文件
- 模型：`backend/models/` — Pydantic 数据模型
- 页面：`frontend/src/pages/` — 页面级组件
- 组件：`frontend/src/components/` — 可复用 UI 组件

## Git 规范

- 提交信息使用**中文**
- 保持提交粒度适中，每个提交做一件事

## 工程配置

| 工具 | 配置文件 | 说明 |
|------|---------|------|
| Ruff | `ruff.toml` | Python 代码检查（line-length=120, py312, select E/W/F/I/UP/N/B） |
| ESLint | `frontend/eslint.config.mjs` | TypeScript 代码检查（flat config + typescript-eslint） |
| TypeScript | `frontend/tsconfig.json` | 严格模式，ES2022，experimentalDecorators |
| pytest | `backend/pytest.ini` | 后端测试配置 |
| Vitest | `frontend/vite.config.ts` | 前端测试配置（test.environment: node） |
