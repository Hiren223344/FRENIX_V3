import React from "react";
import { useToasts } from "./toast";
import { Button } from "./button-1";

export default function SuccessDemo() {
  const toasts = useToasts();
  return (
    <Button
      type="primary"
      onClick={(): void => {
        toasts.success("Your changes have been saved successfully.");
      }}
    >
      Show Toast
    </Button>
  );
}
