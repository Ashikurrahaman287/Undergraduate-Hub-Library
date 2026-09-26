async function main() {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.ADMIN_INITIAL_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD;

  if (!supabaseUrl || !serviceRoleKey || !email || !password) {
    throw new Error(
      "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_INITIAL_EMAIL, and ADMIN_INITIAL_PASSWORD are required.",
    );
  }

  if (password.length < 12) {
    throw new Error("ADMIN_INITIAL_PASSWORD must be at least 12 characters.");
  }

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  async function readJson(response: Response) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: text };
    }
  }

  async function findOrCreateUser() {
    const createResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const created = (await readJson(createResponse)) as
      | { id?: string }
      | { message?: string }
      | null;
    if (createResponse.ok && created && "id" in created && created.id) return created.id;

    const listResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1000&page=1`, {
      headers,
    });
    const payload = (await readJson(listResponse)) as
      | { users?: Array<{ id?: string; email?: string }> }
      | { message?: string }
      | null;
    if (!listResponse.ok || !payload || !("users" in payload)) {
      throw new Error("Supabase administrator provisioning failed.");
    }
    const existing = payload.users?.find((user) => user.email?.toLowerCase() === email);
    if (!existing?.id) throw new Error("Supabase administrator provisioning failed.");

    const updateResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ password, email_confirm: true }),
    });
    if (!updateResponse.ok) throw new Error("Supabase administrator provisioning failed.");
    return existing.id;
  }

  const userId = await findOrCreateUser();
  const roleResponse = await fetch(
    `${supabaseUrl}/rest/v1/user_roles?on_conflict=user_id,role`,
    {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: userId, role: "admin", created_by: userId }),
    },
  );
  if (!roleResponse.ok) throw new Error("Administrator role assignment failed.");

  const memberLookup = await fetch(
    `${supabaseUrl}/rest/v1/members?auth_user_id=eq.${encodeURIComponent(userId)}&select=id`,
    { headers },
  );
  const members = (await readJson(memberLookup)) as Array<{ id?: string }> | null;
  if (!memberLookup.ok) throw new Error("Administrator profile lookup failed.");

  if (!members?.[0]?.id) {
    const memberResponse = await fetch(`${supabaseUrl}/rest/v1/members`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        auth_user_id: userId,
        name: "Undergraduate Hub administrator",
        email,
        phone: `admin-${userId}`,
        university: "Undergraduate Hub",
        role: "admin",
        status: "active",
      }),
    });
    if (!memberResponse.ok) throw new Error("Administrator profile creation failed.");
  }

  console.log(`Administrator provisioned for ${email}. Remove or rotate the initial provisioning variables now.`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Administrator provisioning failed.");
  process.exitCode = 1;
});