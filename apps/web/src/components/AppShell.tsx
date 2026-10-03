import { useQueryClient } from '@tanstack/react-query';
import { Avatar, Dropdown } from '@heroui/react';
import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { api, setCsrf } from '../api/client';
import type { User } from '../api/types';
import { Logo } from './Logo';

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${isActive ? 'bg-[#eff5ff] text-[#1557d1]' : 'text-[#5b6b8f] hover:text-[#2970ec]'}`;

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
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
    <div className="flex h-full flex-col">
      <header className="flex h-14 flex-none items-center gap-6 border-b border-[var(--border)] bg-white px-4 sm:px-6">
        <Link to="/" aria-label="Luma Studio home" className="flex items-center gap-3">
          <Logo className="h-6" />
          <span className="hidden text-sm font-semibold text-[#2970ec] sm:inline">Luma Studio</span>
        </Link>
        <nav className="flex items-center gap-1" aria-label="Main">
          <NavLink to="/" end className={link}>Projects</NavLink>
          <NavLink to="/settings" className={link}>Settings</NavLink>
        </nav>
        <div className="ml-auto">
          <Dropdown>
            <Dropdown.Trigger aria-label="Account menu" className="flex items-center gap-2 rounded-full outline-none">
              <Avatar size="sm" color="accent">
                <Avatar.Fallback>{user.email.slice(0, 2).toUpperCase()}</Avatar.Fallback>
              </Avatar>
              <span className="hidden max-w-48 truncate text-sm text-[#5b6b8f] md:inline">{user.email}</span>
            </Dropdown.Trigger>
            <Dropdown.Popover>
              <Dropdown.Menu onAction={(key) => (key === 'logout' ? void logout() : nav('/settings/account'))}>
                <Dropdown.Item id="account" textValue="Account">Account</Dropdown.Item>
                <Dropdown.Item id="logout" textValue="Log out">Log out</Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
