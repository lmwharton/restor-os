"use client";

import { forwardRef, type InputHTMLAttributes, useId } from "react";

type FormFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Visible label text. */
  label: string;
  /** Inline error message — when present, the field renders in error state. */
  error?: string | null;
  /** Optional helper text (renders below the field when there's no error). */
  helper?: string;
  /** When true, shows a red asterisk after the label. */
  required?: boolean;
};

/**
 * Shared form field used across onboarding screens.
 *
 * Features baked in:
 * - `onFocus={(e) => e.target.select()}` per project convention
 * - Error state with red border + small error text
 * - Helper text slot (hidden when an error is shown)
 * - Asterisk for required fields
 * - Connects label/input/help via aria-describedby
 *
 * Caller still supplies `type`, `inputMode`, `autoComplete`, `value`,
 * `onChange`, etc. — anything that's a native input attribute.
 */
const FormField = forwardRef<HTMLInputElement, FormFieldProps>(function FormField(
  {
    label,
    error,
    helper,
    required,
    onFocus,
    id,
    className,
    ...inputProps
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helperId = `${inputId}-helper`;
  const errorId = `${inputId}-error`;
  const hasError = Boolean(error);

  return (
    <div className="flex flex-col">
      <label
        htmlFor={inputId}
        className="block text-[11px] font-semibold tracking-[0.1em] uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]"
      >
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1 text-red-500">
            *
          </span>
        ) : null}
      </label>
      <input
        id={inputId}
        ref={ref}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : helper ? helperId : undefined}
        onFocus={(e) => {
          e.target.select();
          onFocus?.(e);
        }}
        className={[
          "w-full h-12 px-4 rounded-lg text-on-surface text-[15px]",
          "placeholder:text-outline outline-none transition-all duration-200",
          "bg-surface-container-low focus:bg-surface-container-lowest",
          hasError
            ? "ring-2 ring-red-400/60 focus:ring-red-500/70"
            : "focus:ring-2 focus:ring-primary/20",
          className ?? "",
        ].join(" ")}
        {...inputProps}
      />
      {hasError ? (
        <p
          id={errorId}
          role="alert"
          className="mt-1.5 text-[12px] leading-snug text-red-600"
        >
          {error}
        </p>
      ) : helper ? (
        <p
          id={helperId}
          className="mt-1.5 text-[12px] leading-snug text-on-surface-variant"
        >
          {helper}
        </p>
      ) : null}
    </div>
  );
});

export default FormField;
