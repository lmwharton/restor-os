import Link from "next/link";
import { WaterDamage } from "@/components/icons";

/**
 * Crewmatic brand wordmark with water damage icon.
 * Renders as a link to the home page.
 */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-1.5 ${className ?? ""}`}
    >
      <WaterDamage
        size={20}
        className="text-brand-accent"
        aria-hidden="true"
      />
      <span className="text-[17px] font-semibold tracking-[-0.45px] text-on-surface">
        crewmatic
      </span>
    </Link>
  );
}
