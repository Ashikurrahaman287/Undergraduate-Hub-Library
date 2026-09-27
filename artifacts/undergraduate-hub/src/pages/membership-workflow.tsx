import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Clock3, CreditCard, FileCheck2, MapPin, PackageCheck, Plus, ShieldCheck, Truck, X } from "lucide-react";
import type { BorrowRequest } from "@workspace/api-client-react";
import { PageIntro } from "@/components/admin-shared";

type PaymentSummary = {
  id: string;
  amount: number;
  method: string;
  txid: string | null;
  status: string;
  submittedAt: string;
  reviewReason: string | null;
};

type Plan = {
  id: string;
  name: string;
  monthlyPrice: number;
  durationMonths: number;
  description: string;
  active: boolean;
};

type MemberStatusPayload = {
  member: {
    id: string;
    name: string;
    email: string | null;
    phone: string;
    university?: string;
    address?: string | null;
    membershipStatus: string;
    subscriptionStatus: string;
    assignedPlanId?: string | null;
  };
  membershipFee: number;
  membershipPayment: PaymentSummary | null;
  plan: Plan | null;
  subscriptionPayment: PaymentSummary | null;
  canBorrow: boolean;
};

type PaymentRequest = PaymentSummary & {
  memberId: string;
  memberName: string;
  memberPhone: string | null;
  memberIdLabel: string;
  address: string | null;
  type: string;
  screenshotUrl: string | null;
};

type DeliveryRequest = BorrowRequest & {
  memberId: string | null;
  address: string | null;
  bookIsbn: string | null;
  subscriptionPlan: number;
  deliveryDate?: string | null;
  deliverySlot?: string | null;
  deliveryStatus?: string | null;
  deliveryNote?: string | null;
};

const inputClass = "mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent";

async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

async function uploadScreenshot(file: File) {
  const request = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!request.ok) throw new Error(await readError(request, "Unable to prepare the screenshot upload."));
  const { uploadURL, objectPath } = (await request.json()) as { uploadURL: string; objectPath: string };
  const upload = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!upload.ok) throw new Error("The payment screenshot could not be uploaded.");
  return objectPath;
}

function StatusBadge({ value }: { value: string }) {
  const positive = ["approved", "active", "scheduled", "delivered"].includes(value);
  const negative = ["rejected", "suspended", "cancelled"].includes(value);
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${positive ? "bg-emerald-50 text-emerald-700" : negative ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{value.replaceAll("_", " ")}</span>;
}

function StageBar({ status }: { status: MemberStatusPayload }) {
  const stages = [
    ["Account created", true],
    ["Membership payment", Boolean(status.membershipPayment)],
    ["Membership approved", status.member.membershipStatus === "approved"],
    ["Subscription assigned", Boolean(status.plan)],
    ["Subscription active", status.member.subscriptionStatus === "active"],
    ["Ready to borrow", status.canBorrow],
  ] as const;
  return <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">{stages.map(([label, complete], index) => <div key={label} className="flex items-center gap-2 sm:block"><span className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold ${complete ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{complete ? <Check size={14} /> : index + 1}</span><span className={`text-xs font-bold ${complete ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>{index < stages.length - 1 && <span className="hidden h-px flex-1 bg-border sm:mt-4 sm:block" />}</div>)}</div>;
}

function PaymentState({ payment }: { payment: PaymentSummary | null }) {
  if (!payment) return <p className="text-sm text-muted-foreground">No payment submitted yet.</p>;
  return <div className="rounded-xl bg-muted/60 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold">TXID: <span className="font-mono">{payment.txid || "—"}</span></span><StatusBadge value={payment.status} /></div><p className="mt-1 text-xs text-muted-foreground">৳{payment.amount} via {payment.method} · {new Date(payment.submittedAt).toLocaleString("en-GB")}</p>{payment.reviewReason && <p className="mt-2 rounded-lg bg-rose-50 p-2 text-xs font-semibold text-rose-800">Admin note: {payment.reviewReason}</p>}</div>;
}

export function useMemberStatus() {
  const [data, setData] = useState<MemberStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/member/status", { credentials: "include" });
      if (!response.ok) throw new Error(await readError(response, "Membership status could not be loaded."));
      setData((await response.json()) as MemberStatusPayload);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Membership status could not be loaded.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);
  return { data, loading, error, refresh };
}

export function MembershipStagePreview() {
  const status = useMemberStatus();
  if (status.loading || !status.data) return <section className="rounded-2xl border border-border bg-card p-5"><p className="text-xs font-bold uppercase tracking-widest text-accent">Membership workflow</p><p className="mt-2 text-sm text-muted-foreground">Loading your current stage…</p></section>;
  const member = status.data.member;
  const next = member.membershipStatus !== "approved"
    ? "Submit the 99 BDT membership payment"
    : !status.data.plan
      ? "Waiting for an administrator to assign a subscription plan"
      : member.subscriptionStatus !== "active"
        ? `Submit your ৳${status.data.plan.monthlyPrice} subscription payment`
        : status.data.canBorrow ? "You are ready to request an available book" : "Finish your current borrowing request";
  return <section className="rounded-2xl border border-border bg-card p-5" data-testid="card-membership-stage"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-accent">Membership workflow</p><h2 className="mt-1 font-display text-xl font-extrabold">{next}</h2><p className="mt-1 text-sm text-muted-foreground">Your borrowing access is controlled by each approved step.</p></div><a href="/membership" className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground">View status</a></div><div className="mt-5"><StageBar status={status.data} /></div></section>;
}

export function MemberMembershipPage() {
  const status = useMemberStatus();
  const data = status.data;
  const [kind, setKind] = useState<"membership" | "subscription">("membership");
  const [method, setMethod] = useState<"bkash" | "nagad">("bkash");
  const [txid, setTxid] = useState("");
  const [amount, setAmount] = useState("99");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 16));
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setAddress(data.member.address ?? "");
    if (data.member.membershipStatus === "approved" && data.plan) {
      setKind("subscription");
      setAmount(String(data.plan.monthlyPrice));
    }
  }, [data]);

  const expectedAmount = kind === "membership" ? data?.membershipFee ?? 99 : data?.plan?.monthlyPrice ?? 0;
  const canSubmitMembership = data && data.member.membershipStatus !== "approved" && data.membershipPayment?.status !== "pending_admin_verification";
  const canSubmitSubscription = data && data.member.membershipStatus === "approved" && Boolean(data.plan) && data.member.subscriptionStatus !== "active" && data.member.subscriptionStatus !== "pending_verification";
  const submitPayment = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      let screenshotUrl: string | null = null;
      if (screenshot) screenshotUrl = await uploadScreenshot(screenshot);
      const response = await fetch("/api/member/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ kind, method, txid, amount: Number(amount), paymentDate, screenshotUrl }),
      });
      if (!response.ok) throw new Error(await readError(response, "Payment submission failed."));
      const result = (await response.json()) as { message: string };
      setMessage(result.message);
      setTxid("");
      setScreenshot(null);
      await status.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment submission failed.");
    } finally {
      setSaving(false);
    }
  };
  const saveAddress = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/member/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ address }),
      });
      if (!response.ok) throw new Error(await readError(response, "Delivery information could not be saved."));
      setMessage("Delivery information saved.");
      await status.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delivery information could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  if (status.loading) return <div className="space-y-4"><PageIntro eyebrow="Your membership" title="Membership & borrowing access" description="Track every approval step before you request a book." /><div className="h-40 animate-pulse rounded-2xl bg-muted" /></div>;
  if (status.error || !data) return <div className="space-y-4"><PageIntro eyebrow="Your membership" title="Membership & borrowing access" /><div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{status.error || "Membership status could not be loaded."}</div></div>;

  const showPaymentForm = kind === "membership" ? canSubmitMembership : canSubmitSubscription;
  return <><PageIntro eyebrow="Your membership" title="Membership & borrowing access" description="Complete each verified step before requesting a book. bKash and Nagad payments are recorded manually—never share a password or PIN." /><section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><StageBar status={data} /></section><div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]"><section className="space-y-5"><article className="rounded-2xl border border-border bg-card p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-accent">Step 1</p><h2 className="mt-1 font-display text-xl font-extrabold">Membership payment · ৳{data.membershipFee}</h2><p className="mt-2 text-sm text-muted-foreground">Pay the one-time membership fee through bKash or Nagad, then submit the TXID for admin verification.</p></div><CreditCard className="text-accent-foreground" size={22} /></div><div className="mt-4"><PaymentState payment={data.membershipPayment} /></div>{data.member.membershipStatus === "approved" && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">Membership approved. You can continue to subscription selection.</p>}</article><article className="rounded-2xl border border-border bg-card p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-accent">Step 2</p><h2 className="mt-1 font-display text-xl font-extrabold">Subscription plan</h2><p className="mt-2 text-sm text-muted-foreground">{data.plan ? `${data.plan.name} · ৳${data.plan.monthlyPrice} for ${data.plan.durationMonths} month${data.plan.durationMonths === 1 ? "" : "s"}` : "An administrator will assign your subscription plan after membership approval."}</p></div><ShieldCheck className="text-accent-foreground" size={22} /></div><div className="mt-4">{data.plan ? <><PaymentState payment={data.subscriptionPayment} />{data.member.subscriptionStatus === "active" && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">Subscription active. You can browse and request available books.</p>}</> : <p className="rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">Subscription selection is controlled by the admin panel.</p>}</div></article></section><section className="space-y-5"><article className="rounded-2xl border border-border bg-card p-5"><div className="flex items-start gap-3"><FileCheck2 className="mt-0.5 text-accent-foreground" size={20} /><div><h2 className="font-display text-lg font-bold">Submit a payment</h2><p className="mt-1 text-xs text-muted-foreground">After payment, enter the exact amount and unique TXID from bKash or Nagad.</p></div></div>{data.member.membershipStatus === "approved" && data.plan && <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-muted p-1"><button type="button" onClick={() => { setKind("subscription"); setAmount(String(data.plan?.monthlyPrice ?? 0)); }} className={`rounded-lg px-3 py-2 text-xs font-bold ${kind === "subscription" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>Subscription</button><button type="button" onClick={() => { setKind("membership"); setAmount(String(data.membershipFee)); }} className={`rounded-lg px-3 py-2 text-xs font-bold ${kind === "membership" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>Membership</button></div>}{showPaymentForm ? <form onSubmit={submitPayment} className="mt-4 space-y-3"><label className="block text-xs font-bold">Payment method<select value={method} onChange={(event) => setMethod(event.target.value as "bkash" | "nagad")} className={inputClass}><option value="bkash">bKash</option><option value="nagad">Nagad</option></select></label><div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-bold">Required amount (BDT)<input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} className={inputClass} /></label><label className="block text-xs font-bold">Payment date/time<input type="datetime-local" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className={inputClass} /></label></div><label className="block text-xs font-bold">Transaction ID (TXID)<input required value={txid} onChange={(event) => setTxid(event.target.value)} placeholder="Enter the unique bKash/Nagad TXID" className={inputClass} /></label><label className="block text-xs font-bold">Payment screenshot <span className="font-normal text-muted-foreground">(optional)</span><input type="file" accept="image/*" onChange={(event) => setScreenshot(event.target.files?.[0] ?? null)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2 text-xs" /></label>{error && <p className="rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-800">{error}</p>}{message && <p className="rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">{message}</p>}<button type="submit" disabled={saving || Number(amount) !== expectedAmount} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"><CreditCard size={16} />{saving ? "Submitting…" : `Submit ${kind} payment`}</button>{Number(amount) !== expectedAmount && <p className="text-xs font-semibold text-rose-700">Enter the required amount of ৳{expectedAmount}.</p>}</form> : <p className="mt-4 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">{data.member.membershipStatus === "approved" && !data.plan ? "Wait for the admin to assign a subscription plan." : data.member.subscriptionStatus === "pending_verification" || data.member.membershipStatus === "pending_verification" ? "Your payment has been submitted and is waiting for admin verification." : data.member.subscriptionStatus === "active" ? "Your subscription is active." : "Your membership payment is already approved."}</p>}</article><article className="rounded-2xl border border-border bg-card p-5"><div className="flex items-start gap-3"><MapPin className="mt-0.5 text-accent-foreground" size={20} /><div><h2 className="font-display text-lg font-bold">Delivery information</h2><p className="mt-1 text-xs text-muted-foreground">Keep your address ready for an approved book delivery.</p></div></div><form onSubmit={saveAddress} className="mt-4 space-y-3"><label className="block text-xs font-bold">Delivery address<textarea value={address} onChange={(event) => setAddress(event.target.value)} rows={3} placeholder="House, road, area, Dhaka" className="mt-1 w-full rounded-lg border border-border bg-background p-3 text-sm" /></label><button type="submit" disabled={saving} className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold hover:bg-muted">{saving ? "Saving…" : "Save delivery information"}</button></form></article></section></div></>;
}

export function AdminMembershipPage() {
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [members, setMembers] = useState<MemberStatusPayload["member"][]>([]);
  const [borrowRequests, setBorrowRequests] = useState<DeliveryRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewReason, setReviewReason] = useState<Record<string, string>>({});
  const [planForm, setPlanForm] = useState({ name: "", monthlyPrice: "49", durationMonths: "1", description: "" });
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [deliveryForm, setDeliveryForm] = useState<Record<string, { date: string; slot: string; status: string; note: string }>>({});

  const refresh = async () => {
    setLoading(true);
    try {
      const [paymentResponse, planResponse, memberResponse, requestResponse] = await Promise.all([
        fetch("/api/admin/payment-requests", { credentials: "include" }),
        fetch("/api/admin/subscription-plans", { credentials: "include" }),
        fetch("/api/members", { credentials: "include" }),
        fetch("/api/admin/requests", { credentials: "include" }),
      ]);
      for (const response of [paymentResponse, planResponse, memberResponse, requestResponse]) if (!response.ok) throw new Error(await readError(response, "Admin workflow data could not be loaded."));
      setRequests((await paymentResponse.json()) as PaymentRequest[]);
      setPlans((await planResponse.json()) as Plan[]);
      setMembers((await memberResponse.json()) as MemberStatusPayload["member"][]);
      setBorrowRequests((await requestResponse.json()) as DeliveryRequest[]);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Admin workflow data could not be loaded.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);

  const reviewPayment = async (id: string, status: "approved" | "rejected") => {
    const reason = reviewReason[id]?.trim() ?? "";
    if (status === "rejected" && !reason) { setError("A decline reason is required."); return; }
    const response = await fetch(`/api/admin/payment-requests/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ status, reason }) });
    if (!response.ok) { setError(await readError(response, "Payment review failed.")); return; }
    await refresh();
  };
  const createPlan = async (event: FormEvent) => {
    event.preventDefault();
    const response = await fetch("/api/admin/subscription-plans", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ ...planForm, monthlyPrice: Number(planForm.monthlyPrice), durationMonths: Number(planForm.durationMonths) }) });
    if (!response.ok) { setError(await readError(response, "Subscription plan could not be created.")); return; }
    setPlanForm({ name: "", monthlyPrice: "49", durationMonths: "1", description: "" });
    await refresh();
  };
  const assignPlan = async (memberId: string) => {
    const planId = assignments[memberId];
    if (!planId) return;
    const response = await fetch(`/api/admin/members/${memberId}/subscription`, { method: "PATCH", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ planId }) });
    if (!response.ok) { setError(await readError(response, "Subscription plan could not be assigned.")); return; }
    await refresh();
  };
  const scheduleDelivery = async (requestId: string) => {
    const form = deliveryForm[requestId];
    if (!form?.date || !form.slot) return;
    const response = await fetch(`/api/requests/${requestId}/delivery`, { method: "PATCH", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ deliveryDate: form.date, deliverySlot: form.slot, deliveryStatus: form.status, note: form.note }) });
    if (!response.ok) { setError(await readError(response, "Delivery could not be scheduled.")); return; }
    await refresh();
  };
  const pending = useMemo(() => requests.filter((request) => request.status === "pending_admin_verification"), [requests]);
  const schedulable = useMemo(() => borrowRequests.filter((request) => ["approved", "rescheduled", "collected"].includes(request.status)), [borrowRequests]);

  return <><PageIntro eyebrow="Membership operations" title="Verify access, then keep delivery moving." description="Review manual bKash/Nagad submissions, assign plans, and schedule approved book deliveries from one protected workspace." action={<button type="button" onClick={() => void refresh()} className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold hover:bg-muted">Refresh</button>} />{error && <p className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}{loading ? <div className="h-56 animate-pulse rounded-2xl bg-muted" /> : <div className="space-y-6"><section className="rounded-2xl border border-border bg-card p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-accent">Payment verification</p><h2 className="mt-1 font-display text-xl font-extrabold">{pending.length} payment{pending.length === 1 ? "" : "s"} waiting for review</h2></div><CreditCard className="text-accent-foreground" size={22} /></div><div className="mt-5 space-y-3">{pending.length === 0 ? <p className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">No payment submissions are waiting for verification.</p> : pending.map((request) => <article key={request.id} className="rounded-xl border border-border p-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><p className="font-bold">{request.memberName} <span className="font-mono text-xs text-muted-foreground">· {request.memberIdLabel}</span></p><p className="mt-1 text-xs text-muted-foreground">{request.memberPhone || "Phone not listed"} · {request.address || "Address not provided"}</p><div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-muted px-2.5 py-1 font-bold capitalize">{request.type}</span><span className="rounded-full bg-muted px-2.5 py-1 font-bold">৳{request.amount} via {request.method}</span><span className="rounded-full bg-muted px-2.5 py-1 font-mono font-bold">TXID {request.txid || "—"}</span></div><p className="mt-2 text-xs text-muted-foreground">Submitted {new Date(request.submittedAt).toLocaleString("en-GB")}</p>{request.screenshotUrl && <a href={`/api/storage/objects/${request.screenshotUrl.replace(/^\/objects\//, "")}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-bold text-accent-foreground underline">View payment screenshot</a>}</div><div className="w-full max-w-sm space-y-2"><textarea value={reviewReason[request.id] ?? ""} onChange={(event) => setReviewReason({ ...reviewReason, [request.id]: event.target.value })} rows={2} placeholder="Required only when declining" className="w-full rounded-lg border border-border bg-background p-2 text-xs" /><div className="flex justify-end gap-2"><button type="button" onClick={() => void reviewPayment(request.id, "rejected")} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700"><X size={14} /> Decline</button><button type="button" onClick={() => void reviewPayment(request.id, "approved")} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"><Check size={14} /> Approve</button></div></div></div></article>)}</div></section><div className="grid gap-6 xl:grid-cols-2"><section className="rounded-2xl border border-border bg-card p-5"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 text-accent-foreground" size={20} /><div><p className="text-xs font-bold uppercase tracking-widest text-accent">Subscription plans</p><h2 className="mt-1 font-display text-xl font-extrabold">Create flexible pricing</h2></div></div><form onSubmit={createPlan} className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold">Plan name<input required value={planForm.name} onChange={(event) => setPlanForm({ ...planForm, name: event.target.value })} className={inputClass} /></label><label className="text-xs font-bold">Monthly price<input required type="number" min="1" value={planForm.monthlyPrice} onChange={(event) => setPlanForm({ ...planForm, monthlyPrice: event.target.value })} className={inputClass} /></label><label className="text-xs font-bold">Duration (months)<input required type="number" min="1" value={planForm.durationMonths} onChange={(event) => setPlanForm({ ...planForm, durationMonths: event.target.value })} className={inputClass} /></label><label className="text-xs font-bold sm:col-span-2">Description<input value={planForm.description} onChange={(event) => setPlanForm({ ...planForm, description: event.target.value })} className={inputClass} /></label><button type="submit" className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"><Plus size={15} /> Create plan</button></form><div className="mt-5 space-y-2">{plans.map((plan) => <div key={plan.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 p-3"><div><p className="text-sm font-bold">{plan.name} · ৳{plan.monthlyPrice}</p><p className="text-xs text-muted-foreground">{plan.durationMonths} month{plan.durationMonths === 1 ? "" : "s"} · {plan.description}</p></div><StatusBadge value={plan.active ? "active" : "inactive"} /></div>)}</div></section><section className="rounded-2xl border border-border bg-card p-5"><div className="flex items-start gap-3"><PackageCheck className="mt-0.5 text-accent-foreground" size={20} /><div><p className="text-xs font-bold uppercase tracking-widest text-accent">Assign access</p><h2 className="mt-1 font-display text-xl font-extrabold">Choose a plan for approved members</h2></div></div><div className="mt-4 max-h-[420px] space-y-2 overflow-auto">{members.filter((member) => member.membershipStatus === "approved").map((member) => <div key={member.id} className="rounded-xl border border-border p-3"><div className="flex items-center justify-between gap-2"><div><p className="text-sm font-bold">{member.name}</p><p className="text-xs text-muted-foreground">{member.phone} · {member.subscriptionStatus}</p></div><StatusBadge value={member.subscriptionStatus} /></div><div className="mt-3 flex gap-2"><select value={assignments[member.id] ?? member.assignedPlanId ?? ""} onChange={(event) => setAssignments({ ...assignments, [member.id]: event.target.value })} className={`${inputClass} mt-0`}><option value="">Select plan</option>{plans.filter((plan) => plan.active).map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · ৳{plan.monthlyPrice}</option>)}</select><button type="button" onClick={() => void assignPlan(member.id)} className="shrink-0 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground">Assign</button></div></div>)}</div></section></div><section className="rounded-2xl border border-border bg-card p-5"><div className="flex items-start gap-3"><Truck className="mt-0.5 text-accent-foreground" size={20} /><div><p className="text-xs font-bold uppercase tracking-widest text-accent">Delivery scheduling</p><h2 className="mt-1 font-display text-xl font-extrabold">Schedule approved borrowing requests</h2></div></div><div className="mt-5 space-y-3">{schedulable.length === 0 ? <p className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">Approve a borrowing request before scheduling delivery.</p> : schedulable.map((request) => { const form = deliveryForm[request.id] ?? { date: request.deliveryDate ?? "", slot: request.deliverySlot ?? "3:00 PM – 5:00 PM", status: request.deliveryStatus ?? "scheduled", note: request.deliveryNote ?? "" }; return <article key={request.id} className="rounded-xl border border-border p-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><p className="font-bold">{request.bookTitle}</p><p className="mt-1 text-xs text-muted-foreground">{request.memberName} · {request.memberPhone || "Phone not listed"} · {request.address || "Address not provided"}</p><p className="mt-2 text-xs text-muted-foreground">Subscription: {request.subscriptionStatus || "unknown"} · Payment: approved</p></div><div className="grid w-full gap-2 sm:grid-cols-2 lg:max-w-2xl"><label className="text-xs font-bold">Delivery date<input type="date" value={form.date} onChange={(event) => setDeliveryForm({ ...deliveryForm, [request.id]: { ...form, date: event.target.value } })} className={inputClass} /></label><label className="text-xs font-bold">Time slot<select value={form.slot} onChange={(event) => setDeliveryForm({ ...deliveryForm, [request.id]: { ...form, slot: event.target.value } })} className={inputClass}><option>3:00 PM – 5:00 PM</option><option>5:00 PM – 7:00 PM</option><option>10:00 AM – 12:00 PM</option></select></label><label className="text-xs font-bold">Delivery status<select value={form.status} onChange={(event) => setDeliveryForm({ ...deliveryForm, [request.id]: { ...form, status: event.target.value } })} className={inputClass}><option value="scheduled">Scheduled</option><option value="out_for_delivery">Out for delivery</option><option value="delivered">Delivered</option></select></label><label className="text-xs font-bold">Admin note<input value={form.note} onChange={(event) => setDeliveryForm({ ...deliveryForm, [request.id]: { ...form, note: event.target.value } })} className={inputClass} /></label><button type="button" onClick={() => void scheduleDelivery(request.id)} disabled={!form.date} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground sm:col-span-2"><CalendarIcon /> {form.deliveryDate ? "Update delivery" : "Schedule delivery"}</button></div></div></article>; })}</div></section></div>}</>;
}

function CalendarIcon() {
  return <Clock3 size={15} className="mr-2 inline" />;
}