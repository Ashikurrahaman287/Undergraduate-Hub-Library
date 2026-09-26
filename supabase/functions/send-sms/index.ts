import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const hookSecret = Deno.env
  .get("SEND_SMS_HOOK_SECRET")
  ?.replace("v1,whsec_", "");

const swiftSmsApiUrl =
  Deno.env.get("SWIFTSMS_API_URL") || "https://swiftsms.astgd.com/api/sms/send";

const swiftSmsApiKey = Deno.env.get("SWIFTSMS_API_KEY");

const swiftSmsLabel = Deno.env.get("SWIFTSMS_LABEL") || "transactional";

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  // Only accept POST requests from Supabase Auth
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
    });
  }

  // Check required secrets
  if (!hookSecret) {
    console.error("SEND_SMS_HOOK_SECRET is missing.");

    return response({ error: "Server configuration error" }, 500);
  }

  if (!swiftSmsApiKey) {
    console.error("SWIFTSMS_API_KEY is missing.");

    return response({ error: "SMS provider configuration error" }, 500);
  }

  try {
    // IMPORTANT:
    // Read the raw request body before verifying the signature.
    const payload = await req.text();

    const headers = Object.fromEntries(req.headers);

    // Verify that the request actually came from Supabase.
    const webhook = new Webhook(hookSecret);

    const { user, sms } = webhook.verify(payload, headers) as {
      user: {
        id: string;
        phone?: string;
      };
      sms: {
        otp?: string;
      };
    };

    const phone = user?.phone;
    const otp = sms?.otp;

    // Validate Supabase payload
    if (!phone || !otp) {
      console.error("Phone or OTP missing from Supabase payload.");

      return response({ error: "Invalid SMS payload" }, 400);
    }

    // Undergraduate Hub currently supports Bangladesh numbers only.
    // Expected format: +8801XXXXXXXXX
    if (!/^\+8801\d{9}$/.test(phone)) {
      console.error("Non-Bangladesh phone number rejected.");

      return response(
        {
          error: "Only Bangladesh phone numbers are supported.",
        },
        400,
      );
    }

    // SMS message
    const message =
      `Undergraduate Hub Library verification code: ${otp}. ` +
      `Do not share this code with anyone.`;

    // Build SwiftSMS request
    const url = new URL(swiftSmsApiUrl);

    url.searchParams.set("apikey", swiftSmsApiKey);
    url.searchParams.set("phonenumber", phone);
    url.searchParams.set("message", message);
    url.searchParams.set("label", swiftSmsLabel);

    // Send SMS
    const smsResponse = await fetch(url.toString(), {
      method: "GET",
    });

    if (!smsResponse.ok) {
      console.error(`SwiftSMS returned HTTP ${smsResponse.status}`);

      return response({ error: "SMS provider request failed" }, 502);
    }

    // Do NOT log the OTP or API key.
    console.log(`SMS request accepted for ${phone.slice(0, 7)}***`);

    return response({
      success: true,
    });
  } catch (error) {
    console.error(
      "Send SMS hook error:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return response({ error: "Unable to send SMS" }, 500);
  }
});
