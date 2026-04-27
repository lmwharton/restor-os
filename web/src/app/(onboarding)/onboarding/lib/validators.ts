/**
 * Pure validation logic for the onboarding wizard.
 *
 * Kept side-effect-free so each rule can be unit-tested without touching
 * React. The screens import these and feed the results to `<FormField>`'s
 * `error` prop — no validation library, no hidden form state.
 */

const ZIP_REGEX = /^\d{5}(-\d{4})?$/;
// Accepts any reasonable phone shape — backend re-validates.
const PHONE_REGEX = /^[\d().+\-\s]{7,}$/;

export type CompanyProfileFields = {
  ownerName: string;
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
};

export type CompanyProfileErrors = Partial<Record<keyof CompanyProfileFields, string>>;

export function validateCompanyProfile(
  fields: CompanyProfileFields,
): CompanyProfileErrors {
  const errors: CompanyProfileErrors = {};
  if (!fields.ownerName.trim()) errors.ownerName = "Your name is required.";
  if (!fields.name.trim()) errors.name = "Company name is required.";
  if (!fields.phone.trim()) errors.phone = "Phone number is required.";
  else if (!PHONE_REGEX.test(fields.phone.trim()))
    errors.phone = "Enter a valid phone number.";
  if (!fields.address.trim()) errors.address = "Street address is required.";
  if (!fields.city.trim()) errors.city = "City is required.";
  if (!fields.state.trim()) errors.state = "State is required.";
  else if (fields.state.trim().length !== 2)
    errors.state = "Use the 2-letter state code.";
  if (!fields.zip.trim()) errors.zip = "ZIP is required.";
  else if (!ZIP_REGEX.test(fields.zip.trim()))
    errors.zip = "Use a 5-digit ZIP (or ZIP+4).";
  return errors;
}

export type QuickJobFields = {
  address_line1: string;
  city: string;
  state: string;
  zip: string;
  customer_name: string;
  customer_phone: string;
};

export type QuickJobErrors = Partial<Record<keyof QuickJobFields, string>>;

export function validateQuickJob(fields: QuickJobFields): QuickJobErrors {
  const errors: QuickJobErrors = {};
  if (!fields.address_line1.trim())
    errors.address_line1 = "Address is required.";
  if (!fields.city.trim()) errors.city = "City is required.";
  if (!fields.state.trim()) errors.state = "State is required.";
  else if (fields.state.trim().length !== 2)
    errors.state = "Use the 2-letter state code.";
  if (!fields.zip.trim()) errors.zip = "ZIP is required.";
  else if (!ZIP_REGEX.test(fields.zip.trim()))
    errors.zip = "Use a 5-digit ZIP.";
  if (!fields.customer_name.trim())
    errors.customer_name = "Customer name is required.";
  if (!fields.customer_phone.trim())
    errors.customer_phone = "Customer phone is required.";
  else if (!PHONE_REGEX.test(fields.customer_phone.trim()))
    errors.customer_phone = "Enter a valid phone number.";
  return errors;
}

export type FirstJobFields = QuickJobFields;
export type FirstJobErrors = QuickJobErrors;
export const validateFirstJob = validateQuickJob;

export function isXlsxFile(file: File): boolean {
  // Match by extension AND/OR mime — Safari sometimes sends an empty type.
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".xlsx")) return false;
  if (
    file.type &&
    file.type !==
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" &&
    file.type !== "application/octet-stream"
  ) {
    return false;
  }
  return true;
}
