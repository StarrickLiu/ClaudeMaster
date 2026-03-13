# 测试策略

## 测试框架

| 端 | 框架 | 运行命令 |
|----|------|----------|
| 后端 | pytest + httpx AsyncClient | `make test-backend` |
| 前端 | Vitest | `make test-frontend` |

## 文件命名

测试文件与源码放在**同一目录**：

```
backend/services/
  session_store.py        ← 源码
  session_store_test.py   ← 测试

frontend/src/components/
  chat-input.ts           ← 源码
  chat-input.test.ts      ← 测试
```

## 后端测试

使用 pytest + httpx `AsyncClient` 进行异步 API 测试：

```python
# session_store_test.py
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_list_sessions(client: AsyncClient):
    resp = await client.get("/api/sessions")
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
```

共享 fixtures 定义在 `backend/conftest.py` 中。

## 前端测试

使用 Vitest 测试 Lit Web Components：

```typescript
// chat-input.test.ts
import { describe, it, expect } from 'vitest';

describe('ChatInput', () => {
  it('should emit message event', () => {
    // ...
  });
});
```

## 运行测试

```bash
# 全部测试
make test

# 仅后端
make test-backend

# 仅前端
make test-frontend

# 运行特定测试（后端）
cd backend && conda run -n claudemaster pytest -v -k "test_name"

# 运行特定测试（前端）
cd frontend && npx vitest run src/components/chat-input.test.ts
```
