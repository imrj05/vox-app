import { LoaderCircle } from "@/components/icons";
import type React from "react";
import { cn } from "@/lib/utils";

export function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof LoaderCircle>): React.ReactElement {
  return (
    <LoaderCircle
      aria-label="Loading"
      className={cn("animate-spin", className)}
      role="status"
      {...props}
    />
  );
}
