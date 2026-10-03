import fs from 'node:fs';
import type { ToolArgs } from '@luma/shared';
import { editProjectFile, listProjectFiles, readProjectFile, ToolError, writeProjectFile } from '../../runner/files.js';
import { fail, ok, type ToolContext, type ToolResult } from './types.js';

function changed(ctx: ToolContext, r: { path: string; change: 'created' | 'modified'; additions: number; deletions: number }, diff?: string) {
  ctx.bus.emit('file.changed', { path: r.path, change: r.change, additions: r.additions, deletions: r.deletions, ...(diff ? { diff: diff.slice(0, 60_000) } : {}) });
}

export function readFile(ctx: ToolContext, a: ToolArgs<'read_file'>): ToolResult {
  try {
    const r = readProjectFile(ctx.project, a.path, { offset: a.offset, limit: a.limit });
    if (r.kind === 'image') {
      if (!ctx.supportsVision) return ok(`${r.path} is an image (${r.bytes} bytes). The current model cannot view images; describe it from its file name and context, or ask the student.`, `${r.path} (image, not viewable)`);
      return ok(`Image ${r.path} attached below.`, `${r.path} (image)`, { images: [{ mime: r.mime, base64: r.base64, label: r.path }] });
    }
    if (r.kind === 'binary') return ok(`${r.path} is a binary file (${r.bytes} bytes); it cannot be shown as text.`, `${r.path} (binary)`);
    const note = r.truncated ? `\n[showing part of ${r.totalLines} lines — use offset/limit to read more]` : '';
    return ok(r.text + note, `${r.path} (${r.totalLines} lines)`, { truncated: r.truncated });
  } catch (e) {
    if (e instanceof ToolError) return fail(e.message);
    if ((e as NodeJS.ErrnoException).code === 'ELOOP') return fail('That path is a symlink; symlinks are not followed.');
    return fail((e as Error).message);
  }
}

export function writeFile(ctx: ToolContext, a: ToolArgs<'write_file'>): ToolResult {
  try {
    const r = writeProjectFile(ctx.project, a.path, a.content);
    changed(ctx, r, r.diff);
    return ok(`${r.change === 'created' ? 'Created' : 'Overwrote'} ${r.path} (+${r.additions} −${r.deletions})`);
  } catch (e) {
    return fail(e instanceof ToolError ? e.message : (e as Error).message);
  }
}

export function editFile(ctx: ToolContext, a: ToolArgs<'edit_file'>): ToolResult {
  try {
    const r = editProjectFile(ctx.project, a.path, a.old_string, a.new_string, a.replace_all ?? false);
    changed(ctx, r, r.diff);
    return ok(`Edited ${r.path} (+${r.additions} −${r.deletions})`);
  } catch (e) {
    return fail(e instanceof ToolError ? e.message : (e as Error).message);
  }
}

export function listFiles(ctx: ToolContext, a: ToolArgs<'list_files'>): ToolResult {
  try {
    const entries = listProjectFiles(ctx.project, a.path ?? '.', a.depth ?? 3);
    const lines = entries.map((e) => (e.type === 'dir' ? `${e.path}/` : `${e.path}  (${e.size} B)`));
    const text = lines.length > 400 ? `${lines.slice(0, 400).join('\n')}\n…${lines.length - 400} more` : lines.join('\n');
    return ok(text || '(empty)', `${entries.length} entries`);
  } catch (e) {
    return fail(e instanceof ToolError ? e.message : (e as Error).message);
  }
}

export const fileExists = (abs: string) => fs.existsSync(abs);
