import { useQueryClient } from '@tanstack/react-query';
import { Avatar, Dropdown } from '@heroui/react';
import { useEffect, type ReactNode } from 'react';
import { toast } from '@heroui/react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, setCsrf } from '../api/client';
import type { User } from '../api/types';
import { Icon } from './Icon';
import { Logo } from './Logo';

/** Account + settings, small and out of the way (home and settings pages only). */
export function AccountMenu({ user }: { user: User }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const logout = async () => {
    await api.logout().catch(() => {});
    setCsrf('');
    qc.clear();
    nav('/login');
    window.location.reload();
  };
  return (
    <div className="flex items-center gap-1">
      <Link to="/settings" aria-label="Settings" title="Settings" className="grid h-9 w-9 place-items-center rounded-full text-[#5b6b8f] transition-colors hover:bg-[#eff5ff] hover:text-[#2970ec]">
        <Icon name="settings" size={18} />
      </Link>
      <Dropdown>
        <Dropdown.Trigger aria-label="Account menu" className="rounded-full outline-none">
          <Avatar size="sm" color="accent">
            <Avatar.Fallback>{user.email.slice(0, 2).toUpperCase()}</Avatar.Fallback>
          </Avatar>
        </Dropdown.Trigger>
        <Dropdown.Popover>
          <Dropdown.Menu onAction={(key) => (key === 'logout' ? void logout() : nav(({ settings: '/settings/models', admin: '/admin', addons: '/settings/addons', improvements: '/improvements' } as Record<string, string>)[String(key)] ?? '/settings/account'))}>
            <Dropdown.Item id="who" textValue={user.email} isDisabled><span className="text-xs text-[#5b6b8f]">{user.email}</span></Dropdown.Item>
            <Dropdown.Item id="account" textValue="Account">Account</Dropdown.Item>
            <Dropdown.Item id="addons" textValue="Add-ons">Add-ons &amp; API</Dropdown.Item>
            <Dropdown.Item id="improvements" textValue="Improvements">Report a problem / suggest</Dropdown.Item>
            {user.isAdmin ? <Dropdown.Item id="admin" textValue="Admin panel">Admin panel</Dropdown.Item> : null}
            <Dropdown.Item id="settings" textValue="Settings">Models &amp; voice</Dropdown.Item>
            <Dropdown.Item id="logout" textValue="Log out">Log out</Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}

/**
 * Home and Settings get a slim top bar (logo + account). Inside a project there is no global header at all:
 * the project page shows only project-level UI (back, title, tabs, run status).
 */
/** Back from paying: ?payment=paid|pending|failed → a toast, then the parameter is removed. */
function usePaymentReturn() {
  const { search, pathname } = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  useEffect(() => {
    const p = new URLSearchParams(search).get('payment');
    if (!p) return;
    if (p === 'paid') toast.success(pathname.endsWith('/addons') ? 'Payment received — your add-on is active.' : 'Payment received — your fast render hours are ready.');
    else if (p === 'pending') toast.info?.('Payment is being confirmed. It usually takes a minute — your purchase appears as soon as it is confirmed.');
    else toast.danger('The payment did not go through. Try again, or pick another payment method.');
    void qc.invalidateQueries({ queryKey: ['usage'] });
    void qc.invalidateQueries({ queryKey: ['addons'] });
    nav(pathname, { replace: true });
  }, [search, pathname, nav, qc]);
}

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const { pathname } = useLocation();
  usePaymentReturn();
  if (pathname.startsWith('/projects/')) return <main className="h-full overflow-hidden">{children}</main>;
  return (
    <div className="flex h-full flex-col">
      <header className="mx-auto flex h-16 w-full max-w-5xl flex-none items-center gap-3 bg-white px-4 sm:px-8">
        <Link to="/" aria-label="Luma Studio home" className="flex items-center gap-2.5">
          <Logo className="h-6" />
          <span className="h-5 w-px bg-[var(--border)]" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight text-[#2970ec]">Luma Studio</span>
        </Link>
        <div className="ml-auto"><AccountMenu user={user} /></div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
