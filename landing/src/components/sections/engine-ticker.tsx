import { ENGINE_TICKER } from "@/data/content";

export function EngineTicker() {
  return (
    <div className="vox-marquee relative mt-5 flex w-full overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
      <div className="vox-marquee-track flex w-max shrink-0 items-center">
        {[0, 1].map((copy) => (
          <ul
            key={copy}
            aria-hidden={copy === 1}
            className="flex shrink-0 items-center"
          >
            {ENGINE_TICKER.map((engine) => (
              <li
                key={`${copy}-${engine.name}-${engine.meta}`}
                className="flex shrink-0 items-center gap-2.5 pr-10 md:pr-14"
              >
                <span
                  aria-hidden="true"
                  className="grid size-5 shrink-0 place-items-center bg-card/70"
                >
                  <span className="size-2 bg-foreground" />
                </span>
                <span className="whitespace-nowrap text-sm font-medium text-foreground">
                  {engine.name}
                </span>
                <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
                  {engine.meta}
                </span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
