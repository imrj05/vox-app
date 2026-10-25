import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FAQ_ITEMS, type FaqItem } from "@/data/content";
import { PAGE_CONTAINER } from "@/lib/layout";

function FaqColumn({ items, offset }: { items: FaqItem[]; offset: number }) {
  return (
    <Accordion type="multiple">
      {items.map((item, index) => (
        <AccordionItem key={item.question} value={`faq-${offset + index}`}>
          <AccordionTrigger>
            <span>{item.question}</span>
            <span
              aria-hidden="true"
              className="relative grid size-6 shrink-0 place-items-center text-foreground/70"
            >
              <span className="absolute h-px w-5 bg-current" />
              <span className="absolute h-5 w-px bg-current transition-transform duration-300 ease-out group-data-[state=open]:scale-y-0" />
            </span>
          </AccordionTrigger>
          <AccordionContent>{item.answer}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 py-16 sm:py-20">
      <div className={PAGE_CONTAINER}>
        <div className="mb-10 max-w-2xl">
          <div className="mb-6 flex items-center gap-2">
            <div className="flex size-6 items-center justify-center bg-secondary">
              <div className="size-3 bg-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              Frequently asked questions
            </p>
          </div>
          <h2 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Answers before you install.
          </h2>
          <p className="mt-5 max-w-md leading-relaxed text-muted-foreground">
            What runs locally, what leaves your Mac, and what happens to your
            transcripts.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-x-10">
          <FaqColumn items={FAQ_ITEMS.slice(0, 4)} offset={0} />
          <FaqColumn items={FAQ_ITEMS.slice(4)} offset={4} />
        </div>
      </div>
    </section>
  );
}
