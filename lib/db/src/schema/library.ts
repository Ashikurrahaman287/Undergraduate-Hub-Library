import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  time,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const bookStatus = pgEnum("book_status", ["available", "rented", "lost"]);
export const requestStatus = pgEnum("request_status", [
  "pending",
  "approved",
  "rejected",
  "rescheduled",
  "collected",
  "returned",
]);
export const paymentMethod = pgEnum("payment_method", ["cash", "bkash", "nagad"]);
export const depositStatus = pgEnum("deposit_status", [
  "paid",
  "unpaid",
  "partially_paid",
  "waived",
]);
export const memberStatus = pgEnum("member_status", ["active", "expired", "suspended"]);
export const transactionStatus = pgEnum("transaction_status", [
  "requested",
  "approved",
  "rejected",
  "borrowed",
  "returned",
  "overdue",
  "cancelled",
]);
export const paymentStatus = pgEnum("payment_status", ["paid", "pending", "cancelled"]);
export const userRole = pgEnum("user_role", ["member", "staff", "admin", "super_admin"]);

export const booksTable = pgTable("books", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  author: text("author").notNull().default("Unknown author"),
  category: text("category").notNull().default("Other"),
  language: text("language").notNull().default("English"),
  coverUrl: text("cover_url"),
  qrCode: text("qr_code").notNull().unique(),
  isbn: text("isbn"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),
  status: bookStatus("status").notNull().default("available"),
  conditionNote: text("condition_note"),
  depositRequired: boolean("deposit_required").notNull().default(true),
  depositAmount: numeric("deposit_amount", { precision: 10, scale: 2 })
    .notNull()
    .default("300"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const membersTable = pgTable("members", {
  id: uuid("id").defaultRandom().primaryKey(),
  authUserId: uuid("auth_user_id"),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone").notNull().unique(),
  university: text("university").notNull().default("Other"),
  studentId: text("student_id"),
  subscriptionPlan: numeric("subscription_plan", { precision: 10, scale: 0 })
    .notNull()
    .default("49"),
  subscriptionStart: date("subscription_start", { mode: "string" }),
  subscriptionEnd: date("subscription_end", { mode: "string" }),
  plan: text("plan").notNull().default("Student"),
  role: userRole("role").notNull().default("member"),
  depositAmount: numeric("deposit_amount", { precision: 10, scale: 2 })
    .notNull()
    .default("300"),
  depositStatus: text("deposit_status").notNull().default("unpaid"),
  status: text("status").notNull().default("active"),
  outstandingFees: numeric("outstanding_fees", { precision: 10, scale: 2 })
    .notNull()
    .default("0"),
  totalBooksRead: numeric("total_books_read", { precision: 10, scale: 0 })
    .notNull()
    .default("0"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userRolesTable = pgTable(
  "user_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    role: userRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => [uniqueIndex("user_roles_user_role_idx").on(table.userId, table.role)],
);

export const adminSessionsTable = pgTable("admin_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberSessionsTable = pgTable("member_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => membersTable.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const otpChallengesTable = pgTable("otp_challenges", {
  id: uuid("id").defaultRandom().primaryKey(),
  phone: text("phone").notNull(),
  otpHash: text("otp_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  requestIp: text("request_ip"),
});

export const borrowRequestsTable = pgTable("borrow_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookId: uuid("book_id")
    .notNull()
    .references(() => booksTable.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => membersTable.id),
  transactionId: uuid("transaction_id"),
  pickupDate: date("pickup_date", { mode: "string" }).notNull(),
  pickupSlot: text("pickup_slot").notNull(),
  status: requestStatus("status").notNull().default("pending"),
  note: text("note"),
  dueDate: date("due_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactionsTable = pgTable("transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => membersTable.id),
  bookId: uuid("book_id")
    .notNull()
    .references(() => booksTable.id),
  requestDate: timestamp("request_date", { withTimezone: true }).notNull().defaultNow(),
  requestedPickupDate: date("requested_pickup_date", { mode: "string" }).notNull(),
  requestedPickupTime: time("requested_pickup_time"),
  approvedPickupDate: date("approved_pickup_date", { mode: "string" }),
  approvedPickupTime: time("approved_pickup_time"),
  borrowDate: timestamp("borrow_date", { withTimezone: true }),
  dueDate: timestamp("due_date", { withTimezone: true }),
  returnDate: timestamp("return_date", { withTimezone: true }),
  status: transactionStatus("status").notNull().default("requested"),
  lateFee: numeric("late_fee", { precision: 10, scale: 2 }).notNull().default("0"),
  staffNote: text("staff_note"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentsTable = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => membersTable.id),
  transactionId: uuid("transaction_id").references(() => transactionsTable.id),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  method: paymentMethod("method").notNull(),
  type: text("type").notNull().default("subscription"),
  status: text("status").notNull().default("paid"),
  referenceNumber: text("reference_number"),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
});

export const wishlistsTable = pgTable("wishlists", {
  id: uuid("id").defaultRandom().primaryKey(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => membersTable.id),
  bookId: uuid("book_id")
    .notNull()
    .references(() => booksTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationsTable = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  memberId: uuid("member_id").references(() => membersTable.id),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("general"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogsTable = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  adminId: uuid("admin_id").references(() => membersTable.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBookSchema = createInsertSchema(booksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertMemberSchema = createInsertSchema(membersTable).omit({
  id: true,
  joinedAt: true,
  updatedAt: true,
});
export const insertBorrowRequestSchema = createInsertSchema(borrowRequestsTable).omit({
  id: true,
  memberId: true,
  status: true,
  createdAt: true,
});
export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({
  id: true,
  paidAt: true,
});

export type Book = typeof booksTable.$inferSelect;
export type Member = typeof membersTable.$inferSelect;
export type BorrowRequest = typeof borrowRequestsTable.$inferSelect;
export type Payment = typeof paymentsTable.$inferSelect;
export type Transaction = typeof transactionsTable.$inferSelect;
export type Wishlist = typeof wishlistsTable.$inferSelect;
export type Notification = typeof notificationsTable.$inferSelect;
export type AuditLog = typeof auditLogsTable.$inferSelect;
export type InsertBook = z.infer<typeof insertBookSchema>;
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type InsertBorrowRequest = z.infer<typeof insertBorrowRequestSchema>;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;