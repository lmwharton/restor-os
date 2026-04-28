/**
 * Tiny presentational helpers shared across onboarding screens. Kept
 * together so a single screen can import once and not pollute the global
 * components/ folder with one-off bits.
 *
 * - <SelectField> — labeled native <select>, matches FormField's visual
 *   language exactly (h-12, rounded-lg, focus rings).
 * - <PrimaryButton> / <SecondaryButton> — wizard action buttons (left/right
 *   row layout per spec).
 * - <ChevronDown> — affordance for the select.
 */
"use client";

import type { ButtonHTMLAttributes, SelectHTMLAttributes } from "react";
import { forwardRef, useId } from "react";

// ─── Select ──────────────────────────────────────────────────────────

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  required?: boolean;
  error?: string | null;
  helper?: string;
  options: { value: string; label: string }[];
  /** Render as a placeholder before user picks. */
  placeholder?: string;
};

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  function SelectField(
    { label, required, error, helper, options, placeholder, id, className, ...rest },
    ref,
  ) {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    const hasError = Boolean(error);

    return (
      <div className="flex flex-col">
        <label
          htmlFor={selectId}
          className="block text-[11px] font-semibold tracking-[0.1em] uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]"
        >
          {label}
          {required ? <span aria-hidden className="ml-1 text-red-500">*</span> : null}
        </label>
        <div className="relative">
          <select
            id={selectId}
            ref={ref}
            aria-invalid={hasError || undefined}
            className={[
              "appearance-none w-full h-12 px-4 pr-10 rounded-lg text-on-surface text-[15px]",
              "outline-none transition-all duration-200",
              "bg-surface-container-low focus:bg-surface-container-lowest",
              hasError
                ? "ring-2 ring-red-400/60 focus:ring-red-500/70"
                : "focus:ring-2 focus:ring-primary/20",
              className ?? "",
            ].join(" ")}
            {...rest}
          >
            {placeholder ? (
              <option value="" disabled>
                {placeholder}
              </option>
            ) : null}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown />
        </div>
        {hasError ? (
          <p role="alert" className="mt-1.5 text-[12px] leading-snug text-red-600">
            {error}
          </p>
        ) : helper ? (
          <p className="mt-1.5 text-[12px] leading-snug text-on-surface-variant">
            {helper}
          </p>
        ) : null}
      </div>
    );
  },
);

function ChevronDown() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Buttons ─────────────────────────────────────────────────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
};

export function PrimaryButton({
  loading,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={[
        "h-12 px-6 rounded-xl text-[14px] font-semibold text-on-primary bg-brand-accent",
        "cursor-pointer transition-all duration-200",
        "hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98]",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:active:scale-100",
        "inline-flex items-center justify-center gap-2",
        className ?? "",
      ].join(" ")}
    >
      {loading ? (
        <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : (
        children
      )}
    </button>
  );
}

export function SecondaryButton({
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={[
        "h-12 px-5 rounded-xl text-[14px] font-medium text-on-surface",
        "border bg-white cursor-pointer transition-all duration-200",
        "hover:bg-surface-container-low active:scale-[0.98]",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white",
        "inline-flex items-center justify-center gap-2",
        className ?? "",
      ].join(" ")}
      style={{ borderColor: "#e1bfb4" }}
    >
      {children}
    </button>
  );
}

// ─── US States ───────────────────────────────────────────────────────

export const US_STATE_OPTIONS: { value: string; label: string }[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"],
  ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"],
  ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
  ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"],
  ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"],
  ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"],
  ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"],
  ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"],
  ["WI", "Wisconsin"], ["WY", "Wyoming"],
].map(([value, label]) => ({ value, label }));
