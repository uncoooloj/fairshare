"use client";
import { useEffect, useRef, useState } from "react";
import { useEmailDelivery } from "../lib/email-capability";
import {
  emailReceiptNotice,
  createEmailSender,
  emailRejectedBeforeSend,
} from "../lib/email-send";
import { ApiError } from "../lib/model";

/** Key this component by recipient/operation so a newer screen never receives an old result. */
export function EmailSendButton({
  path,
  destination,
  label,
  payload,
}: {
  path: string;
  destination: string;
  label: string;
  payload: () => object | undefined;
}) {
  const enabled = useEmailDelivery();
  const active = useRef(false);
  const attempted = useRef(false);
  const sendEmailOnce = useRef(createEmailSender()).current;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  if (!enabled || !destination) return null;
  async function send() {
    if (!enabled || attempted.current || !active.current) return;
    const body = payload();
    if (!body) {
      setNotice(
        "This link expired. Get a new link from the People tab before emailing.",
      );
      return;
    }
    attempted.current = true;
    setBusy(true);
    try {
      const receipt = await sendEmailOnce(path, body);
      if (active.current) setNotice(emailReceiptNotice(receipt));
    } catch (error) {
      if (active.current) {
        if (emailRejectedBeforeSend(error)) attempted.current = false;
        setNotice(
          error instanceof ApiError &&
            (emailRejectedBeforeSend(error) ||
              error.code === "EMAIL_DELIVERY_UNCONFIRMED")
            ? error.message
            : "Email could not be confirmed. Do not resend; copy or share the link directly instead.",
        );
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <div className="person-share-email">
      <button
        type="button"
        className="button secondary"
        disabled={busy || attempted.current}
        onClick={() => void send()}
      >
        {busy ? "Requesting email…" : label} to {destination}
      </button>
      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
