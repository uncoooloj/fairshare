"use client";
import { useEffect, useState, useRef } from "react";
import { useEmailDelivery } from "../lib/email-capability";
import { api } from "../lib/model";
import { Button, Field } from "./ui";

export function ProfileContact({
  name,
  email,
}: {
  name: string;
  email: string;
}) {
  const emailDelivery = useEmailDelivery();
  const [photo, setPhoto] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  const pending = useRef(false);
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
      <div className="settings-identity">
        {photo ? (
          <img
            src={photo}
            alt={`${name}'s profile`}
            width={56}
            height={56}
            style={{ borderRadius: "50%", objectFit: "cover" }}
          />
        ) : (
          <span className="avatar">{name.slice(0, 1)}</span>
        )}
        <h3>{name}</h3>
      </div>
      <Field
        label="Profile photo"
        hint="PNG or JPEG, up to 250 KB. Stored privately on your account."
      >
        <input
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
                        new Error("Choose an image up to 4096 × 4096 pixels."),
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
      </Field>
      {photo && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              await api("auth/profile/photo", "PUT", { photo: null });
              setPhoto(null);
              setNotice("Profile photo removed.");
            })
          }
        >
          Remove photo
        </Button>
      )}
      <p>{email}</p>
      {!emailDelivery && (
        <p className="muted">
          This is your sign-in address. Email changes are unavailable because
          email delivery is not enabled. You can still change your password
          below.
        </p>
      )}
      {emailDelivery && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => setChanging(!changing)}
        >
          {changing ? "Cancel email change" : "Change email"}
        </Button>
      )}
      {emailDelivery && changing && (
        <form
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
            Your current email stays active until you verify the new address.
            Verification signs out all sessions. Agreement identities and PayPal
            recipients will not change.
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
            hint="Required if two-factor authentication is enabled."
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
