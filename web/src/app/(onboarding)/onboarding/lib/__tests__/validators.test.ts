/**
 * Unit tests for onboarding wizard validation rules.
 *
 * Pure-function checks — exercise the constraints each screen relies on
 * without booting React or hitting the network. Goal: every rule from
 * the spec covered with at least one passing + one failing case.
 */

import { describe, expect, it } from "vitest";
import {
  isXlsxFile,
  validateCompanyProfile,
  validateFirstJob,
  validateQuickJob,
  type CompanyProfileFields,
  type QuickJobFields,
} from "../validators";

const baseCompany: CompanyProfileFields = {
  name: "Dry Pros QA",
  phone: "555-123-4567",
  address: "123 Main St",
  city: "Warren",
  state: "MI",
  zip: "48089",
};

const baseJob: QuickJobFields = {
  address_line1: "123 Main St",
  city: "Warren",
  state: "MI",
  zip: "48089",
  customer_name: "Jane Doe",
  customer_phone: "555-123-4567",
};

describe("validateCompanyProfile", () => {
  it("accepts a fully-populated, valid profile", () => {
    expect(validateCompanyProfile(baseCompany)).toEqual({});
  });

  it("flags missing company name", () => {
    const errors = validateCompanyProfile({ ...baseCompany, name: "   " });
    expect(errors.name).toBeTruthy();
  });

  it("flags missing phone and bad phone separately", () => {
    expect(validateCompanyProfile({ ...baseCompany, phone: "" }).phone).toBeTruthy();
    expect(validateCompanyProfile({ ...baseCompany, phone: "abc" }).phone).toBeTruthy();
  });

  it("requires a 2-letter state abbreviation", () => {
    const longState = validateCompanyProfile({ ...baseCompany, state: "Michigan" });
    expect(longState.state).toBeTruthy();

    const empty = validateCompanyProfile({ ...baseCompany, state: "" });
    expect(empty.state).toBeTruthy();
  });

  it("accepts both 5-digit and ZIP+4 codes", () => {
    expect(validateCompanyProfile({ ...baseCompany, zip: "48089" }).zip).toBeUndefined();
    expect(validateCompanyProfile({ ...baseCompany, zip: "48089-1234" }).zip).toBeUndefined();
  });

  it("rejects malformed ZIPs", () => {
    expect(validateCompanyProfile({ ...baseCompany, zip: "4808" }).zip).toBeTruthy();
    expect(validateCompanyProfile({ ...baseCompany, zip: "ABCDE" }).zip).toBeTruthy();
  });

  it("returns errors only for the fields that are bad", () => {
    const errors = validateCompanyProfile({
      ...baseCompany,
      name: "",
      city: "",
    });
    expect(Object.keys(errors).sort()).toEqual(["city", "name"]);
  });
});

describe("validateQuickJob / validateFirstJob", () => {
  it("accepts a populated row", () => {
    expect(validateQuickJob(baseJob)).toEqual({});
    // First-job validator is the same logic — guard against drift.
    expect(validateFirstJob(baseJob)).toEqual({});
  });

  it("requires customer fields", () => {
    const errors = validateQuickJob({
      ...baseJob,
      customer_name: "",
      customer_phone: "",
    });
    expect(errors.customer_name).toBeTruthy();
    expect(errors.customer_phone).toBeTruthy();
  });

  it("requires the address block", () => {
    const errors = validateQuickJob({
      ...baseJob,
      address_line1: "",
      city: "",
      state: "",
      zip: "",
    });
    expect(Object.keys(errors).sort()).toEqual(
      ["address_line1", "city", "state", "zip"].sort(),
    );
  });
});

describe("isXlsxFile", () => {
  function makeFile(name: string, type = "") {
    // jsdom's File constructor is fine here.
    return new File(["data"], name, { type });
  }

  it("accepts a vanilla .xlsx", () => {
    expect(
      isXlsxFile(
        makeFile(
          "pricing.xlsx",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
      ),
    ).toBe(true);
  });

  it("accepts uppercase extensions", () => {
    expect(isXlsxFile(makeFile("PRICING.XLSX"))).toBe(true);
  });

  it("rejects non-xlsx extensions", () => {
    expect(isXlsxFile(makeFile("pricing.csv"))).toBe(false);
    expect(isXlsxFile(makeFile("pricing.xls"))).toBe(false);
  });

  it("tolerates Safari's blank mime type", () => {
    expect(isXlsxFile(makeFile("pricing.xlsx"))).toBe(true);
  });

  it("rejects mismatched mime types even when the extension is xlsx", () => {
    expect(isXlsxFile(makeFile("pricing.xlsx", "text/plain"))).toBe(false);
  });
});
