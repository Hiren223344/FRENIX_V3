import React, { useEffect, useState, useRef, useSyncExternalStore, useCallback, ReactNode } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { toastStore, ToastItem } from './toastStore';
import './Toaster.css';

export interface Message {
  text: string | ReactNode;
  preserve?: boolean;
  action?: string;
  onAction?: () => void;
  onUndoAction?: () => void;
}

export const ToastContainer: React.FC = () => {
  const toasts = useSyncExternalStore(
    (cb) => toastStore.subscribe(cb),
    () => toastStore.toasts
  );

  const [isHovered, setIsHovered] = useState(false);
  const [shownIds, setShownIds] = useState<string[]>([]);

  useEffect(() => {
    const unseen = toasts.filter((t) => !shownIds.includes(t.id)).map((t) => t.id);
    if (unseen.length > 0) {
      const timer = setTimeout(() => {
        setShownIds((prev) => [...prev, ...unseen]);
      }, 20);
      return () => clearTimeout(timer);
    }
  }, [toasts, shownIds]);

  const lastVisibleCount = 3;
  const lastVisibleStart = Math.max(0, toasts.length - lastVisibleCount);
  const visibleToasts = toasts.slice(lastVisibleStart);
  const containerHeight = visibleToasts.reduce((acc, toast) => {
    return acc + (toast.measuredHeight || 63);
  }, 0);

  const getFinalTransform = (index: number, length: number) => {
    if (index === length - 1) {
      return "none";
    }
    const offset = length - 1 - index;
    let translateY = toasts[length - 1]?.measuredHeight || 63;
    for (let i = length - 1; i > index; i--) {
      if (isHovered) {
        translateY += (toasts[i - 1]?.measuredHeight || 63) + 10;
      } else {
        translateY += 20;
      }
    }
    const z = -offset;
    const scale = isHovered ? 1 : 1 - 0.05 * offset;
    return `translate3d(0, calc(100% - ${translateY}px), ${z}px) scale(${scale})`;
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    toastStore.toasts.forEach((t) => t.pause?.());
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    toastStore.toasts.forEach((t) => t.resume?.());
  };

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] pointer-events-none w-[420px] max-w-[calc(100vw-32px)]"
      style={{ height: containerHeight }}
    >
      <div
        className="relative pointer-events-auto w-full h-full"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {toasts.map((toast, index) => {
          const isVisible = index >= lastVisibleStart;
          const isShown = shownIds.includes(toast.id);
          const transform = isShown
            ? getFinalTransform(index, toasts.length)
            : "translate3d(0, 100%, 150px) scale(1)";

          return (
            <ToastCardItem
              key={toast.id}
              toast={toast}
              index={index}
              lastVisibleStart={lastVisibleStart}
              isVisible={isVisible}
              transform={transform}
              isHovered={isHovered}
            />
          );
        })}
      </div>
    </div>
  );
};

export const Toaster = ToastContainer;

let root: Root | null = null;
export const mountContainer = () => {
  if (root) return;
  const el = document.createElement("div");
  el.className = "toast-root";
  document.body.appendChild(el);
  root = createRoot(el);
  root.render(<ToastContainer />);
};

export const useToasts = () => {
  const message = useCallback((msg: string | Message) => {
    mountContainer();
    const item = typeof msg === 'string' ? { text: msg } : msg;
    return toastStore.add({ ...item, type: 'message' });
  }, []);

  const success = useCallback((msg: string | Message) => {
    mountContainer();
    const item = typeof msg === 'string' ? { text: msg } : msg;
    return toastStore.add({ ...item, type: 'success' });
  }, []);

  const warning = useCallback((msg: string | Message) => {
    mountContainer();
    const item = typeof msg === 'string' ? { text: msg } : msg;
    return toastStore.add({ ...item, type: 'warning' });
  }, []);

  const error = useCallback((msg: string | Message) => {
    mountContainer();
    const item = typeof msg === 'string' ? { text: msg } : msg;
    return toastStore.add({ ...item, type: 'error' });
  }, []);

  const info = useCallback((msg: string | Message, description?: string) => {
    mountContainer();
    const item = typeof msg === 'string' ? { text: msg, description } : msg;
    return toastStore.add({ ...item, type: 'info' });
  }, []);

  return {
    message,
    success,
    warning,
    error,
    info,
    remove: useCallback((id: string) => toastStore.remove(id), []),
  };
};

interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  type?: 'primary' | 'tertiary';
  svgOnly?: boolean;
  size?: 'small' | 'medium';
}

export const Button: React.FC<ButtonProps> = ({
  type = 'tertiary',
  svgOnly,
  size,
  className = '',
  children,
  ...props
}) => {
  const classes = [
    'toast-btn',
    `btn-${type}`,
    svgOnly ? 'svgOnly' : '',
    size ? `size-${size}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  );
};

export const UndoIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="currentColor"
  >
    <path d="M4.5 5.5A4.5 4.5 0 0 1 9 1a4.5 4.5 0 0 1 4.5 4.5V7a.75.75 0 0 1-1.5 0V5.5a3 3 0 1 0-5.83 1.018l1.41-1.411a.75.75 0 0 1 1.06 1.06l-2.75 2.75a.75.75 0 0 1-1.06 0L2.08 6.167a.75.75 0 1 1 1.06-1.06l1.36 1.361V5.5z" />
  </svg>
);

export const CloseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="currentColor"
  >
    <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
  </svg>
);

interface ToastCardItemProps {
  toast: ToastItem;
  index: number;
  lastVisibleStart: number;
  isVisible: boolean;
  transform: string;
  isHovered: boolean;
}

const ToastCardItem: React.FC<ToastCardItemProps> = ({
  toast,
  index,
  lastVisibleStart,
  isVisible,
  transform,
  isHovered,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cardRef.current) {
      const height = cardRef.current.getBoundingClientRect().height;
      toastStore.updateHeight(toast.id, height);
    }
  }, [toast.id, toast.title, toast.text, toast.description]);

  const typeThemeClass =
    toast.type === 'message'
      ? 'bg-geist-background text-gray-1000'
      : toast.type === 'success'
      ? 'bg-blue-700 text-contrast-fg'
      : toast.type === 'warning'
      ? 'bg-amber-800 text-gray-1000 dark:text-gray-100'
      : toast.type === 'error'
      ? 'bg-red-800 text-contrast-fg'
      : 'bg-geist-background text-gray-1000';

  const svgFillClass =
    toast.type === 'message'
      ? 'fill-gray-1000'
      : toast.type === 'success'
      ? 'fill-contrast-fg'
      : toast.type === 'warning'
      ? 'fill-gray-1000 dark:fill-gray-100'
      : toast.type === 'error'
      ? 'fill-contrast-fg'
      : 'fill-contrast-fg';

  const actionLabel =
    typeof toast.action === 'string'
      ? toast.action
      : toast.action?.label || 'Action';

  return (
    <div
      ref={cardRef}
      className={`absolute right-0 bottom-0 shadow-menu rounded-xl leading-[21px] p-4 h-fit ${typeThemeClass} ${
        isVisible ? 'opacity-100' : 'opacity-0'
      } ${index < lastVisibleStart ? 'pointer-events-none' : 'pointer-events-auto'} ${
        isHovered ? 'shadow-hover' : ''
      }`}
      style={{
        width: 420,
        maxWidth: 'calc(100vw - 32px)',
        transition: 'all .35s cubic-bezier(.25,.75,.6,.98)',
        transform,
      }}
    >
      <div className="flex flex-col items-start justify-between text-[.875rem] w-full">
        <div className="w-full h-full flex items-center justify-between gap-4">
          <span className="font-medium">{toast.text || toast.title}</span>

          {!toast.action && (
            <div className="flex gap-1 items-center">
              {toast.onUndoAction && (
                <Button
                  type="tertiary"
                  svgOnly
                  size="small"
                  onClick={() => {
                    toast.onUndoAction?.();
                    toastStore.remove(toast.id);
                  }}
                  aria-label="Undo action"
                >
                  <UndoIcon className={svgFillClass} />
                </Button>
              )}
              <Button
                type="tertiary"
                svgOnly
                size="small"
                onClick={() => toastStore.remove(toast.id)}
                aria-label="Dismiss notification"
              >
                <CloseIcon className={svgFillClass} />
              </Button>
            </div>
          )}
        </div>

        {toast.action && (
          <div className="w-full flex items-center justify-end gap-2 mt-2">
            <Button
              type="tertiary"
              onClick={() => toastStore.remove(toast.id)}
            >
              Dismiss
            </Button>
            <Button
              type="primary"
              size="small"
              onClick={() => {
                if (typeof toast.action === 'object' && toast.action?.onClick) {
                  toast.action.onClick();
                } else {
                  toast.onAction?.();
                }
                toastStore.remove(toast.id);
              }}
            >
              {actionLabel}
            </Button>
          </div>
        )}

        {toast.description && (
          <div className="text-xs opacity-80 mt-1">{toast.description}</div>
        )}
      </div>
    </div>
  );
};
