// Server component that renders an accessible Q&A block. Wire this in alongside
// the matching `faqLd()` JSON-LD so the same content powers both the rendered
// page AND the structured-data extract used by Google AIO / Perplexity / etc.
//
// Keep markup semantic — <details>/<summary> requires no JS and is keyboard
// accessible by default. Avoid client components: the FAQ is static text.

interface FaqItem {
  question: string;
  answer: string;
}

export default function FaqSection({ items, heading = "Frequently asked questions" }: { items: FaqItem[]; heading?: string }) {
  if (!items?.length) return null;
  return (
    <section className="mt-10 mb-6 rounded-lg border border-border bg-card/50 p-6" aria-labelledby="faq-heading">
      <h2 id="faq-heading" className="text-lg font-semibold mb-4">{heading}</h2>
      <div className="space-y-2">
        {items.map((item, idx) => (
          <details key={idx} className="group rounded border border-border/60 bg-background/40 px-4 py-3 open:bg-background/70">
            <summary className="cursor-pointer list-none flex items-start justify-between gap-3 font-medium text-sm">
              <span>{item.question}</span>
              <span className="text-muted-foreground text-lg leading-none group-open:rotate-45 transition-transform" aria-hidden="true">+</span>
            </summary>
            <div className="mt-2 text-sm text-muted-foreground leading-relaxed">{item.answer}</div>
          </details>
        ))}
      </div>
    </section>
  );
}
