"use client";
import { useEffect, useState, useRef, type ReactNode } from "react";
import { useEmailDelivery } from "../lib/email-capability";
import { api } from "../lib/model";
import { toneForId } from "../lib/person";
import { Avatar } from "./person";
import { SettingsRow } from "./settings-preferences";
import { Button, Field } from "./ui";

/** Photo and email rows. `children` (the name row) renders between them, matching the reference order. */
export function ProfileContact({
  userId,
  name,
  email,
  emailVerified = false,
  emailAction,
  children,
}: {
  userId: string;
  name: string;
  email: string;
  emailVerified?: boolean;
  emailAction?: ReactNode;
  children?: ReactNode;
}) {
  const emailDelivery = useEmailDelivery();
  const [photo, setPhoto] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  const pending = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    api("auth/profile/photo")
      .then((result) => {
        if (active) setPhoto(result.photo);
      })
      .catch(() => {
        if (active) setError("Profile photo could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);
  async function perform(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save. Please try again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="profile-contact">
      <SettingsRow
        label="Photo"
        hint="PNG or JPEG, up to 250 KB. Kept private to your account."
      >
        <div className="settings-photo">
          {photo ? (
            <img
              src={photo}
              alt={`${name}'s profile`}
              width={64}
              height={64}
              className="settings-photo-image"
            />
          ) : (
            <span className="settings-photo-avatar">
              <Avatar name={name} tone={toneForId(userId)} />
            </span>
          )}
          <input
            ref={fileInput}
            className="visually-hidden"
            tabIndex={-1}
            aria-label="Upload profile photo"
            type="file"
            accept="image/png,image/jpeg"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void perform(async () => {
                if (
                  !["image/png", "image/jpeg"].includes(file.type) ||
                  file.size > 256000
                )
                  throw new Error("Choose a PNG or JPEG smaller than 250 KB.");
                const data = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result));
                  reader.onerror = () =>
                    reject(new Error("Image could not be read."));
                  reader.readAsDataURL(file);
                });
                await new Promise<void>((resolve, reject) => {
                  const image = new Image();
                  image.onload = () =>
                    image.naturalWidth <= 4096 && image.naturalHeight <= 4096
                      ? resolve()
                      : reject(
                          new Error(
                            "Choose an image up to 4096 × 4096 pixels.",
                          ),
                        );
                  image.onerror = () =>
                    reject(new Error("Image could not be opened."));
                  image.src = data;
                });
                const result = await api("auth/profile/photo", "PUT", {
                  photo: data,
                });
                setPhoto(result.photo);
                setNotice("Profile photo saved.");
              });
            }}
          />
          <Button
            type="button"
            variant="secondary"
            className="settings-upload"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 15V4m0 0-4 4m4-4 4 4M5 15v4h14v-4" />
            </svg>
            {busy ? "Uploading…" : photo ? "Replace" : "Upload"}
          </Button>
          {photo && (
            <Button
              type="button"
              variant="quiet"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await api("auth/profile/photo", "PUT", { photo: null });
                  setPhoto(null);
                  setNotice("Profile photo removed.");
                })
              }
            >
              Remove
            </Button>
          )}
        </div>
      </SettingsRow>
      {children}
      <SettingsRow
        label="Email"
        hint={
          emailDelivery
            ? "Used to sign in and for notifications."
            : "Used to sign in. It can’t be changed yet."
        }
      >
        <div className="settings-email">
          <input
            aria-label="Email"
            type="email"
            value={email}
            readOnly
            className="settings-readonly"
          />
          {emailVerified && <span className="status-chip good">Verified</span>}
          {emailAction}
          {emailDelivery && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setChanging(!changing)}
            >
              {changing ? "Cancel" : "Change"}
            </Button>
          )}
        </div>
      </SettingsRow>
      {emailDelivery && changing && (
        <form
          className="settings-row-reveal"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget,
              data = new FormData(form);
            void perform(async () => {
              const result = await api("auth/email-change/request", "POST", {
                email: data.get("email"),
                password: data.get("password"),
                mfaCode: data.get("mfaCode") || undefined,
              });
              form.reset();
              setNotice(result.notice);
            });
          }}
        >
          <p className="muted">
            Your current email stays active until the new one is verified, then
            all sessions sign out.
          </p>
          <Field label="New email">
            <input
              type="email"
              name="email"
              required
              maxLength={254}
              autoComplete="email"
              disabled={busy}
            />
          </Field>
          <Field label="Current password">
            <input
              type="password"
              name="password"
              required
              maxLength={256}
              autoComplete="current-password"
              disabled={busy}
            />
          </Field>
          <Field
            label="Authenticator or recovery code"
            hint="Only if two-step sign-in is on."
          >
            <input
              name="mfaCode"
              autoComplete="one-time-code"
              maxLength={80}
              disabled={busy}
            />
          </Field>
          <Button disabled={busy}>
            {busy ? "Requesting…" : "Send verification link"}
          </Button>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
