---
name: Library operations data integrity
description: Operational transitions must tolerate legacy seeded requests without transaction links.
---

Circulation actions should create or backfill a transaction when approving or issuing a request that predates the transaction link, so a later return can still update the book, member history, fees, and audit trail atomically.

**Why:** Imported development data can contain borrow requests created before transaction linking was added; rejecting returns is safer than silently losing history, but backfilling preserves the operational workflow.

**How to apply:** When changing request status logic, validate the request state and book availability, then perform request, transaction, book, member, notification, and audit updates in one database transaction.