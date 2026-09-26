import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAnalyticsQueryKey,
  getListBooksQueryKey,
  getListBorrowRequestsQueryKey,
  getListMembersQueryKey,
  getListMyBooksQueryKey,
  getListNotificationsQueryKey,
  getListPaymentsQueryKey,
  useCreateBook,
  useCreateMember,
  useListBooks,
  useListBorrowRequests,
  useListMembers,
  useListPayments,
  useRecordPayment,
  useUpdateBook,
  useUpdateMember,
  useUpdateBorrowRequestStatus,
} from "@workspace/api-client-react";
import type { Book, BorrowRequest, Member, Payment } from "@workspace/api-client-react";
import { AlertCircle, BookOpen, Check, Pencil, Plus, RefreshCw, Search, X } from "lucide-react";
import { PageIntro } from "@/components/admin-shared";

function InlineStatus({ value }: { value: string }) {
  const positive = ["available", "active", "paid", "approved", "collected"].includes(value);
  const warning = ["pending", "rented", "partially_paid"].includes(value);
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${
        positive
          ? "bg-emerald-50 text-emerald-700"
          : warning
            ? "bg-amber-50 text-amber-700"
            : "bg-rose-50 text-rose-700"
      }`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <AlertCircle size={16} />
      {message}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant = "primary",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "outline" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        variant === "primary"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : variant === "danger"
            ? "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
            : "border border-border bg-card text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-muted" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-xs font-bold">
      {label}
      {children}
    </label>
  );
}

const inputClass = "mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent";

export function AdminInventoryOperations() {
  const query = useListBooks({ page: 1, pageSize: 48 });
  const books = query.data ?? [];
  const create = useCreateBook();
  const update = useUpdateBook();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Book | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [category, setCategory] = useState("Other");
  const [language, setLanguage] = useState("English");
  const [price, setPrice] = useState("0");
  const [deposit, setDeposit] = useState("300");
  const [error, setError] = useState("");

  const visible = useMemo(
    () =>
      books.filter((book) =>
        `${book.title} ${book.author} ${book.qrCode}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [books, search],
  );
  const close = () => {
    setOpen(false);
    setEditing(null);
    setTitle("");
    setAuthor("");
    setCategory("Other");
    setLanguage("English");
    setPrice("0");
    setDeposit("300");
    setError("");
  };
  const startEdit = (book: Book) => {
    setEditing(book);
    setTitle(book.title);
    setAuthor(book.author);
    setCategory(book.category);
    setLanguage(book.language);
    setPrice(String(book.price ?? 0));
    setDeposit(String(book.depositAmount));
    setOpen(true);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!title.trim() || !author.trim()) {
      setError("Title and author are required.");
      return;
    }
    const data = {
      title: title.trim(),
      author: author.trim(),
      category: category.trim() || "Other",
      language,
      price: Number(price) || 0,
      depositAmount: Number(deposit) || 0,
      depositRequired: Number(deposit) > 0,
      ...(editing ? {} : { coverUrl: null, isbn: null, conditionNote: "Good condition" }),
    };
    const onSuccess = () => {
      client.invalidateQueries({ queryKey: getListBooksQueryKey() });
      close();
    };
    if (editing) update.mutate({ id: editing.id, data }, { onSuccess, onError: (err) => setError(err instanceof Error ? err.message : "Book update failed.") });
    else create.mutate({ data }, { onSuccess, onError: (err) => setError(err instanceof Error ? err.message : "Book creation failed.") });
  };
  const toggleLost = (book: Book) => {
    if (book.status === "rented") return;
    update.mutate(
      { id: book.id, data: { status: book.status === "lost" ? "available" : "lost" } },
      { onSuccess: () => client.invalidateQueries({ queryKey: getListBooksQueryKey() }) },
    );
  };

  return (
    <>
      <PageIntro
        eyebrow="Library operations"
        title="Every book accounted for."
        description="Add books, update catalog details, and keep availability aligned with circulation."
        action={<ActionButton onClick={() => setOpen(true)}><Plus size={15} /> Add book</ActionButton>}
      />
      {query.isError && <ErrorBox message="Inventory could not be loaded. Try again." />}
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, author, QR…" className={`${inputClass} mt-0 pl-9`} />
          </label>
          <span className="text-xs text-muted-foreground">{visible.length} books shown</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-muted/55 text-[10px] uppercase tracking-widest text-muted-foreground"><tr><th className="px-5 py-3">Book</th><th className="px-5 py-3">Category</th><th className="px-5 py-3">Deposit</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-border">
              {visible.map((book) => (
                <tr key={book.id} className="hover:bg-muted/30">
                  <td className="px-5 py-4"><p className="font-bold">{book.title}</p><p className="mt-1 text-xs text-muted-foreground">{book.author} · {book.qrCode}</p></td>
                  <td className="px-5 py-4 text-muted-foreground">{book.category}</td>
                  <td className="px-5 py-4">{book.depositRequired ? `৳${book.depositAmount}` : "None"}</td>
                  <td className="px-5 py-4"><InlineStatus value={book.status} /></td>
                  <td className="px-5 py-4 text-right"><div className="flex justify-end gap-2"><ActionButton variant="outline" onClick={() => startEdit(book)}><Pencil size={14} /> Edit</ActionButton><ActionButton variant="outline" onClick={() => toggleLost(book)} disabled={book.status === "rented"}>{book.status === "lost" ? "Mark available" : book.status === "rented" ? "Issued" : "Mark lost"}</ActionButton></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {open && <Modal title={editing ? "Edit book" : "Add a book"} onClose={close}><form onSubmit={save} className="mt-5 space-y-4"><Field label="Title"><input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} /></Field><Field label="Author"><input value={author} onChange={(event) => setAuthor(event.target.value)} className={inputClass} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Category"><input value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass} /></Field><Field label="Language"><select value={language} onChange={(event) => setLanguage(event.target.value)} className={inputClass}><option>English</option><option>Bangla</option></select></Field><Field label="Book price"><input type="number" min="0" value={price} onChange={(event) => setPrice(event.target.value)} className={inputClass} /></Field><Field label="Deposit amount"><input type="number" min="0" value={deposit} onChange={(event) => setDeposit(event.target.value)} className={inputClass} /></Field></div>{error && <ErrorBox message={error} />}<div className="flex justify-end gap-2"><ActionButton variant="outline" onClick={close}>Cancel</ActionButton><ActionButton disabled={create.isPending || update.isPending}>{create.isPending || update.isPending ? "Saving…" : "Save book"}</ActionButton></div></form></Modal>}
    </>
  );
}

export function AdminCirculationOperations() {
  const query = useListBorrowRequests();
  const requests = query.data ?? [];
  const update = useUpdateBorrowRequestStatus();
  const client = useQueryClient();
  const [error, setError] = useState("");
  const refresh = () => {
    client.invalidateQueries({ queryKey: getListBorrowRequestsQueryKey() });
    client.invalidateQueries({ queryKey: getListBooksQueryKey() });
    client.invalidateQueries({ queryKey: getListMyBooksQueryKey() });
    client.invalidateQueries({ queryKey: getGetAnalyticsQueryKey() });
    client.invalidateQueries({ queryKey: getListMembersQueryKey() });
    client.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  };
  const changeStatus = (request: BorrowRequest, status: string) => {
    setError("");
    update.mutate(
      { id: request.id, data: { status, note: null, pickupDate: null, pickupSlot: null, dueDate: null } },
      { onSuccess: refresh, onError: (err) => setError(err instanceof Error ? err.message : "Circulation update failed.") },
    );
  };
  const reject = (request: BorrowRequest) => {
    const reason = window.prompt("Rejection reason (required)");
    if (reason?.trim()) {
      update.mutate(
        { id: request.id, data: { status: "rejected", note: reason.trim(), pickupDate: null, pickupSlot: null, dueDate: null } },
        { onSuccess: refresh, onError: (err) => setError(err instanceof Error ? err.message : "Request update failed.") },
      );
    }
  };
  return (
    <>
      <PageIntro eyebrow="Circulation desk" title="Keep every promise." description="Approve requests, issue books at pickup, and record returns from one queue." action={<ActionButton variant="outline" onClick={() => query.refetch()}><RefreshCw size={14} /> Refresh</ActionButton>} />
      {error && <ErrorBox message={error} />}
      {query.isError && <ErrorBox message="Request queue could not be loaded." />}
      <div className="space-y-3">
        {requests.length === 0 ? <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center text-sm text-muted-foreground">Queue is clear.</div> : requests.map((request) => (
          <article key={request.id} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="flex gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><BookOpen size={17} /></span><div><h2 className="font-display font-bold">{request.bookTitle}</h2><p className="mt-1 text-xs text-muted-foreground">{request.memberName} · {request.memberPhone ?? "Phone not listed"} · Pickup {request.pickupDate}, {request.pickupSlot}</p><div className="mt-3 flex flex-wrap gap-2 text-[11px]"><span className="rounded-full bg-muted px-2.5 py-1 font-bold">Deposit: {request.depositStatus ?? "unknown"}</span><span className="rounded-full bg-muted px-2.5 py-1 font-bold">Subscription: {request.subscriptionStatus ?? "unknown"}</span>{request.lateFee > 0 && <span className="rounded-full bg-rose-50 px-2.5 py-1 font-bold text-rose-700">Late fee ৳{request.lateFee}</span>}</div></div></div><div className="flex flex-wrap items-center gap-2 lg:justify-end"><InlineStatus value={request.status} />{request.status === "pending" && <><ActionButton onClick={() => changeStatus(request, "approved")} disabled={update.isPending}><Check size={14} /> Approve</ActionButton><ActionButton variant="danger" onClick={() => reject(request)} disabled={update.isPending}>Reject</ActionButton></>}{(request.status === "approved" || request.status === "rescheduled") && <ActionButton onClick={() => changeStatus(request, "collected")} disabled={update.isPending}><Check size={14} /> Issue book</ActionButton>}{request.status === "collected" && <ActionButton onClick={() => changeStatus(request, "returned")} disabled={update.isPending}><Check size={14} /> Mark returned</ActionButton>}</div></div>
            {request.status === "approved" && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-800">Approved. Confirm the handoff with “Issue book” when the member arrives.</p>}
            {request.status === "collected" && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">Book is currently with {request.memberName}. Due date: {request.dueDate ?? "calculated on issue"}.</p>}
          </article>
        ))}
      </div>
    </>
  );
}

export function AdminMemberOperations() {
  const query = useListMembers();
  const members = query.data ?? [];
  const create = useCreateMember();
  const update = useUpdateMember();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", university: "", studentId: "", plan: "29" });
  const shown = members.filter((member) => `${member.name} ${member.email ?? ""} ${member.phone}`.toLowerCase().includes(search.toLowerCase()));
  const close = () => { setOpen(false); setError(""); setForm({ name: "", email: "", phone: "", university: "", studentId: "", plan: "29" }); };
  const save = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!form.name.trim() || !form.phone.trim() || !form.university.trim()) { setError("Name, phone, and university are required."); return; }
    create.mutate({ data: { name: form.name.trim(), email: form.email.trim() || null, phone: form.phone.trim(), university: form.university.trim(), studentId: form.studentId.trim() || null, subscriptionPlan: Number(form.plan) as 29 | 49 } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListMembersQueryKey() }); close(); }, onError: (err) => setError(err instanceof Error ? err.message : "Member creation failed.") });
  };
  const toggleStatus = (member: Member) => {
    const next = member.status === "suspended" ? "active" : "suspended";
    update.mutate({ id: member.id, data: { status: next } }, { onSuccess: () => client.invalidateQueries({ queryKey: getListMembersQueryKey() }), onError: (err) => setError(err instanceof Error ? err.message : "Member update failed.") });
  };
  return (
    <>
      <PageIntro eyebrow="Member directory" title="People who keep reading." description="Register members and keep subscription, deposit, and account status current." action={<ActionButton onClick={() => setOpen(true)}><Plus size={15} /> Add member</ActionButton>} />
      {error && <ErrorBox message={error} />}
      <section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="border-b border-border p-4"><label className="relative block max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, or phone…" className={`${inputClass} mt-0 pl-9`} /></label></div><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-muted/55 text-[10px] uppercase tracking-widest text-muted-foreground"><tr><th className="px-5 py-3">Member</th><th className="px-5 py-3">Plan</th><th className="px-5 py-3">Deposit</th><th className="px-5 py-3">Fees</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-border">{shown.map((member) => <tr key={member.id} className="hover:bg-muted/30"><td className="px-5 py-4"><p className="font-bold">{member.name}</p><p className="mt-1 text-xs text-muted-foreground">{member.email ?? "No email"} · {member.phone}</p></td><td className="px-5 py-4">{member.plan}<p className="text-xs text-muted-foreground">৳{member.subscriptionPlan}</p></td><td className="px-5 py-4"><InlineStatus value={member.depositStatus} /></td><td className="px-5 py-4 font-semibold">{member.outstandingFees ? `৳${member.outstandingFees}` : "—"}</td><td className="px-5 py-4"><InlineStatus value={member.status} /></td><td className="px-5 py-4 text-right"><ActionButton variant={member.status === "suspended" ? "primary" : "danger"} onClick={() => toggleStatus(member)} disabled={update.isPending}>{member.status === "suspended" ? "Activate" : "Suspend"}</ActionButton></td></tr>)}</tbody></table></div></section>
      {open && <Modal title="Register member" onClose={close}><form onSubmit={save} className="mt-5 space-y-4"><Field label="Full name"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} /></Field><Field label="Email"><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className={inputClass} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Phone"><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className={inputClass} /></Field><Field label="University"><input value={form.university} onChange={(event) => setForm({ ...form, university: event.target.value })} className={inputClass} /></Field><Field label="Student ID"><input value={form.studentId} onChange={(event) => setForm({ ...form, studentId: event.target.value })} className={inputClass} /></Field><Field label="Subscription plan"><select value={form.plan} onChange={(event) => setForm({ ...form, plan: event.target.value })} className={inputClass}><option value="29">29 BDT</option><option value="49">49 BDT</option></select></Field></div>{error && <ErrorBox message={error} />}<div className="flex justify-end gap-2"><ActionButton variant="outline" onClick={close}>Cancel</ActionButton><ActionButton disabled={create.isPending}>{create.isPending ? "Saving…" : "Register member"}</ActionButton></div></form></Modal>}
    </>
  );
}

export function AdminPaymentOperations() {
  const query = useListPayments();
  const payments = query.data ?? [];
  const membersQuery = useListMembers();
  const members = membersQuery.data ?? [];
  const record = useRecordPayment();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [memberId, setMemberId] = useState("");
  const [amount, setAmount] = useState("29");
  const [method, setMethod] = useState("cash");
  const [type, setType] = useState("subscription");
  const [reference, setReference] = useState("");
  const total = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const selectedMember = memberId || members[0]?.id;
    const numericAmount = Number(amount);
    if (!selectedMember || !Number.isFinite(numericAmount) || numericAmount <= 0) { setError("Choose a member and enter an amount greater than zero."); return; }
    record.mutate({ data: { memberId: selectedMember, amount: numericAmount, method, type, reference: reference.trim() || null } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListPaymentsQueryKey() }); client.invalidateQueries({ queryKey: getListMembersQueryKey() }); client.invalidateQueries({ queryKey: getGetAnalyticsQueryKey() }); client.invalidateQueries({ queryKey: getListNotificationsQueryKey() }); setOpen(false); setReference(""); }, onError: (err) => setError(err instanceof Error ? err.message : "Payment could not be recorded.") });
  };
  return (
    <>
      <PageIntro eyebrow="Offline payments" title="Make every taka traceable." description="Record cash, bKash, or Nagad collections and update the member balance in the same workflow." action={<ActionButton onClick={() => setOpen(true)}><Plus size={15} /> Record payment</ActionButton>} />
      {error && <ErrorBox message={error} />}
      <section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border p-5"><div><p className="text-xs font-semibold text-muted-foreground">Recorded collections</p><p className="font-display text-2xl font-extrabold">৳{total.toLocaleString()}</p></div><span className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{payments.length} entries</span></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted/55 text-[10px] uppercase tracking-widest text-muted-foreground"><tr><th className="px-5 py-3">Member</th><th className="px-5 py-3">Amount</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Method</th><th className="px-5 py-3">Reference</th><th className="px-5 py-3">Date</th></tr></thead><tbody className="divide-y divide-border">{payments.map((payment: Payment) => <tr key={payment.id} className="hover:bg-muted/30"><td className="px-5 py-4 font-bold">{payment.memberName}</td><td className="px-5 py-4 font-display font-bold">৳{payment.amount}</td><td className="px-5 py-4"><span className="capitalize">{payment.type.replaceAll("_", " ")}</span><span className="ml-2 text-xs text-muted-foreground">· <InlineStatus value={payment.status} /></span></td><td className="px-5 py-4 capitalize">{payment.method}</td><td className="px-5 py-4 font-mono text-xs text-muted-foreground">{payment.reference || "—"}</td><td className="px-5 py-4 text-muted-foreground">{new Date(payment.paidAt).toLocaleDateString("en-GB")}</td></tr>)}</tbody></table></div></section>
      {open && <Modal title="Record payment" onClose={() => setOpen(false)}><form onSubmit={submit} className="mt-5 space-y-4"><Field label="Member"><select value={memberId || members[0]?.id || ""} onChange={(event) => setMemberId(event.target.value)} className={inputClass}>{members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.phone}</option>)}</select></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Amount (BDT)"><input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} className={inputClass} /></Field><Field label="Method"><select value={method} onChange={(event) => setMethod(event.target.value)} className={inputClass}><option value="cash">Cash</option><option value="bkash">bKash</option><option value="nagad">Nagad</option></select></Field><Field label="Payment type"><select value={type} onChange={(event) => setType(event.target.value)} className={inputClass}><option value="subscription">Subscription</option><option value="deposit">Deposit</option><option value="late_fee">Late fee</option><option value="lost_book">Lost book</option><option value="damage_fee">Damage fee</option><option value="other">Other</option></select></Field><Field label="Reference"><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="bKash transaction or cash receipt" className={inputClass} /></Field></div>{error && <ErrorBox message={error} />}<div className="flex justify-end gap-2"><ActionButton variant="outline" onClick={() => setOpen(false)}>Cancel</ActionButton><ActionButton disabled={record.isPending}>{record.isPending ? "Saving…" : "Save payment"}</ActionButton></div></form></Modal>}
    </>
  );
}