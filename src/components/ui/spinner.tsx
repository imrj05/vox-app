import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("relative inline-flex size-4 items-center justify-center", className)}
      {...props}
    >
      <span className="absolute inset-0 rounded-full border border-border/70" />
      <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary border-r-primary/55 animate-spin" />
      <span className="size-1 rounded-full bg-primary/85 shadow-[0_0_18px_rgba(99,102,241,0.45)]" />
    </div>
  )
}

export { Spinner }
