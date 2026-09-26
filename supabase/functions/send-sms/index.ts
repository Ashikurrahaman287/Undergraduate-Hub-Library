import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const hookSecret = Deno.env
  .get("SEND_SMS_HOOK_SECRET")
  ?.replace("v1,whsec_", "");

const swiftSmsApiUrl =
  Deno.env.get("SWIFTSMS_API_URL") || "https://swiftsms.astgd.com/api/sms/send";

const swiftSmsApiKey = Deno.env.get("SWIFTSMS_API_KEY");

const swiftSmsLabel = Deno.env.get("SWIFTSMS_LABEL") || "transactional";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
    });
  }

  if (!hookSecret) {
    console.error("SEND_SMS_HOOK_SECRET is not configured.");

    return jsonResponse({ error: "Server configuration error" }, 500);
  }

  if (!swiftSmsApiKey) {
    console.error("SWIFTSMS_API_KEY is not configured.");

    return jsonResponse({ error: "SMS provider configuration error" }, 500);
  }

  try {
    // IMPORTANT:
    // Read the raw body before verifying the webhook signature.
    const payload = await req.text();

    const headers = Object.fromEntries(req.headers);

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

    if (!phone || !otp) {
      console.error("Missing phone or OTP in Supabase hook payload.");

      return jsonResponse({ error: "Invalid SMS payload" }, 400);
    }

    // Only allow Bangladesh numbers.
    if (!/^\+8801\d{9}$/.test(phone)) {
      console.error("Rejected non-Bangladesh phone number.");

      return jsonResponse(
        { error: "Only Bangladesh phone numbers are supported" },
        400,
      );
    }

    const message =
      `Your Undergraduate Hub Library verification code is ${otp}. ` +
      `Do not share this code with anyone.`;

    const url = new URL(swiftSmsApiUrl);

    url.searchParams.set("apikey", swiftSmsApiKey);
    url.searchParams.set("phonenumber", phone);
    url.searchParams.set("message", message);
    url.searchParams.set("label", swiftSmsLabel);

    const smsResponse = await fetch(url.toString(), {
      method: "GET",
    });

    const responseText = await smsResponse.text();

    if (!smsResponse.ok) {
      console.error(`SwiftSMS HTTP error: ${smsResponse.status}`);

      return jsonResponse({ error: "SMS provider request failed" }, 502);
    }

    console.log(`OTP SMS accepted by provider for ${phone.slice(0, 7)}***`);

    // Supabase considers a 2xx response successful.
    return jsonResponse({
      success: true,
    });
  } catch (error) {
    console.error(
      "Send SMS hook error:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return jsonResponse({ error: "Unable to send SMS" }, 500);
  }
});
