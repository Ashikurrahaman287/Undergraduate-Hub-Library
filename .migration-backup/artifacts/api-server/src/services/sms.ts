const DEFAULT_SMS_API_BASE_URL = "https://swiftsms.astgd.com/api/sms/send";

export async function sendOtpSms(phone: string, otp: string) {
  const apiKey = process.env.SMS_API_KEY;
  if (!apiKey) {
    throw new Error("SMS_API_KEY is not configured.");
  }

  const url = new URL(process.env.SMS_API_BASE_URL || DEFAULT_SMS_API_BASE_URL);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("phonenumber", phone);
  url.searchParams.set(
    "message",
    `Undergraduate Hub verification code: ${otp}. This OTP will expire in 5 minutes. Do not share this code with anyone.`,
  );
  url.searchParams.set("label", process.env.SMS_API_LABEL || "transactional");

  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`SMS provider returned HTTP ${response.status}.`);
  }
}