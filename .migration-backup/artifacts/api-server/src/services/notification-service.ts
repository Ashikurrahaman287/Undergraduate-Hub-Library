import { db, notificationsTable } from "@workspace/db";

export type NotificationInput = {
  memberId: string;
  title: string;
  message: string;
  type: string;
};

export interface NotificationProvider {
  send(input: NotificationInput): Promise<void>;
}

export async function sendNotification(input: NotificationInput) {
  await db.insert(notificationsTable).values(input);
}