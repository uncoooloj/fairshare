"use client";
import { useEffect, useReducer, useRef, useState } from 'react';
import { initialWorkspaceName, workspaceNameDraft } from '../lib/workspace-name';
import { Button, Field } from './ui';

export function WorkspaceNameForm({ name, busy, onSave }: {
  name: string; busy: boolean; onSave: (name: string) => Promise<void>;
}) {
  const [state, dispatch] = useReducer(workspaceNameDraft, name, initialWorkspaceName);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  useEffect(() => { dispatch({ type: 'refresh', name }); }, [name]);
  const value = state.draft.trim();
  return <form className="inline-form" onSubmit={async event => {
    event.preventDefault();
    if (pending.current || busy || !value || value.length > 100 || value === state.serverName) return;
    pending.current = true; setSaving(true); setError('');
    try { await onSave(value); }
    catch { setError('The workspace name could not be saved. Your changes are still here.'); }
    finally { pending.current = false; setSaving(false); }
  }}>
    <Field label="Workspace name">
      <input name="workspaceName" required maxLength={100} value={state.draft}
        disabled={busy || saving} onChange={event => dispatch({ type: 'edit', name: event.target.value })} />
    </Field>
    <Button disabled={busy || saving || !value || value === state.serverName}>
      {saving ? 'Saving…' : 'Save workspace name'}
    </Button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
