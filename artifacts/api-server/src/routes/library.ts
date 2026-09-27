import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  db,
  booksTable,
  borrowRequestsTable,
  membersTable,
  paymentsTable,
  transactionsTable,
  wishlistsTable,
  notificationsTable,
  auditLogsTable,
  subscriptionPlansTable,
  type Book,
} from "@workspace/db";
import { sendNotification } from "../services/notification-service";
import {
  CreateBookBody,
  CreateBorrowRequestBody,
  GetBookParams,
  ListBooksQueryParams,
  RecordPaymentBody,
  UpdateBookBody,
  UpdateBookParams,
  UpdateBorrowRequestStatusBody,
  UpdateBorrowRequestStatusParams,
} from "@workspace/api-zod";
import { getRequiredMember, requireAdmin, requireMember } from "../auth";

const router: IRouter = Router();
const DEMO_MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const BORROWING_DAYS = 7;
const LATE_FEE_PER_DAY = 9;
const MEMBERSHIP_FEE = 99;
let seedPromise: Promise<void> | undefined;

function money(value: string | number | null | undefined) {
  return Number(value ?? 0);
}

function calculateLateFee(
  dueDate: Date | string | null | undefined,
  returnDate: Date | string | null | undefined = new Date(),
) {
  const effectiveReturnDate = returnDate ?? new Date();
  if (!dueDate || effectiveReturnDate <= new Date(dueDate)) return 0;
  const lateDays = Math.ceil(
    (new Date(effectiveReturnDate).getTime() - new Date(dueDate).getTime()) / 86400000,
  );
  return Math.max(0, lateDays) * LATE_FEE_PER_DAY;
}

function addBorrowingDays(dateValue: Date) {
  const dueDate = new Date(dateValue);
  dueDate.setDate(dueDate.getDate() + BORROWING_DAYS);
  return dueDate;
}

function slotToTime(slot: string) {
  const firstPart = slot.split(/[–-]/)[0]?.trim() ?? "";
  const match = firstPart.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2];
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function mapMember(member: typeof membersTable.$inferSelect) {
  return {
    id: member.id,
    authUserId: member.authUserId,
    name: member.name,
    email: member.email,
    phone: member.phone,
    university: member.university,
    studentId: member.studentId,
    plan: member.plan,
    subscriptionPlan: money(member.subscriptionPlan),
    assignedPlanId: member.assignedPlanId,
    membershipStatus: member.membershipStatus,
    subscriptionStatus: member.subscriptionStatus,
    subscriptionStart: member.subscriptionStart,
    subscriptionEnd: member.subscriptionEnd,
    depositAmount: money(member.depositAmount),
    depositStatus: member.depositStatus,
    outstandingFees: money(member.outstandingFees),
    address: member.address,
    status: member.status,
    totalBooksRead: money(member.totalBooksRead),
    joinedAt: member.joinedAt.toISOString(),
  };
}

function mapPlan(plan: typeof subscriptionPlansTable.$inferSelect) {
  return {
    id: plan.id,
    name: plan.name,
    monthlyPrice: money(plan.monthlyPrice),
    durationMonths: plan.durationMonths,
    description: plan.description,
    active: plan.active,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

function mapBorrowRequest(
  request: typeof borrowRequestsTable.$inferSelect,
  bookTitle: string,
  memberName: string,
  member?: typeof membersTable.$inferSelect | null,
  transaction?: typeof transactionsTable.$inferSelect | null,
) {
  return {
    id: request.id,
    bookId: request.bookId,
    bookTitle,
    memberName,
    memberPhone: member?.phone ?? null,
    memberId: member?.id ?? null,
    address: member?.address ?? null,
    bookIsbn: null,
    university: member?.university ?? null,
    depositStatus: member?.depositStatus ?? null,
    subscriptionStatus:
      member?.subscriptionStatus ?? "unassigned",
    subscriptionPlan: money(member?.subscriptionPlan),
    approvedPickupDate: transaction?.approvedPickupDate ?? null,
    approvedPickupTime: transaction?.approvedPickupTime ?? null,
    pickupDate: request.pickupDate,
    pickupSlot: request.pickupSlot,
    status: request.status,
    note: request.note,
    dueDate: request.dueDate,
    deliveryDate: request.deliveryDate,
    deliverySlot: request.deliverySlot,
    deliveryStatus: request.deliveryStatus,
    deliveryNote: request.deliveryNote,
    lateFee: calculateLateFee(transaction?.dueDate ?? request.dueDate, transaction?.returnDate),
    createdAt: request.createdAt.toISOString(),
  };
}

async function recordAudit(action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) {
  await db.insert(auditLogsTable).values({
    action,
    entityType,
    entityId,
    metadata: metadata ? JSON.stringify(metadata) : null,
  });
}

function mapBook(book: Book) {
  return {
    ...book,
    price: money(book.price),
    depositAmount: money(book.depositAmount),
    createdAt: book.createdAt.toISOString(),
    updatedAt: book.updatedAt.toISOString(),
  };
}

async function ensureSeedData() {
  if (process.env.NODE_ENV === "production") return;
  if (!seedPromise) {
    seedPromise = (async () => {
      let existingPlans = await db.select().from(subscriptionPlansTable).orderBy(asc(subscriptionPlansTable.monthlyPrice));
      if (!existingPlans.length) {
        await db.insert(subscriptionPlansTable).values([
          { name: "Reader", monthlyPrice: "29", durationMonths: 1, description: "A flexible monthly reading plan." },
          { name: "Plus", monthlyPrice: "49", durationMonths: 1, description: "More time to keep your next book." },
          { name: "Annual", monthlyPrice: "99", durationMonths: 3, description: "A longer plan for regular readers." },
        ]);
        existingPlans = await db.select().from(subscriptionPlansTable).orderBy(asc(subscriptionPlansTable.monthlyPrice));
      }
      const existing = await db
        .select({ id: membersTable.id })
        .from(membersTable)
        .where(eq(membersTable.id, DEMO_MEMBER_ID))
        .limit(1);
      if (existing.length) {
        await db
          .update(membersTable)
          .set({
            university: "BRAC",
            subscriptionPlan: "29",
            subscriptionStart: "2026-09-01",
            subscriptionEnd: "2026-09-30",
            depositAmount: "300",
            depositStatus: "paid",
            status: "active",
            membershipStatus: "approved",
            subscriptionStatus: "active",
            assignedPlanId: existingPlans[0]?.id,
            updatedAt: new Date(),
          })
          .where(eq(membersTable.id, DEMO_MEMBER_ID));
        const [existingActiveTransaction] = await db
          .select({ id: transactionsTable.id })
          .from(transactionsTable)
          .where(
            and(
              eq(transactionsTable.memberId, DEMO_MEMBER_ID),
              or(
                eq(transactionsTable.status, "approved"),
                eq(transactionsTable.status, "borrowed"),
                eq(transactionsTable.status, "overdue"),
              ),
            ),
          )
          .limit(1);
      const [activeRequest] = existingActiveTransaction
          ? [undefined]
          : await db
              .select({ request: borrowRequestsTable, book: booksTable })
              .from(borrowRequestsTable)
              .innerJoin(booksTable, eq(borrowRequestsTable.bookId, booksTable.id))
              .where(
                and(
                  eq(borrowRequestsTable.memberId, DEMO_MEMBER_ID),
                  or(
                    eq(borrowRequestsTable.status, "approved"),
                    eq(borrowRequestsTable.status, "collected"),
                  ),
                ),
              )
              .limit(1);
        if (activeRequest && !activeRequest.request.transactionId) {
          const borrowDate = new Date("2026-09-21T17:00:00+06:00");
          const [transaction] = await db
            .insert(transactionsTable)
            .values({
              memberId: DEMO_MEMBER_ID,
              bookId: activeRequest.book.id,
              requestedPickupDate: activeRequest.request.pickupDate,
              requestedPickupTime: slotToTime(activeRequest.request.pickupSlot),
              borrowDate,
              dueDate: addBorrowingDays(borrowDate),
              status: "borrowed",
            })
            .returning();
          await db
            .update(borrowRequestsTable)
            .set({ transactionId: transaction.id, updatedAt: new Date() })
            .where(eq(borrowRequestsTable.id, activeRequest.request.id));
        }
        return;
      }

      await db.insert(membersTable).values({
        id: DEMO_MEMBER_ID,
        name: "Nusrat Jahan",
        email: "nusrat@undergraduatehub.bd",
        phone: "+880 1712-345678",
        university: "BRAC",
        studentId: "BRACU-2026-0142",
        subscriptionPlan: "29",
        subscriptionStart: "2026-09-01",
        subscriptionEnd: "2026-09-30",
        plan: "Semester Pass",
        depositStatus: "paid",
        status: "active",
        membershipStatus: "approved",
        subscriptionStatus: "active",
        assignedPlanId: existingPlans[0]?.id,
        outstandingFees: "80",
        depositAmount: "300",
      });

      const seededBooks = await db
        .insert(booksTable)
        .values([
          {
            title: "পথের পাঁচালী",
            author: "বিভূতিভূষণ বন্দ্যোপাধ্যায়",
            category: "Novel",
            language: "Bangla",
            qrCode: "UH-BOOK-001",
            price: "420",
            conditionNote: "Good condition",
          },
          {
            title: "Atomic Habits",
            author: "James Clear",
            category: "Self-Help",
            language: "English",
            qrCode: "UH-BOOK-002",
            price: "650",
            conditionNote: "Like new",
          },
          {
            title: "Sapiens",
            author: "Yuval Noah Harari",
            category: "History",
            language: "English",
            qrCode: "UH-BOOK-003",
            price: "780",
            status: "rented",
            conditionNote: "Good condition",
          },
          {
            title: "The Alchemist",
            author: "Paulo Coelho",
            category: "Novel",
            language: "English",
            qrCode: "UH-BOOK-004",
            price: "500",
            conditionNote: "Good condition",
          },
          {
            title: "জীবন ও রাজনীতি",
            author: "আনিসুজ্জামান",
            category: "Philosophy",
            language: "Bangla",
            qrCode: "UH-BOOK-005",
            price: "350",
            conditionNote: "Marked pages",
          },
          {
            title: "Dune",
            author: "Frank Herbert",
            category: "Sci-Fi",
            language: "English",
            qrCode: "UH-BOOK-006",
            price: "720",
            conditionNote: "Like new",
          },
        ])
        .returning();

      const activeBook = seededBooks.find((book) => book.status === "rented");
      const upcomingBook = seededBooks.find((book) => book.status === "available");
      if (activeBook && upcomingBook) {
        const seededRequests = await db.insert(borrowRequestsTable).values([
          {
            bookId: activeBook.id,
            memberId: DEMO_MEMBER_ID,
            pickupDate: "2026-09-10",
            pickupSlot: "5:00 PM – 6:00 PM",
            status: "collected",
            dueDate: "2026-09-28",
          },
          {
            bookId: upcomingBook.id,
            memberId: DEMO_MEMBER_ID,
            pickupDate: "2026-09-24",
            pickupSlot: "3:00 PM – 4:00 PM",
            status: "pending",
            note: "Please keep it aside under my name.",
          },
        ]).returning();
        await db.insert(transactionsTable).values({
          memberId: DEMO_MEMBER_ID,
          bookId: activeBook.id,
          requestedPickupDate: "2026-09-10",
          requestedPickupTime: "17:00",
          approvedPickupDate: "2026-09-10",
          approvedPickupTime: "17:00",
          borrowDate: new Date("2026-09-21T17:00:00+06:00"),
          dueDate: new Date("2026-09-28T17:00:00+06:00"),
          status: "borrowed",
          staffNote: seededRequests[0]?.id ? "Seeded active loan" : null,
        });
      }

      await db.insert(paymentsTable).values({
        memberId: DEMO_MEMBER_ID,
        amount: "1200",
        method: "bkash",
        type: "subscription",
        referenceNumber: "BKX-2026-0912",
        status: "paid",
      });
    })().catch((error) => {
      seedPromise = undefined;
      throw error;
    });
  }
  return seedPromise;
}

router.get("/dashboard", requireMember(), async (req, res) => {
  await ensureSeedData();
  const memberId = getRequiredMember(req).memberId;
  const [member] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.id, memberId))
    .limit(1);
  const active = await db
    .select({ request: borrowRequestsTable, book: booksTable })
    .from(borrowRequestsTable)
    .innerJoin(booksTable, eq(borrowRequestsTable.bookId, booksTable.id))
    .where(
      and(
        eq(borrowRequestsTable.memberId, memberId),
        or(
          eq(borrowRequestsTable.status, "collected"),
          eq(borrowRequestsTable.status, "approved"),
        ),
      ),
    )
    .orderBy(desc(borrowRequestsTable.createdAt))
    .limit(1);
  const pending = await db
    .select({ count: count() })
    .from(borrowRequestsTable)
    .where(
      and(
        eq(borrowRequestsTable.memberId, memberId),
        eq(borrowRequestsTable.status, "pending"),
      ),
    );
  const [activeTransaction] = await db
    .select()
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.memberId, memberId),
        or(
          eq(transactionsTable.status, "approved"),
          eq(transactionsTable.status, "borrowed"),
          eq(transactionsTable.status, "overdue"),
        ),
      ),
    )
    .orderBy(desc(transactionsTable.createdAt))
    .limit(1);
  const memberNotifications = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.memberId, memberId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(3);
  const activeItem = active[0];
  const dueDate = activeItem?.request.dueDate ?? "2026-09-28";
  const dueInDays = Math.max(
    0,
    Math.ceil((new Date(`${dueDate}T23:59:59`).getTime() - Date.now()) / 86400000),
  );
  res.json({
    memberName: member?.name ?? "Nusrat Jahan",
    activeBook: activeItem
      ? {
          title: activeItem.book.title,
          author: activeItem.book.author,
          dueDate,
          daysLeft: dueInDays,
          coverUrl: activeItem.book.coverUrl,
        }
      : null,
    dueInDays,
    pendingRequests: Number(pending[0]?.count ?? 0),
    wishlistCount: 4,
    outstandingFees:
      money(member?.outstandingFees) +
      calculateLateFee(activeTransaction?.dueDate, activeTransaction?.returnDate),
    notifications: memberNotifications.length
      ? memberNotifications.map((notification) => notification.message)
      : [
          "আপনার পরবর্তী pickup slot বৃহস্পতিবার, 3:00 PM – 4:00 PM।",
          "লাইব্রেরি শুক্রবার দুপুর ২টা পর্যন্ত খোলা থাকবে।",
        ],
  });
});

router.get("/member/status", requireMember(), async (req, res) => {
  await ensureSeedData();
  const memberId = getRequiredMember(req).memberId;
  const [member] = await db.select().from(membersTable).where(eq(membersTable.id, memberId)).limit(1);
  if (!member) {
    res.status(404).json({ error: "Member not found." });
    return;
  }
  const [plan] = member.assignedPlanId
    ? await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, member.assignedPlanId)).limit(1)
    : [undefined];
  const payments = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.memberId, memberId))
    .orderBy(desc(paymentsTable.submittedAt));
  const membershipPayment = payments.find((payment) => payment.type === "membership") ?? null;
  const subscriptionPayment = payments.find((payment) => payment.type === "subscription") ?? null;
  const activeBorrow = await db
    .select({ id: transactionsTable.id })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.memberId, memberId), or(
      eq(transactionsTable.status, "approved"),
      eq(transactionsTable.status, "borrowed"),
      eq(transactionsTable.status, "overdue"),
    )))
    .limit(1);
  res.json({
    member: mapMember(member),
    membershipFee: MEMBERSHIP_FEE,
    membershipPayment: membershipPayment ? {
      id: membershipPayment.id,
      amount: money(membershipPayment.amount),
      method: membershipPayment.method,
      txid: membershipPayment.txid ?? membershipPayment.referenceNumber,
      status: membershipPayment.status,
      submittedAt: membershipPayment.submittedAt.toISOString(),
      reviewReason: membershipPayment.reviewReason,
    } : null,
    plan: plan ? mapPlan(plan) : null,
    subscriptionPayment: subscriptionPayment ? {
      id: subscriptionPayment.id,
      amount: money(subscriptionPayment.amount),
      method: subscriptionPayment.method,
      txid: subscriptionPayment.txid ?? subscriptionPayment.referenceNumber,
      status: subscriptionPayment.status,
      submittedAt: subscriptionPayment.submittedAt.toISOString(),
      reviewReason: subscriptionPayment.reviewReason,
    } : null,
    canBorrow:
      member.membershipStatus === "approved" &&
      member.subscriptionStatus === "active" &&
      !activeBorrow.length,
  });
});

router.patch("/member/profile", requireMember(), async (req, res) => {
  const memberId = getRequiredMember(req).memberId;
  const address = typeof req.body?.address === "string" ? req.body.address.trim() : "";
  if (address.length > 500) {
    res.status(400).json({ error: "Delivery address must be 500 characters or fewer." });
    return;
  }
  const [member] = await db
    .update(membersTable)
    .set({ address: address || null, updatedAt: new Date() })
    .where(eq(membersTable.id, memberId))
    .returning();
  if (!member) {
    res.status(404).json({ error: "Member not found." });
    return;
  }
  res.json(mapMember(member));
});

router.post("/member/payments", requireMember(), async (req, res) => {
  await ensureSeedData();
  const memberId = getRequiredMember(req).memberId;
  const kind = req.body?.kind === "subscription" ? "subscription" : "membership";
  const method = req.body?.method;
  const txid = typeof req.body?.txid === "string" ? req.body.txid.trim() : "";
  const amount = Number(req.body?.amount);
  const screenshotUrl = typeof req.body?.screenshotUrl === "string" ? req.body.screenshotUrl : null;
  const paymentDate = typeof req.body?.paymentDate === "string" ? new Date(req.body.paymentDate) : new Date();
  if (!["bkash", "nagad"].includes(method) || !txid || txid.length < 4 || !Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "Choose bKash or Nagad and enter a valid TXID and amount." });
    return;
  }
  if (screenshotUrl && screenshotUrl.length > 500) {
    res.status(400).json({ error: "Payment screenshot URL is too long." });
    return;
  }
  const [member] = await db.select().from(membersTable).where(eq(membersTable.id, memberId)).limit(1);
  if (!member) {
    res.status(404).json({ error: "Member not found." });
    return;
  }
  const [duplicate] = await db.select({ id: paymentsTable.id }).from(paymentsTable).where(eq(paymentsTable.txid, txid)).limit(1);
  if (duplicate) {
    res.status(409).json({ error: "This TXID has already been submitted." });
    return;
  }
  let expectedAmount = MEMBERSHIP_FEE;
  if (kind === "subscription") {
    if (member.membershipStatus !== "approved") {
      res.status(403).json({ error: "Membership payment must be approved before choosing a subscription." });
      return;
    }
    if (!member.assignedPlanId) {
      res.status(400).json({ error: "An administrator has not assigned a subscription plan yet." });
      return;
    }
    const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, member.assignedPlanId)).limit(1);
    if (!plan || !plan.active) {
      res.status(400).json({ error: "The assigned subscription plan is not active." });
      return;
    }
    expectedAmount = money(plan.monthlyPrice);
  } else if (member.membershipStatus === "approved") {
    res.status(400).json({ error: "Your membership is already approved." });
    return;
  }
  if (amount !== expectedAmount) {
    res.status(400).json({ error: `The required payment amount is ৳${expectedAmount}.` });
    return;
  }
  const [payment] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(paymentsTable).values({
      memberId,
      amount: String(amount),
      method,
      type: kind,
      status: "pending_admin_verification",
      referenceNumber: txid,
      txid,
      screenshotUrl,
      paidAt: Number.isNaN(paymentDate.getTime()) ? new Date() : paymentDate,
    }).returning();
    await tx.update(membersTable).set({
      membershipStatus: kind === "membership" ? "pending_verification" : undefined,
      subscriptionStatus: kind === "subscription" ? "pending_verification" : undefined,
      updatedAt: new Date(),
    }).where(eq(membersTable.id, memberId));
    await tx.insert(auditLogsTable).values({
      action: "payment_submitted",
      entityType: "payment",
      entityId: created.id,
      metadata: JSON.stringify({ memberId, kind, amount, method, txid }),
    });
    return [created];
  });
  await sendNotification({
    memberId,
    title: kind === "membership" ? "Membership payment submitted" : "Subscription payment submitted",
    message: "Your payment has been submitted and is waiting for admin verification.",
    type: "payment_pending",
  });
  res.status(201).json({ id: payment.id, status: payment.status, message: "Your payment has been submitted and is waiting for admin verification." });
});

router.get("/admin/subscription-plans", requireAdmin("members.view"), async (_req, res) => {
  await ensureSeedData();
  const plans = await db.select().from(subscriptionPlansTable).orderBy(asc(subscriptionPlansTable.monthlyPrice));
  res.json(plans.map(mapPlan));
});

router.post("/admin/subscription-plans", requireAdmin("members.update"), async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const monthlyPrice = Number(req.body?.monthlyPrice);
  const durationMonths = Number(req.body?.durationMonths ?? 1);
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  if (!name || !Number.isFinite(monthlyPrice) || monthlyPrice <= 0 || !Number.isInteger(durationMonths) || durationMonths < 1) {
    res.status(400).json({ error: "Enter a plan name, a positive monthly price, and a valid duration." });
    return;
  }
  const [plan] = await db.insert(subscriptionPlansTable).values({
    name,
    monthlyPrice: String(monthlyPrice),
    durationMonths,
    description,
  }).returning();
  await recordAudit("subscription_plan_created", "subscription_plan", plan.id, { name, monthlyPrice, durationMonths });
  res.status(201).json(mapPlan(plan));
});

router.patch("/admin/subscription-plans/:id", requireAdmin("members.update"), async (req, res) => {
  if (typeof req.body?.active !== "boolean") {
    res.status(400).json({ error: "Plan active status is required." });
    return;
  }
  const [plan] = await db
    .update(subscriptionPlansTable)
    .set({ active: req.body.active, updatedAt: new Date() })
    .where(eq(subscriptionPlansTable.id, String(req.params.id)))
    .returning();
  if (!plan) {
    res.status(404).json({ error: "Subscription plan not found." });
    return;
  }
  await recordAudit("subscription_plan_status_changed", "subscription_plan", plan.id, { active: plan.active });
  res.json(mapPlan(plan));
});

router.patch("/admin/members/:id/subscription", requireAdmin("members.update"), async (req, res) => {
  const memberId = String(req.params.id);
  const planId = typeof req.body?.planId === "string" ? req.body.planId : "";
  const [memberBeforeAssignment] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.id, memberId))
    .limit(1);
  if (!memberBeforeAssignment) {
    res.status(404).json({ error: "Member not found." });
    return;
  }
  if (memberBeforeAssignment.membershipStatus !== "approved") {
    res.status(409).json({ error: "Approve the member's 99 BDT membership payment before assigning a subscription." });
    return;
  }
  const [plan] = await db.select().from(subscriptionPlansTable).where(and(eq(subscriptionPlansTable.id, planId), eq(subscriptionPlansTable.active, true))).limit(1);
  if (!plan) {
    res.status(404).json({ error: "Active subscription plan not found." });
    return;
  }
  const [member] = await db.update(membersTable).set({
    assignedPlanId: plan.id,
    subscriptionPlan: String(plan.monthlyPrice),
    plan: plan.name,
    subscriptionStatus: "assigned",
    updatedAt: new Date(),
  }).where(eq(membersTable.id, memberId)).returning();
  if (!member) {
    res.status(404).json({ error: "Member not found." });
    return;
  }
  await recordAudit("subscription_assigned", "member", member.id, { planId: plan.id, planName: plan.name });
  await sendNotification({
    memberId: member.id,
    title: "Subscription plan assigned",
    message: `Your subscription is ${plan.name} at ৳${money(plan.monthlyPrice)}. Submit the payment to continue.`,
    type: "subscription_assigned",
  });
  res.json(mapMember(member));
});

router.get("/admin/payment-requests", requireAdmin("payments.view"), async (_req, res) => {
  const rows = await db.select({ payment: paymentsTable, member: membersTable })
    .from(paymentsTable)
    .innerJoin(membersTable, eq(paymentsTable.memberId, membersTable.id))
    .where(or(eq(paymentsTable.status, "pending_admin_verification"), eq(paymentsTable.status, "rejected")))
    .orderBy(desc(paymentsTable.submittedAt));
  res.json(rows.map(({ payment, member }) => ({
    id: payment.id,
    memberId: member.id,
    memberName: member.name,
    memberPhone: member.phone,
    memberIdLabel: member.id.slice(0, 8).toUpperCase(),
    address: member.address,
    type: payment.type,
    amount: money(payment.amount),
    method: payment.method,
    txid: payment.txid ?? payment.referenceNumber,
    screenshotUrl: payment.screenshotUrl,
    status: payment.status,
    submittedAt: payment.submittedAt.toISOString(),
    reviewReason: payment.reviewReason,
  })));
});

router.patch("/admin/payment-requests/:id", requireAdmin("payments.update"), async (req, res) => {
  const paymentId = String(req.params.id);
  const nextStatus = req.body?.status === "approved" ? "approved" : req.body?.status === "rejected" ? "rejected" : "";
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!nextStatus || (nextStatus === "rejected" && !reason)) {
    res.status(400).json({ error: "Choose approve or decline and provide a reason when declining." });
    return;
  }
  const [current] = await db.select({ payment: paymentsTable, member: membersTable })
    .from(paymentsTable)
    .innerJoin(membersTable, eq(paymentsTable.memberId, membersTable.id))
    .where(eq(paymentsTable.id, paymentId)).limit(1);
  if (!current) {
    res.status(404).json({ error: "Payment request not found." });
    return;
  }
  if (current.payment.status !== "pending_admin_verification") {
    res.status(409).json({ error: "This payment request has already been reviewed." });
    return;
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(paymentsTable).set({
      status: nextStatus,
      reviewedAt: now,
      reviewReason: nextStatus === "rejected" ? reason : null,
    }).where(eq(paymentsTable.id, paymentId));
    if (current.payment.type === "membership") {
      await tx.update(membersTable).set({
        membershipStatus: nextStatus === "approved" ? "approved" : "rejected",
        updatedAt: now,
      }).where(eq(membersTable.id, current.member.id));
    } else if (current.payment.type === "subscription") {
      let endDate: string | undefined;
      if (nextStatus === "approved") {
        const [plan] = current.member.assignedPlanId
          ? await tx.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, current.member.assignedPlanId)).limit(1)
          : [undefined];
        const start = new Date();
        const duration = plan?.durationMonths ?? 1;
        endDate = new Date(start.getTime() + duration * 30 * 86400000).toISOString().slice(0, 10);
      }
      await tx.update(membersTable).set({
        subscriptionStatus: nextStatus === "approved" ? "active" : "rejected",
        subscriptionStart: nextStatus === "approved" ? now.toISOString().slice(0, 10) : undefined,
        subscriptionEnd: endDate,
        updatedAt: now,
      }).where(eq(membersTable.id, current.member.id));
    }
    await tx.insert(auditLogsTable).values({
      action: `payment_${nextStatus}`,
      entityType: "payment",
      entityId: paymentId,
      metadata: JSON.stringify({ memberId: current.member.id, type: current.payment.type, reason: reason || null }),
    });
  });
  await sendNotification({
    memberId: current.member.id,
    title: nextStatus === "approved" ? "Payment approved" : "Payment declined",
    message: nextStatus === "approved"
      ? `Your ${current.payment.type} payment has been approved.`
      : `Your ${current.payment.type} payment was declined. Reason: ${reason}`,
    type: `payment_${nextStatus}`,
  });
  res.json({ status: nextStatus });
});

router.patch("/requests/:id/delivery", requireAdmin("circulation.approve"), async (req, res) => {
  const deliveryDate = typeof req.body?.deliveryDate === "string" ? req.body.deliveryDate : "";
  const deliverySlot = typeof req.body?.deliverySlot === "string" ? req.body.deliverySlot.trim() : "";
  const deliveryStatus = typeof req.body?.deliveryStatus === "string" ? req.body.deliveryStatus : "scheduled";
  const deliveryNote = typeof req.body?.note === "string" ? req.body.note.trim() : null;
  if (!deliveryDate || !deliverySlot || !["scheduled", "out_for_delivery", "delivered"].includes(deliveryStatus)) {
    res.status(400).json({ error: "Delivery date, time slot, and a valid status are required." });
    return;
  }
  const [current] = await db.select({ request: borrowRequestsTable, member: membersTable, book: booksTable })
    .from(borrowRequestsTable)
    .innerJoin(membersTable, eq(borrowRequestsTable.memberId, membersTable.id))
    .innerJoin(booksTable, eq(borrowRequestsTable.bookId, booksTable.id))
    .where(eq(borrowRequestsTable.id, String(req.params.id))).limit(1);
  if (!current) {
    res.status(404).json({ error: "Borrowing request not found." });
    return;
  }
  if (!["approved", "rescheduled", "collected"].includes(current.request.status)) {
    res.status(409).json({ error: "Approve the borrowing request before scheduling delivery." });
    return;
  }
  await db.update(borrowRequestsTable).set({
    deliveryDate,
    deliverySlot,
    deliveryStatus,
    deliveryNote,
    updatedAt: new Date(),
  }).where(eq(borrowRequestsTable.id, current.request.id));
  await recordAudit("delivery_scheduled", "borrow_request", current.request.id, { deliveryDate, deliverySlot, deliveryStatus });
  await sendNotification({
    memberId: current.member.id,
    title: deliveryStatus === "delivered" ? "Book delivered" : "Delivery scheduled",
    message: deliveryStatus === "delivered"
      ? `Your book ${current.book.title} was marked as delivered.`
      : `Delivery scheduled for ${deliveryDate}, ${deliverySlot}.`,
    type: "delivery",
  });
  res.json({ deliveryDate, deliverySlot, deliveryStatus, deliveryNote });
});

router.get("/books", async (req, res) => {
  await ensureSeedData();
  const params = ListBooksQueryParams.parse(req.query);
  const filters = [];
  if (params.search) {
    filters.push(
      or(
        ilike(booksTable.title, `%${params.search}%`),
        ilike(booksTable.author, `%${params.search}%`),
        ilike(booksTable.isbn, `%${params.search}%`),
      ),
    );
  }
  if (params.category) filters.push(eq(booksTable.category, params.category));
  if (params.language) filters.push(eq(booksTable.language, params.language));
  if (params.status) filters.push(eq(booksTable.status, params.status as "available" | "rented" | "lost"));
  const orderBy =
    params.sort === "recent"
      ? [desc(booksTable.createdAt)]
      : params.sort === "popular"
        ? [
            desc(
              sql<number>`(
                select count(*)
                from ${transactionsTable}
                where ${transactionsTable.bookId} = ${booksTable.id}
              )`,
            ),
            asc(booksTable.title),
          ]
        : [asc(booksTable.title)];
  const books = await db
    .select()
    .from(booksTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(...orderBy)
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize);
  res.json(books.map(mapBook));
});

router.post("/books", requireAdmin("books.create"), async (req, res) => {
  const body = CreateBookBody.parse(req.body);
  const [book] = await db
    .insert(booksTable)
    .values({
      ...body,
      qrCode: `UH-${Date.now()}`,
      price: String(body.price ?? 0),
      depositAmount: String(body.depositAmount ?? 300),
    })
    .returning();
  res.status(201).json(mapBook(book));
});

router.get("/books/:id", async (req, res) => {
  await ensureSeedData();
  const { id } = GetBookParams.parse(req.params);
  const [book] = await db.select().from(booksTable).where(eq(booksTable.id, id)).limit(1);
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  res.json(mapBook(book));
});

router.patch("/books/:id", requireAdmin("books.update"), async (req, res) => {
  const { id } = UpdateBookParams.parse(req.params);
  const body = UpdateBookBody.parse(req.body);
  const [book] = await db
    .update(booksTable)
    .set({
      title: body.title,
      author: body.author,
      category: body.category,
      language: body.language,
      status: body.status as "available" | "rented" | "lost" | undefined,
      conditionNote: body.conditionNote,
      depositRequired: body.depositRequired,
      price: body.price === undefined ? undefined : String(body.price),
      depositAmount:
        body.depositAmount === undefined ? undefined : String(body.depositAmount),
      updatedAt: new Date(),
    })
    .where(eq(booksTable.id, id))
    .returning();
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  res.json(mapBook(book));
});

router.get("/requests", requireMember(), async (req, res) => {
  await ensureSeedData();
  const memberId = getRequiredMember(req).memberId;
  const requests = await db
    .select({
      request: borrowRequestsTable,
      book: booksTable,
      member: membersTable,
      transaction: transactionsTable,
    })
    .from(borrowRequestsTable)
    .innerJoin(booksTable, eq(borrowRequestsTable.bookId, booksTable.id))
    .innerJoin(membersTable, eq(borrowRequestsTable.memberId, membersTable.id))
    .leftJoin(transactionsTable, eq(borrowRequestsTable.transactionId, transactionsTable.id))
      .where(eq(borrowRequestsTable.memberId, memberId))
    .orderBy(desc(borrowRequestsTable.createdAt));
  res.json(
    requests.map(({ request, book, member, transaction }) =>
      mapBorrowRequest(request, book.title, member.name, member, transaction),
    ),
  );
});

router.get("/admin/requests", requireAdmin("circulation.view"), async (_req, res) => {
  await ensureSeedData();
  const requests = await db
    .select({
      request: borrowRequestsTable,
      book: booksTable,
      member: membersTable,
      transaction: transactionsTable,
    })
    .from(borrowRequestsTable)
    .innerJoin(booksTable, eq(borrowRequestsTable.bookId, booksTable.id))
    .innerJoin(membersTable, eq(borrowRequestsTable.memberId, membersTable.id))
    .leftJoin(transactionsTable, eq(borrowRequestsTable.transactionId, transactionsTable.id))
    .orderBy(desc(borrowRequestsTable.createdAt));
  res.json(
    requests.map(({ request, book, member, transaction }) =>
      mapBorrowRequest(request, book.title, member.name, member, transaction),
    ),
  );
});

router.get("/my-books", requireMember(), async (req, res) => {
  await ensureSeedData();
  const memberId = getRequiredMember(req).memberId;
  const rows = await db
    .select({ transaction: transactionsTable, book: booksTable })
    .from(transactionsTable)
    .innerJoin(booksTable, eq(transactionsTable.bookId, booksTable.id))
    .where(
      and(
        eq(transactionsTable.memberId, memberId),
        or(
          eq(transactionsTable.status, "approved"),
          eq(transactionsTable.status, "borrowed"),
          eq(transactionsTable.status, "overdue"),
        ),
      ),
    )
    .orderBy(desc(transactionsTable.createdAt));
  res.json(
    rows.map(({ transaction, book }) => {
      const dueDate = transaction.dueDate;
      const lateFee = calculateLateFee(dueDate, transaction.returnDate);
      const daysRemaining = dueDate
        ? Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86400000)
        : 0;
      return {
        transactionId: transaction.id,
        bookId: book.id,
        title: book.title,
        author: book.author,
        coverUrl: book.coverUrl,
        borrowDate: transaction.borrowDate?.toISOString() ?? null,
        dueDate: dueDate?.toISOString() ?? null,
        returnDate: transaction.returnDate?.toISOString() ?? null,
        status: transaction.status,
        lateFee,
        daysRemaining,
      };
    }),
  );
});

router.get("/wishlist", requireMember(), async (req, res) => {
  await ensureSeedData();
  const memberId = getRequiredMember(req).memberId;
  const rows = await db
    .select({ book: booksTable })
    .from(wishlistsTable)
    .innerJoin(booksTable, eq(wishlistsTable.bookId, booksTable.id))
    .where(eq(wishlistsTable.memberId, memberId))
    .orderBy(desc(wishlistsTable.createdAt));
  res.json(rows.map(({ book }) => mapBook(book)));
});

router.post("/wishlist", requireMember(), async (req, res) => {
  await ensureSeedData();
  const memberId = getRequiredMember(req).memberId;
  const bookId = String(req.body?.bookId ?? "");
  const [book] = await db.select().from(booksTable).where(eq(booksTable.id, bookId)).limit(1);
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const existing = await db
    .select({ id: wishlistsTable.id })
    .from(wishlistsTable)
    .where(and(eq(wishlistsTable.memberId, memberId), eq(wishlistsTable.bookId, bookId)))
    .limit(1);
  if (!existing.length) {
    await db.insert(wishlistsTable).values({ memberId, bookId });
  }
  res.status(201).json(mapBook(book));
});

router.delete("/wishlist/:bookId", requireMember(), async (req, res) => {
  const memberId = getRequiredMember(req).memberId;
  await db
    .delete(wishlistsTable)
    .where(
      and(
        eq(wishlistsTable.memberId, memberId),
        eq(wishlistsTable.bookId, String(req.params.bookId)),
      ),
    );
  res.status(204).send();
});

router.get("/notifications", requireMember(), async (req, res) => {
  await ensureSeedData();
  const memberId = getRequiredMember(req).memberId;
  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.memberId, memberId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(30);
  res.json(
    notifications.map((notification) => ({
      id: notification.id,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      isRead: notification.isRead,
      createdAt: notification.createdAt.toISOString(),
    })),
  );
});

router.patch("/notifications/:id/read", requireMember(), async (req, res) => {
  const memberId = getRequiredMember(req).memberId;
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(
      and(
        eq(notificationsTable.id, String(req.params.id)),
        eq(notificationsTable.memberId, memberId),
      ),
    );
  res.status(204).send();
});

router.post("/requests", requireMember(), async (req, res) => {
  await ensureSeedData();
  const memberId = getRequiredMember(req).memberId;
  const body = CreateBorrowRequestBody.parse(req.body);
  const [member] = await db
    .select()
    .from(membersTable)
      .where(eq(membersTable.id, memberId))
    .limit(1);
  const today = new Date().toISOString().slice(0, 10);
  if (
    !member ||
    member.status === "suspended" ||
    member.membershipStatus !== "approved" ||
    member.subscriptionStatus !== "active" ||
    !member.subscriptionEnd ||
    member.subscriptionEnd < today
  ) {
    res.status(400).json({
      error: "Membership and an approved active subscription payment are required before borrowing.",
      code: "BORROWING_APPROVAL_REQUIRED",
    });
    return;
  }

  const [book] = await db
    .select()
    .from(booksTable)
    .where(eq(booksTable.id, body.bookId))
    .limit(1);
  if (!book) {
    res.status(404).json({ error: "Book not found", code: "BOOK_NOT_FOUND" });
    return;
  }
  if (book.status !== "available") {
    res.status(409).json({
      error: "এই বইটি এখন available নয়। অন্য একটি বই বেছে নিন।",
      code: "BOOK_NOT_AVAILABLE",
    });
    return;
  }
  if (
    book.depositRequired &&
    member.depositStatus !== "paid" &&
    member.depositStatus !== "waived"
  ) {
    res.status(400).json({
      error: `এই বইটির জন্য ৳${money(book.depositAmount)} deposit প্রয়োজন। আগে deposit পরিশোধ করুন।`,
      code: "DEPOSIT_REQUIRED",
    });
    return;
  }

  const activeBorrow = await db
    .select({ id: transactionsTable.id })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.memberId, memberId),
        or(
          eq(transactionsTable.status, "approved"),
          eq(transactionsTable.status, "borrowed"),
          eq(transactionsTable.status, "overdue"),
        ),
      ),
    )
    .limit(1);
  if (activeBorrow.length) {
    res.status(409).json({
      error: "আপনার কাছে ইতোমধ্যে একটি বই আছে। বইটি ফেরত দেওয়ার পর নতুন বই নিতে পারবেন।",
      code: "ACTIVE_BORROW_EXISTS",
    });
    return;
  }

  const [transaction] = await db
    .insert(transactionsTable)
    .values({
      memberId,
      bookId: body.bookId,
      requestedPickupDate: body.pickupDate,
      requestedPickupTime: slotToTime(body.pickupSlot),
      status: "requested",
    })
    .returning();
  const [request] = await db
    .insert(borrowRequestsTable)
      .values({ ...body, memberId, transactionId: transaction.id })
    .returning();
  await recordAudit("request_submitted", "borrow_request", request.id, {
    bookId: book.id,
    memberId,
    pickupDate: body.pickupDate,
    pickupSlot: body.pickupSlot,
  });
  await sendNotification({
    memberId,
    title: "বই নেওয়ার অনুরোধ পাঠানো হয়েছে",
    message: `আপনার ${book.title} বই নেওয়ার অনুরোধটি Pending Admin Approval অবস্থায় আছে।`,
    type: "request_pending",
  });
  res
    .status(201)
    .json(mapBorrowRequest(request, book?.title ?? "Book", member.name, member, transaction));
});

router.patch("/requests/:id/status", requireAdmin("circulation.approve"), async (req, res) => {
  const { id } = UpdateBorrowRequestStatusParams.parse(req.params);
  const body = UpdateBorrowRequestStatusBody.parse(req.body);
  if (body.status === "rejected" && !body.note?.trim()) {
    res.status(400).json({ error: "Rejection reason is required." });
    return;
  }

  const [current] = await db
    .select({
      request: borrowRequestsTable,
      book: booksTable,
      member: membersTable,
      transaction: transactionsTable,
    })
    .from(borrowRequestsTable)
    .innerJoin(booksTable, eq(borrowRequestsTable.bookId, booksTable.id))
    .innerJoin(membersTable, eq(borrowRequestsTable.memberId, membersTable.id))
    .leftJoin(transactionsTable, eq(borrowRequestsTable.transactionId, transactionsTable.id))
    .where(eq(borrowRequestsTable.id, id))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  const { request: existingRequest, book, member, transaction } = current;
  const today = new Date().toISOString().slice(0, 10);
  const nextStatus = body.status as
    | "pending"
    | "approved"
    | "rejected"
    | "rescheduled"
    | "collected"
    | "returned";

  if (nextStatus === "approved" || nextStatus === "rescheduled") {
    if (existingRequest.status !== "pending" && existingRequest.status !== "rescheduled") {
      res.status(409).json({ error: "Only pending requests can be approved or rescheduled." });
      return;
    }
    if (book.status !== "available") {
      res.status(409).json({ error: "This book is no longer available." });
      return;
    }
    if (
      member.status !== "active" ||
      member.membershipStatus !== "approved" ||
      member.subscriptionStatus !== "active" ||
      !member.subscriptionEnd ||
      member.subscriptionEnd < today
    ) {
      res.status(400).json({ error: "The member must have an active subscription." });
      return;
    }
  }
  if (nextStatus === "collected") {
    if (existingRequest.status !== "approved" && existingRequest.status !== "rescheduled") {
      res.status(409).json({ error: "Only approved requests can be issued." });
      return;
    }
    if (book.status !== "available") {
      res.status(409).json({ error: "This book is no longer available." });
      return;
    }
  }
  if (nextStatus === "returned") {
    if (existingRequest.status !== "collected") {
      res.status(409).json({ error: "Only an issued book can be returned." });
      return;
    }
  }

  const now = new Date();
  const pickupDate = body.pickupDate ?? existingRequest.pickupDate;
  const pickupSlot = body.pickupSlot ?? existingRequest.pickupSlot;
  const dueDate = nextStatus === "collected" ? addBorrowingDays(now) : null;
  const lateFee =
    nextStatus === "returned"
      ? calculateLateFee(
          transaction?.dueDate ??
            (existingRequest.dueDate ? new Date(`${existingRequest.dueDate}T23:59:59Z`) : null),
          now,
        )
      : undefined;

  await db.transaction(async (tx) => {
    const [request] = await tx
      .update(borrowRequestsTable)
      .set({
        status: nextStatus,
        pickupDate,
        pickupSlot,
        dueDate: dueDate ? dueDate.toISOString().slice(0, 10) : body.dueDate ?? undefined,
        note: body.note ?? undefined,
        updatedAt: now,
      })
      .where(eq(borrowRequestsTable.id, id))
      .returning();
    if (!request) throw new Error("Request disappeared during update");

    let transactionId = transaction?.id;
    if (
      !transactionId &&
      (nextStatus === "approved" ||
        nextStatus === "rescheduled" ||
        nextStatus === "collected" ||
        nextStatus === "returned")
    ) {
      const [createdTransaction] = await tx
        .insert(transactionsTable)
        .values({
          memberId: member.id,
          bookId: book.id,
          requestedPickupDate: pickupDate,
          requestedPickupTime: slotToTime(pickupSlot),
          approvedPickupDate:
            nextStatus === "approved" ||
            nextStatus === "rescheduled" ||
            nextStatus === "collected"
              ? pickupDate
              : undefined,
          approvedPickupTime:
            nextStatus === "approved" ||
            nextStatus === "rescheduled" ||
            nextStatus === "collected"
              ? slotToTime(pickupSlot)
              : undefined,
          borrowDate:
            nextStatus === "collected"
              ? now
              : nextStatus === "returned"
                ? existingRequest.createdAt
                : undefined,
          dueDate:
            dueDate ??
            (nextStatus === "returned" && existingRequest.dueDate
              ? new Date(`${existingRequest.dueDate}T23:59:59Z`)
              : undefined),
          returnDate: nextStatus === "returned" ? now : undefined,
          lateFee: lateFee === undefined ? undefined : String(lateFee),
          status:
            nextStatus === "collected"
              ? "borrowed"
              : nextStatus === "returned"
                ? "returned"
                : "approved",
        })
        .returning();
      transactionId = createdTransaction.id;
      await tx
        .update(borrowRequestsTable)
        .set({ transactionId, updatedAt: now })
        .where(eq(borrowRequestsTable.id, id));
    }

    if (transactionId) {
      const transactionStatus =
        nextStatus === "rescheduled"
          ? "approved"
          : nextStatus === "collected"
            ? "borrowed"
            : nextStatus === "pending"
              ? "requested"
              : nextStatus;
      await tx
        .update(transactionsTable)
        .set({
          status: transactionStatus as
            | "requested"
            | "approved"
            | "rejected"
            | "borrowed"
            | "returned"
            | "overdue"
            | "cancelled",
          approvedPickupDate:
            nextStatus === "approved" || nextStatus === "rescheduled" ? pickupDate : undefined,
          approvedPickupTime:
            nextStatus === "approved" || nextStatus === "rescheduled"
              ? slotToTime(pickupSlot)
              : undefined,
          borrowDate: nextStatus === "collected" ? now : undefined,
          dueDate: dueDate ?? undefined,
          returnDate: nextStatus === "returned" ? now : undefined,
          lateFee: lateFee === undefined ? undefined : String(lateFee),
          rejectionReason: nextStatus === "rejected" ? body.note ?? undefined : undefined,
          updatedAt: now,
        })
        .where(eq(transactionsTable.id, transactionId));
    }

    if (nextStatus === "collected") {
      await tx
        .update(booksTable)
        .set({ status: "rented", updatedAt: now })
        .where(and(eq(booksTable.id, book.id), eq(booksTable.status, "available")));
    }
    if (nextStatus === "returned") {
      await tx
        .update(booksTable)
        .set({ status: "available", updatedAt: now })
        .where(eq(booksTable.id, book.id));
      await tx
        .update(membersTable)
        .set({
          totalBooksRead: sql`${membersTable.totalBooksRead} + 1`,
          outstandingFees:
            lateFee && lateFee > 0
              ? sql`${membersTable.outstandingFees} + ${String(lateFee)}`
              : undefined,
          updatedAt: now,
        })
        .where(eq(membersTable.id, member.id));
    }
    await tx.insert(auditLogsTable).values({
      action: `request_${nextStatus}`,
      entityType: "borrow_request",
      entityId: id,
      metadata: JSON.stringify({
        bookId: book.id,
        memberId: member.id,
        lateFee: lateFee ?? 0,
        note: body.note ?? null,
      }),
    });
  });

  if (nextStatus === "approved") {
    await sendNotification({
      memberId: member.id,
      title: "বই নেওয়ার অনুরোধ অনুমোদিত",
      message: "আপনার বই নেওয়ার অনুরোধটি অনুমোদিত হয়েছে।",
      type: "request_approved",
    });
  }
  if (nextStatus === "rejected") {
    await sendNotification({
      memberId: member.id,
      title: "বই নেওয়ার অনুরোধ বাতিল হয়েছে",
      message: `আপনার বই নেওয়ার অনুরোধটি বাতিল হয়েছে${body.note?.trim() ? `। কারণ: ${body.note.trim()}` : "।"}`,
      type: "request_rejected",
    });
  }
  if (nextStatus === "rescheduled") {
    await sendNotification({
      memberId: member.id,
      title: "Pickup সময় পরিবর্তন হয়েছে",
      message: `আপনার বই নেওয়ার সময় পরিবর্তন করা হয়েছে। নতুন সময়: ${pickupDate}, ${pickupSlot}`,
      type: "request_rescheduled",
    });
  }
  if (nextStatus === "collected") {
    await sendNotification({
      memberId: member.id,
      title: "বই issue করা হয়েছে",
      message: `আপনার কাছে বইটি issue করা হয়েছে। ফেরতের তারিখ ${dueDate?.toISOString().slice(0, 10)}।`,
      type: "book_issued",
    });
  }
  if (nextStatus === "returned") {
    await sendNotification({
      memberId: member.id,
      title: "বই ফেরত গ্রহণ করা হয়েছে",
      message:
        lateFee && lateFee > 0
          ? `বই ফেরত নেওয়া হয়েছে। বর্তমান late fee ৳${lateFee}।`
          : "বই ফেরত নেওয়া হয়েছে। ধন্যবাদ।",
      type: "book_returned",
    });
  }

  const [updatedRequest] = await db
    .select()
    .from(borrowRequestsTable)
    .where(eq(borrowRequestsTable.id, id))
    .limit(1);
  const [updatedTransaction] = updatedRequest?.transactionId
    ? await db
        .select()
        .from(transactionsTable)
        .where(eq(transactionsTable.id, updatedRequest.transactionId))
        .limit(1)
    : [undefined];
  res.json(
    mapBorrowRequest(
      updatedRequest ?? existingRequest,
      book.title,
      member.name,
      member,
      updatedTransaction,
    ),
  );
});

router.get("/members", requireAdmin("members.view"), async (_req, res) => {
  await ensureSeedData();
  const members = await db.select().from(membersTable).orderBy(asc(membersTable.name));
  res.json(members.map(mapMember));
});

router.post("/members", requireAdmin("members.create"), async (req, res) => {
  const body = req.body as {
    name: string;
    email?: string | null;
    phone: string;
    university: string;
    studentId?: string | null;
    subscriptionPlan?: number;
  };
  if (!body.name?.trim() || !body.phone?.trim() || !body.university?.trim()) {
    res.status(400).json({ error: "Name, phone, and university are required." });
    return;
  }
  if (body.subscriptionPlan !== undefined && ![29, 49].includes(body.subscriptionPlan)) {
    res.status(400).json({ error: "Subscription plan must be 29 or 49 BDT." });
    return;
  }
  const [{ count: memberCount }] = await db
    .select({ count: count() })
    .from(membersTable);
  const plan = body.subscriptionPlan ?? (Number(memberCount) < 100 ? 29 : 49);
  const [member] = await db
    .insert(membersTable)
    .values({
      name: body.name.trim(),
      email: body.email ?? null,
      phone: body.phone.trim(),
      university: body.university.trim(),
      studentId: body.studentId ?? null,
      subscriptionPlan: String(plan),
      plan: "Student",
    })
    .returning();
  await recordAudit("member_created", "member", member.id, {
    name: member.name,
    subscriptionPlan: plan,
  });
  res.status(201).json(mapMember(member));
});

router.patch("/members/:id", requireAdmin("members.update"), async (req, res) => {
  const body = req.body as {
    name?: string;
    email?: string | null;
    phone?: string;
    university?: string;
    studentId?: string | null;
    subscriptionPlan?: number;
    subscriptionStart?: string | null;
    subscriptionEnd?: string | null;
    depositStatus?: string;
    status?: string;
  };
  if (body.status !== undefined && !["active", "expired", "suspended"].includes(body.status)) {
    res.status(400).json({ error: "Invalid member status." });
    return;
  }
  if (body.depositStatus !== undefined && !["paid", "unpaid", "partially_paid", "waived"].includes(body.depositStatus)) {
    res.status(400).json({ error: "Invalid deposit status." });
    return;
  }
  if (body.subscriptionPlan !== undefined && ![29, 49].includes(body.subscriptionPlan)) {
    res.status(400).json({ error: "Subscription plan must be 29 or 49 BDT." });
    return;
  }
  const [member] = await db
    .update(membersTable)
    .set({
      name: body.name,
      email: body.email,
      phone: body.phone,
      university: body.university,
      studentId: body.studentId,
      subscriptionPlan:
        body.subscriptionPlan === undefined ? undefined : String(body.subscriptionPlan),
      subscriptionStart: body.subscriptionStart,
      subscriptionEnd: body.subscriptionEnd,
      depositStatus: body.depositStatus,
      status: body.status,
      plan:
        body.subscriptionPlan === undefined ? undefined : `${body.subscriptionPlan} BDT`,
      updatedAt: new Date(),
    })
    .where(eq(membersTable.id, String(req.params.id)))
    .returning();
  if (!member) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  await recordAudit("member_updated", "member", member.id, {
    changedStatus: body.status ?? null,
    changedDepositStatus: body.depositStatus ?? null,
    changedPlan: body.subscriptionPlan ?? null,
  });
  res.json(mapMember(member));
});

router.get("/payments", requireAdmin("payments.view"), async (_req, res) => {
  await ensureSeedData();
  const payments = await db
    .select({ payment: paymentsTable, member: membersTable })
    .from(paymentsTable)
    .innerJoin(membersTable, eq(paymentsTable.memberId, membersTable.id))
    .orderBy(desc(paymentsTable.paidAt));
  res.json(
    payments.map(({ payment, member }) => ({
      id: payment.id,
      memberName: member.name,
      amount: money(payment.amount),
      method: payment.method,
      type: payment.type,
      status: payment.status,
      reference: payment.referenceNumber,
      transactionId: payment.transactionId,
      paidAt: payment.paidAt.toISOString(),
    })),
  );
});

router.post("/payments", requireAdmin("payments.create"), async (req, res) => {
  await ensureSeedData();
  const body = RecordPaymentBody.parse(req.body);
  if (body.amount <= 0) {
    res.status(400).json({ error: "Payment amount must be greater than zero." });
    return;
  }
  if (!["cash", "bkash", "nagad"].includes(body.method)) {
    res.status(400).json({ error: "Payment method must be cash, bkash, or nagad." });
    return;
  }
  if (!["subscription", "deposit", "late_fee", "lost_book", "damage_fee", "other"].includes(body.type)) {
    res.status(400).json({ error: "Invalid payment type." });
    return;
  }
  const [existingMember] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.id, body.memberId))
    .limit(1);
  if (!existingMember) {
    res.status(404).json({ error: "Member not found." });
    return;
  }

  const today = new Date();
  const todayString = today.toISOString().slice(0, 10);
  const subscriptionEnd =
    body.type === "subscription"
      ? new Date(
          Math.max(
            today.getTime(),
            existingMember.subscriptionEnd
              ? new Date(`${existingMember.subscriptionEnd}T23:59:59Z`).getTime()
              : today.getTime(),
          ) +
            30 * 86400000,
        )
          .toISOString()
          .slice(0, 10)
      : undefined;
  const nextDepositStatus =
    body.type === "deposit"
      ? body.amount >= money(existingMember.depositAmount)
        ? "paid"
        : "partially_paid"
      : undefined;
  const addsOutstandingFee = ["late_fee", "lost_book", "damage_fee"].includes(body.type);

  const result = await db.transaction(async (tx) => {
    const [payment] = await tx
      .insert(paymentsTable)
      .values({
        memberId: body.memberId,
        amount: String(body.amount),
        method: body.method as "cash" | "bkash" | "nagad",
        type: body.type,
        referenceNumber: body.reference,
      })
      .returning();
    const [member] = await tx
      .update(membersTable)
      .set({
        depositStatus: nextDepositStatus,
        subscriptionStart:
          body.type === "subscription" && !existingMember.subscriptionStart
            ? todayString
            : undefined,
        subscriptionEnd,
        status: body.type === "subscription" ? "active" : undefined,
        outstandingFees: addsOutstandingFee
          ? sql`${membersTable.outstandingFees} - LEAST(${membersTable.outstandingFees}, ${String(body.amount)})`
          : undefined,
        updatedAt: today,
      })
      .where(eq(membersTable.id, body.memberId))
      .returning();
    await tx.insert(auditLogsTable).values({
      action: "payment_recorded",
      entityType: "payment",
      entityId: payment.id,
      metadata: JSON.stringify({
        memberId: body.memberId,
        amount: body.amount,
        type: body.type,
        method: body.method,
      }),
    });
    return { payment, member };
  });

  const { payment, member } = result;
  await sendNotification({
    memberId: body.memberId,
    title: "Payment recorded",
    message: `আপনার ${body.type} payment ৳${body.amount} রেকর্ড করা হয়েছে।`,
    type: "payment",
  });
  res.status(201).json({
    id: payment.id,
    memberName: member?.name ?? existingMember.name,
    amount: money(payment.amount),
    method: payment.method,
    type: payment.type,
    status: payment.status,
      reference: payment.referenceNumber,
    paidAt: payment.paidAt.toISOString(),
  });
});

router.get("/analytics", requireAdmin("analytics.view"), async (_req, res) => {
  await ensureSeedData();
  const [books, members, requests] = await Promise.all([
    db.select({ status: booksTable.status, count: count() }).from(booksTable).groupBy(booksTable.status),
    db.select({ count: count() }).from(membersTable),
    db
      .select({ count: count() })
      .from(borrowRequestsTable)
      .where(eq(borrowRequestsTable.status, "pending")),
  ]);
  const byStatus = new Map(books.map((entry) => [entry.status, Number(entry.count)]));
  res.json({
    totalBooks: Array.from(byStatus.values()).reduce((sum, value) => sum + value, 0),
    availableBooks: byStatus.get("available") ?? 0,
    borrowedBooks: byStatus.get("rented") ?? 0,
    activeMembers: Number(members[0]?.count ?? 0),
    pendingRequests: Number(requests[0]?.count ?? 0),
    monthlyBorrowing: [
      { month: "Apr", count: 12 },
      { month: "May", count: 18 },
      { month: "Jun", count: 14 },
      { month: "Jul", count: 22 },
      { month: "Aug", count: 26 },
      { month: "Sep", count: 19 },
    ],
  });
});

export default router;