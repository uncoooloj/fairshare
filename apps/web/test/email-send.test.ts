import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "../lib/model";
import { EmailSendButton } from "../components/email-send-button";
import {
  emailReceiptNotice,
  invitationEmailToken,
  createEmailSender,
  emailRejectedBeforeSend,
} from "../lib/email-send";

const source = (file: string) =>
  readFileSync(new URL("../" + file, import.meta.url), "utf8");

test("email action fails closed before capability is confirmed", () => {
  assert.equal(
    renderToStaticMarkup(
      createElement(EmailSendButton, {
        path: "test",
        destination: "person@example.test",
        label: "Email invitation",
        payload: () => ({ token: "test" }),
      }),
    ),
    "",
  );
});

test("invitation email only extracts an existing valid bearer token", () => {
  assert.equal(
    invitationEmailToken(
      "https://example.test/invitation#token=agreement%3A" +
        "a_b-C123".padEnd(43, "x"),
    ),
    "a_b-C123".padEnd(43, "x"),
  );
  for (const link of [
    "",
    "invalid",
    "https://example.test/app",
    "https://example.test/#token=agreement%3A",
    "https://example.test/#token=workspace%3Aabc",
    "https://example.test/#token=agreement%3Aabc%20def",
  ])
    assert.equal(invitationEmailToken(link), undefined);
});

test("provider receipt never claims inbox delivery and blocks uncertain resend", () => {
  assert.match(
    emailReceiptNotice({ status: "PROVIDER_ACCEPTED" }),
    /Inbox delivery is not confirmed/,
  );
  assert.match(
    emailReceiptNotice({ status: "PROVIDER_ACCEPTED", repeated: true }),
    /No additional email/,
  );
  assert.match(emailReceiptNotice({ status: "SENDING" }), /Do not resend/);
  assert.match(emailReceiptNotice({ status: "UNCONFIRMED" }), /Do not resend/);
});

test("double clicks share one attempt even after uncertain rejection; remounts have no cross-session state", async () => {
  const sendEmailOnce = createEmailSender();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("network uncertain");
  }) as typeof fetch;
  try {
    const first = sendEmailOnce("test/email-one", { token: "abc" });
    assert.equal(first, sendEmailOnce("test/email-one", { token: "abc" }));
    await assert.rejects(first);
    await assert.rejects(sendEmailOnce("test/email-one", { token: "abc" }));
    assert.equal(calls, 1);
    await assert.rejects(sendEmailOnce("test/reminder", { recipientId: "a" }));
    await assert.rejects(sendEmailOnce("test/reminder", { recipientId: "b" }));
    assert.equal(calls, 3);
    await assert.rejects(
      createEmailSender()("test/email-one", { token: "abc" }),
    );
    assert.equal(calls, 4);
  } finally {
    globalThis.fetch = original;
  }
});

test("UI guards late completions, validates current link, and names destination", () => {
  const button = source("components/email-send-button.tsx");
  assert.match(button, /attempted.current \|\| !active.current/);
  assert.match(button, /active.current = false/);
  assert.match(button, /if \(active.current\) setNotice/);
  assert.match(button, /to \{destination\}/);
  const person = source("components/person-share.tsx");
  assert.match(person, /invitationEmailToken\(currentKnownLink\(\)\)/);
  assert.match(person, /destination=\{member.pending!.email\}/);
  assert.match(person, /!isPendingMember\(member\)/);
  assert.match(
    source("components/wizard-sent-step.tsx"),
    /liveInviteLink\(invite, location.origin\)/,
  );
  assert.doesNotMatch(
    source("lib/email-send.ts"),
    /issueInviteLink|replacePersonLink/,
  );
});

test("known rejected-before-send errors allow correction and retry; unknown errors do not", async () => {
  for (const code of [
    "EMAIL_UNVERIFIED",
    "EMAIL_VERIFICATION_REQUIRED",
    "NOTIFICATIONS_DISABLED",
    "INVALID_INVITATION",
    "EMAIL_UNAVAILABLE",
  ])
    assert.equal(
      emailRejectedBeforeSend(new ApiError("Correct this", 409, code)),
      true,
    );
  for (const code of [
    "EMAIL_DELIVERY_UNCONFIRMED",
    "INTERNAL_SERVER_ERROR",
    undefined,
  ])
    assert.equal(
      emailRejectedBeforeSend(new ApiError("Uncertain", 503, code)),
      false,
    );
  assert.equal(emailRejectedBeforeSend(new Error("network")), false);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(
      JSON.stringify({
        error: {
          code: "NOTIFICATIONS_DISABLED",
          message: "Approval request emails are disabled.",
        },
      }),
      { status: 409 },
    );
  }) as typeof fetch;
  try {
    const send = createEmailSender();
    await assert.rejects(send("test/rejected", {}));
    await assert.rejects(send("test/rejected", {}));
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
  assert.match(
    source("components/email-send-button.tsx"),
    /error instanceof ApiError[\s\S]*\? error.message/,
  );
});

test("verification and unavailable errors retain actionable copy", async () => {
  const { errorCopy } = await import("../lib/error-copy");
  assert.match(
    errorCopy(
      403,
      "EMAIL_VERIFICATION_REQUIRED",
      "Verify your email before using workspace invitations.",
    ),
    /Verify your email/,
  );
  assert.match(errorCopy(503, "EMAIL_UNAVAILABLE"), /No email was sent/);
  assert.match(errorCopy(503, "EMAIL_DELIVERY_UNCONFIRMED"), /Do not resend/);
});

test("reissued invitations reset local email state even if the seat id stays unchanged", () => {
  assert.match(
    source("components/person-share.tsx"),
    /props.member.pending\?\.invitationId/,
  );
  assert.match(
    source("components/wizard-sent-step.tsx"),
    /key=\{`[^`]*invite.invitationId/,
  );
});
