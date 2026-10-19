import { createElement } from "react";
import { render, toPlainText } from "react-email";
import { Resend } from "resend";
import InvitationEmail from "../emails/invitation";
import NotificationEmail from "../emails/notification";

export type NotificationEmailMessage = { to: string; subject: string; html: string; text: string };
export async function invitationEmail(data: { to: string; url: string; inviter: string }): Promise<NotificationEmailMessage> {
  const html = await render(createElement(InvitationEmail, data));
  return { to: data.to, subject: "Te han invitado a Taskode", html, text: toPlainText(html) };
}
export async function accessEmail(data: { to: string; message: string; title: string; url: string }): Promise<NotificationEmailMessage> {
  const html = await render(createElement(NotificationEmail, data));
  return { to: data.to, subject: `${data.message} · Taskode`, html, text: toPlainText(html) };
}
export async function sendNotificationEmail(message: NotificationEmailMessage, idempotencyKey: string) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) throw new Error("email-unconfigured");
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: process.env.RESEND_FROM_EMAIL, ...message }, { idempotencyKey, signal: AbortSignal.timeout(4000) });
  if (result.error) throw new Error("email-delivery-failed");
}
