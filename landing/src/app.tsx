import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ClosingCta } from "@/components/sections/closing-cta";
import { Faq } from "@/components/sections/faq";
import { FeatureGrid } from "@/components/sections/feature-grid";
import { Hero } from "@/components/sections/hero";
import { Privacy } from "@/components/sections/privacy";
import { Walkthrough } from "@/components/sections/walkthrough";

export function App() {
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        <Hero />
        <FeatureGrid />
        <Walkthrough />
        <Privacy />
        <Faq />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}
