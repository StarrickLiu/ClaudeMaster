// 共享 CSS 样式：对话框、按钮、脉冲动画
import { css } from "lit";

/** 对话框 overlay + 容器样式 */
export const dialogStyles = css`
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-md);
  }

  .dialog {
    background: var(--color-surface);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
  }

  .dialog-header {
    padding: var(--space-md) var(--space-lg);
    border-bottom: 1px solid var(--color-border);
    font-size: var(--font-size-base);
    font-weight: 600;
  }

  .dialog-body {
    padding: var(--space-md) var(--space-lg);
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-sm);
    padding: var(--space-md) var(--space-lg);
    border-top: 1px solid var(--color-border);
  }
`;

/** 操作按钮样式 */
export const buttonStyles = css`
  .btn {
    padding: var(--space-sm) var(--space-lg);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    font-weight: 500;
    cursor: pointer;
    border: none;
  }

  .btn-cancel {
    background: none;
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border);
  }

  .btn-cancel:hover {
    border-color: var(--color-text-muted);
    color: var(--color-text);
  }

  .btn-start {
    background: var(--color-primary);
    color: white;
  }

  .btn-start:hover:not(:disabled) {
    background: var(--color-primary-hover);
  }

  .btn-start:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

/** 脉冲动画 keyframes */
export const pulseKeyframes = css`
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
`;
