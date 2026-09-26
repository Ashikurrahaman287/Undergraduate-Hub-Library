const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

export function normalizeBangladeshiPhone(value: string) {
  const asciiValue = value
    .trim()
    .replace(/[০-৯]/g, (digit) => String(BANGLA_DIGITS.indexOf(digit)))
    .replace(/\u200B/g, "");
  if (!asciiValue || !/^[+]?[0-9\s().-]+$/.test(asciiValue)) {
    throw new Error("Enter a valid Bangladeshi mobile number.");
  }

  const compact = asciiValue.replace(/[\s().-]/g, "");
  if (compact.includes("+") && !compact.startsWith("+")) {
    throw new Error("Enter a valid Bangladeshi mobile number.");
  }

  const withoutCountryPrefix = compact.startsWith("+880")
    ? compact.slice(4)
    : compact.startsWith("880")
      ? compact.slice(3)
      : compact;
  const mobilePart = withoutCountryPrefix.startsWith("0")
    ? withoutCountryPrefix.slice(1)
    : withoutCountryPrefix;
  const local = `0${mobilePart}`;
  if (!/^01[3-9]\d{8}$/.test(local)) {
    throw new Error("Enter a valid Bangladeshi mobile number.");
  }
  return `+880${local.slice(1)}`;
}