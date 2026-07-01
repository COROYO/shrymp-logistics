import { BetaCtaSection } from "@/app/_components/beta-cta-section";
import { FaqSection } from "@/app/_components/faq-section";
import { FeaturesSection } from "@/app/_components/features-section";
import { HeroSection } from "@/app/_components/hero-section";
import { HowItWorksSection } from "@/app/_components/how-it-works-section";
import { ProblemSection } from "@/app/_components/problem-section";
import { SiteFooter } from "@/app/_components/site-footer";
import { SiteHeader } from "@/app/_components/site-header";
import { TestimonialsSection } from "@/app/_components/testimonials-section";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <HeroSection />
        <ProblemSection />
        <FeaturesSection />
        <HowItWorksSection />
        <TestimonialsSection />
        <FaqSection />
        <BetaCtaSection />
      </main>
      <SiteFooter />
    </>
  );
}
