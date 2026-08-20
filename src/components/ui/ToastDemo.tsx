import React from 'react';
import { useToasts } from './toast';
import { Button } from './button-1';

export const ToastDemo: React.FC = () => {
  const toasts = useToasts();

  return (
    <div className="flex flex-wrap gap-2 p-4 bg-white/5 rounded-2xl border border-white/10">
      <Button
        type="primary"
        size="small"
        onClick={() => toasts.success("Your changes have been saved successfully.")}
      >
        Success Toast
      </Button>

      <Button
        type="tertiary"
        size="small"
        onClick={() => toasts.warning("High CPU usage detected on server node #4.")}
      >
        Warning Toast
      </Button>

      <Button
        type="tertiary"
        size="small"
        onClick={() => toasts.error("Authentication session timed out. Please reconnect.")}
      >
        Error Toast
      </Button>

      <Button
        type="tertiary"
        size="small"
        onClick={() =>
          toasts.message({
            text: "Workspace settings updated.",
            onUndoAction: () => {
              toasts.message("Changes reverted back to previous state.");
            },
          })
        }
      >
        Undo Toast
      </Button>

      <Button
        type="tertiary"
        size="small"
        onClick={() =>
          toasts.message({
            text: "New intelligence update available.",
            action: "Upgrade",
            onAction: () => {
              toasts.success("System updated to latest intelligence release.");
            },
          })
        }
      >
        Action Toast
      </Button>
    </div>
  );
};

export default ToastDemo;
