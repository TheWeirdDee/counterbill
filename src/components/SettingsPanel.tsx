'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ThemeMenu, type ApiFail } from './ui';

export function SettingsPanel() {
  const router = useRouter();
  const [profile, setProfile] = useState({ displayName: '', organizationName: '', contactDetails: '' });
  const [email, setEmail] = useState('');
  const [caseCount, setCaseCount] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<ApiFail | null>(null);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await api<{ user: { displayName: string; organizationName: string; contactDetails: string; email: string }; caseCount: number }>('/api/account');
      if (res.ok) {
        setProfile({ displayName: res.data.user.displayName, organizationName: res.data.user.organizationName, contactDetails: res.data.user.contactDetails });
        setEmail(res.data.user.email);
        setCaseCount(res.data.caseCount);
      }
    })();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await api('/api/account', { method: 'PATCH', body: JSON.stringify(profile) });
    if (res.ok) setSaved('Saved. New letters will use these details.');
    else setError(res.error);
  }

  async function wipe(e: React.FormEvent) {
    e.preventDefault();
    setDeleting(true);
    setError(null);
    const res = await api('/api/account', { method: 'DELETE', body: JSON.stringify({ password: pw, confirm }) });
    if (res.ok) {
      router.push('/');
      router.refresh();
    } else {
      setError(res.error);
      setDeleting(false);
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: '1.7rem' }}>Settings</h1>
      <form className="card" onSubmit={save}>
        <h2>Sender details for letters</h2>
        <p className="muted">Shown on the letter only if you provide them. Signed in as {email}.</p>
        <div className="field">
          <label htmlFor="s-name">Your name</label>
          <input id="s-name" type="text" value={profile.displayName} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-org">Business name</label>
          <input id="s-org" type="text" value={profile.organizationName} onChange={(e) => setProfile({ ...profile, organizationName: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-contact">Address, email and phone for the letter</label>
          <textarea id="s-contact" value={profile.contactDetails} onChange={(e) => setProfile({ ...profile, contactDetails: e.target.value })} />
        </div>
        <button type="submit" className="btn btn-primary">
          Save
        </button>
        {saved ? (
          <p role="status" className="muted" style={{ marginTop: 8 }}>
            {saved}
          </p>
        ) : null}
      </form>

      <div className="card">
        <h2>Appearance</h2>
        <ThemeMenu showLabel />
      </div>

      <div className="card">
        <h2>Privacy and your data</h2>
        <p>
          Uploaded documents are stored privately against your account. When you run an investigation, their text is sent to the AI model provider configured for this deployment. This product does not claim zero retention by that provider. Exports can contain names, addresses and payment details: check who receives them.
        </p>
        <p className="muted">You can delete a single case from its page. Deleting your account removes every case, document, fact, letter and export, including the stored files.</p>
      </div>

      <form className="card" onSubmit={wipe} style={{ borderColor: 'var(--bad)' }}>
        <h2>Delete my account and all data</h2>
        <p>
          This permanently deletes {caseCount} case{caseCount === 1 ? '' : 's'} and everything stored with {caseCount === 1 ? 'it' : 'them'}. It cannot be undone.
        </p>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="d-pw">Password</label>
            <input id="d-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
          </div>
          <div className="field">
            <label htmlFor="d-confirm">Type DELETE to confirm</label>
            <input id="d-confirm" type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" required />
          </div>
        </div>
        {error ? (
          <p role="alert" className="error-text">
            {error.message}
          </p>
        ) : null}
        <button type="submit" className="btn btn-danger" disabled={deleting || confirm !== 'DELETE' || !pw}>
          {deleting ? 'Deleting…' : 'Delete everything'}
        </button>
      </form>
    </div>
  );
}
