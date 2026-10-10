import type { ToolArgs } from '@luma/shared';
import { assertPublicHttpUrl, guardedFetch } from '../../providers/safe-fetch.js';
import { redactSecrets } from '../../security/redact.js';
import { htmlToText } from '../html-text.js';
import { fail, ok, type ToolContext, type ToolResult } from './types.js';
import { truncateMiddle } from '../../runner/truncate.js';
import fs from 'node:fs';
import { notPlayableReason } from '../../projects/content.js';
import { usageFor } from '../../quota/service.js';
import path from 'node:path';

export function updatePlan(ctx: ToolContext, a: ToolArgs<'update_plan'>): ToolResult {
  ctx.bus.emit('plan.updated', { items: a.items });
  try {
    const dir = path.join(ctx.project.dir, '.luma');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'plan.json');
    fs.writeFileSync(file, JSON.stringify(a.items, null, 2));
    if (typeof process.getuid === 'function' && process.getuid() === 0 && ctx.project.uid != null) {
      fs.chownSync(dir, ctx.project.uid, ctx.project.uid);
      fs.chownSync(file, ctx.project.uid, ctx.project.uid);
    }
  } catch { /* the plan is a UI nicety; never fail the call */ }
  const done = a.items.filter((i) => i.status === 'done').length;
  return ok('Plan updated.', `${done}/${a.items.length} done`);
}

export async function askUser(ctx: ToolContext, a: ToolArgs<'ask_user'>): Promise<ToolResult> {
  const answer = await ctx.askUser(a.question, a.options ?? []);
  return ok(`The student answered: ${answer}`, answer.slice(0, 120));
}

export async function webFetch(ctx: ToolContext, a: ToolArgs<'web_fetch'>): Promise<ToolResult> {
  try {
    const url = assertPublicHttpUrl(a.url);
    const res = await guardedFetch(url, { signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(20_000)]), headers: { 'user-agent': 'LumaStudio/1.0 (+https://lumademy.com)', accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.1' }, redirect: 'follow' });
    if (!res.ok) return fail(`The server answered ${res.status} ${res.statusText}`);
    const type = res.headers.get('content-type') ?? '';
    if (!/^(text\/|application\/(json|xml|xhtml))/i.test(type)) return fail(`Unsupported content type "${type}" — only text pages can be fetched.`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      chunks.push(value);
      if (size > 2_000_000) {
        await reader.cancel();
        break;
      }
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    const text = /html/i.test(type) ? htmlToText(raw) : raw;
    const t = truncateMiddle(redactSecrets(text, ctx.secrets), 30_000);
    return ok(t.text, `${url.hostname} (${Math.round(size / 1024)} KB)`, { truncated: t.truncated });
  } catch (e) {
    const msg = (e as Error).message;
    return fail(/private|EBLOCKED/i.test(msg) ? 'That address is not reachable (private or local).' : `Could not fetch the page: ${msg}`);
  }
}

export async function renderVideo(ctx: ToolContext, a: ToolArgs<'render_video'>): Promise<ToolResult> {
  const empty = notPlayableReason(ctx.project.dir);
  if (empty) return fail(empty);
  if (!ctx.render) return fail('Rendering is not available on this server yet.');
  return ctx.render.render({ projectId: ctx.projectId, userId: ctx.userId, runId: ctx.runId, preset: a.preset, mode: a.mode, signal: ctx.signal, bus: ctx.bus });
}

/** A buy card for fast render hours in the chat (the student pays online (bKash, card, Nagad…) and comes back to the project). */
export function offerRenderHours(ctx: ToolContext, a: ToolArgs<'offer_render_hours'>): ToolResult {
  const u = usageFor(ctx.db, ctx.userId);
  const hours = Math.min(a.hours ?? 1, u.fastRender.maxHours);
  ctx.bus.emit('billing.offer', {
    reason: a.reason,
    suggestedHours: hours,
    pricePerHourBdt: u.fastRender.pricePerHourBdt,
    maxHours: u.fastRender.maxHours,
    paymentsEnabled: u.fastRender.paymentsEnabled,
    freeSecondsLeft: u.freeRender.secondsLeft,
    fastSecondsLeft: u.fastRender.secondsLeft,
  });
  return ok(
    u.fastRender.paymentsEnabled
      ? `The student now sees a card to buy fast render hours (${u.fastRender.pricePerHourBdt} BDT per hour). Once they pay they come back here; then render with mode "fast".`
      : 'The student sees the card, but online payment is not set up on this server yet — tell them to contact Lumademy support.',
    'Offered fast render hours',
  );
}
