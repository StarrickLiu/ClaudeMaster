# 配置

ClaudeMaster 通过环境变量和配置文件进行配置。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AUTH_TOKEN` | 无 | 设置后启用认证，后端绑定 `0.0.0.0` |
| `PORT` | `8420` | 后端监听端口 |
| `CM_LISTEN` | `:8420` | Caddy HTTPS 监听地址 |
| `CM_BACKEND` | `127.0.0.1:8421` | Caddy 反代的后端地址 |

## 认证

默认情况下，ClaudeMaster 仅监听 `127.0.0.1`，只有本机可以访问。

设置 `AUTH_TOKEN` 后：

- 后端自动绑定 `0.0.0.0`，局域网内其他设备可访问
- HTTP 请求需携带 `Authorization: Bearer <token>` 头
- WebSocket 连接需在 URL 中附加 `?token=<token>`
- 首次从浏览器访问时，页面会提示输入令牌

```bash
AUTH_TOKEN=your-secret-token ./start.sh
```

手机浏览器打开 `http://<电脑IP>:8420`，输入令牌即可。

## HTTPS（Caddy 反向代理）

对于外网访问，推荐使用 HTTPS：

```bash
# 安装 Caddy：https://caddyserver.com/docs/install
AUTH_TOKEN=your-secret-token make https
```

这会同时启动：

- 后端在 `:8421`（内部端口）
- Caddy HTTPS 反向代理在 `:8420`（对外端口）

!!! tip "自定义端口"
    ```bash
    CM_LISTEN=:443 CM_BACKEND=127.0.0.1:8421 AUTH_TOKEN=secret make https
    ```

Caddy 使用 `tls internal` 自动生成自签名证书，首次访问时浏览器会提示不安全，确认即可。

## 端口规划

| 服务 | 端口 | 说明 |
|------|------|------|
| 后端（HTTP 模式） | 8420 | 直接访问 |
| 后端（HTTPS 模式） | 8421 | 内部端口，Caddy 反代 |
| 前端（开发模式） | 5173 | Vite 开发服务器 |
| Caddy HTTPS | 8420 | 对外 HTTPS 端口 |
| 文档站 | 8430 | MkDocs 开发预览 |
