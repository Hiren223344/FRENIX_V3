import type { ReactNode } from 'react';

export type ToastType = 'message' | 'success' | 'warning' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  title?: string | ReactNode;
  text?: string | ReactNode;
  description?: string | ReactNode;
  type?: ToastType;
  duration?: number;
  measuredHeight?: number;
  createdAt: number;
  onUndoAction?: () => void;
  action?: string | ToastAction;
  onAction?: () => void;
  preserve?: boolean;
  pause?: () => void;
  resume?: () => void;
}

type Listener = () => void;

class ToastStore {
  toasts: ToastItem[] = [];
  private listeners: Set<Listener> = new Set();
  private timers: Map<string, { timeoutId: any; remaining: number; start: number }> = new Map();

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  add(toast: Omit<ToastItem, 'id' | 'createdAt'> & { id?: string }) {
    const id = toast.id || Math.random().toString(36).slice(2, 9);
    const duration = toast.preserve ? 0 : (toast.duration ?? 4500);
    const createdAt = Date.now();

    const toastItem: ToastItem = {
      ...toast,
      id,
      text: toast.text ?? toast.title,
      duration,
      createdAt,
      pause: () => this.pauseTimer(id),
      resume: () => this.resumeTimer(id),
    };

    this.toasts = [...this.toasts, toastItem];
    if (duration > 0) {
      this.startTimer(id, duration);
    }
    this.notify();
    return id;
  }

  success(title: string | ReactNode, description?: string | ReactNode, options?: Partial<ToastItem>) {
    return this.add({ title, text: title, description, type: 'success', ...options });
  }

  error(title: string | ReactNode, description?: string | ReactNode, options?: Partial<ToastItem>) {
    return this.add({ title, text: title, description, type: 'error', ...options });
  }

  warning(title: string | ReactNode, description?: string | ReactNode, options?: Partial<ToastItem>) {
    return this.add({ title, text: title, description, type: 'warning', ...options });
  }

  info(title: string | ReactNode, description?: string | ReactNode, options?: Partial<ToastItem>) {
    return this.add({ title, text: title, description, type: 'info', ...options });
  }

  message(title: string | ReactNode, description?: string | ReactNode, options?: Partial<ToastItem>) {
    return this.add({ title, text: title, description, type: 'message', ...options });
  }

  remove(id: string) {
    this.clearTimer(id);
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.notify();
  }

  updateHeight(id: string, height: number) {
    const item = this.toasts.find((t) => t.id === id);
    if (item && item.measuredHeight !== height) {
      item.measuredHeight = height;
      this.notify();
    }
  }

  private startTimer(id: string, duration: number) {
    if (duration <= 0) return;
    const timeoutId = setTimeout(() => {
      this.remove(id);
    }, duration);
    this.timers.set(id, {
      timeoutId,
      remaining: duration,
      start: Date.now(),
    });
  }

  private pauseTimer(id: string) {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer.timeoutId);
      const elapsed = Date.now() - timer.start;
      timer.remaining = Math.max(0, timer.remaining - elapsed);
    }
  }

  private resumeTimer(id: string) {
    const timer = this.timers.get(id);
    if (timer && timer.remaining > 0) {
      timer.start = Date.now();
      timer.timeoutId = setTimeout(() => {
        this.remove(id);
      }, timer.remaining);
    }
  }

  private clearTimer(id: string) {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer.timeoutId);
      this.timers.delete(id);
    }
  }
}

export const toastStore = new ToastStore();
