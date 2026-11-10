"use client";
import { useEffect, useState } from 'react';
import { api } from './model';

// Fail closed: never advertise a delivery action before the server confirms it.
export function useEmailDelivery() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    api<{ emailDelivery: boolean }>('auth/capabilities')
      .then(result => { if (active) setEnabled(result.emailDelivery === true); })
      .catch(() => { /* Link sharing and in-app updates remain available. */ });
    return () => { active = false; };
  }, []);
  return enabled;
}
