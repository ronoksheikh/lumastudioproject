import { toolSchemas, type ToolArgs, type ToolName } from '@luma/shared';
import { saveLesson } from '../lessons.js';
import { shareAsset, useAsset } from '../library.js';
import { ToolError } from '../../runner/files.js';
import { bash } from './bash.js';
import { editFile, listFiles, readFile, writeFile } from './files.js';
import { previewFrames } from './frames.js';
import { readGuide } from './guide.js';
import { askUser, offerRenderHours, renderVideo, updatePlan, webFetch } from './misc.js';
import { fail, ok, type ToolContext, type ToolResult } from './types.js';
import { generateVoice, listVoices, patchVoice } from './voice.js';

export * from './types.js';

/** A tool whose ToolError is a normal, explained failure (not a crash). */
const plain = (fn: () => string): ToolResult => {
  try {
    return ok(fn());
  } catch (e) {
    if (e instanceof ToolError) return fail(e.message);
    throw e;
  }
};

type Handler<N extends ToolName> = (ctx: ToolContext, args: ToolArgs<N>) => ToolResult | Promise<ToolResult>;
const handlers: { [N in ToolName]: Handler<N> } = {
  bash,
  read_file: readFile,
  write_file: writeFile,
  edit_file: editFile,
  list_files: listFiles,
  update_plan: updatePlan,
  generate_voice: generateVoice,
  list_voices: listVoices,
  patch_voice: patchVoice,
  preview_frames: previewFrames,
  render_video: renderVideo,
  offer_render_hours: offerRenderHours,
  ask_user: askUser,
  web_fetch: webFetch,
  read_guide: readGuide,
  save_lesson: (ctx, args) => {
    const r = saveLesson(ctx.db, { ...args, userId: ctx.userId, projectId: ctx.projectId, runId: ctx.runId, secrets: ctx.secrets });
    return r.ok ? ok(r.message, r.message) : fail(r.message);
  },
  share_asset: (ctx, args) => plain(() => shareAsset(ctx.db, ctx.project, ctx.userId, args)),
  use_asset: (ctx, args) => plain(() => useAsset(ctx.db, ctx.project, args.id, args.to)),
  compact_context: (ctx, args) => {
    if (!ctx.requestCompaction) return fail('Context compaction is not available here.');
    ctx.requestCompaction(args.keep);
    return ok('The older messages will be folded into the project memory before your next step. Continue with the task.', 'Compacting context');
  },
};

export const isToolName = (n: string): n is ToolName => n in toolSchemas;

/**
 * Validates the model's raw JSON arguments against the tool's schema and runs the tool. Anything wrong
 * (unknown tool, malformed JSON, schema violation) comes back as an error result the model can learn from.
 */
export async function runTool(name: string, rawArgs: string, ctx: ToolContext): Promise<{ result: ToolResult; args: unknown }> {
  if (!isToolName(name)) return { result: fail(`Unknown tool "${name}". Available tools: ${Object.keys(toolSchemas).join(', ')}.`), args: rawArgs };
  let json: unknown;
  try {
    json = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch (e) {
    return { result: fail(`The arguments for ${name} are not valid JSON (${(e as Error).message}). If the content was long, split it into smaller write_file / edit_file calls.`), args: rawArgs };
  }
  const parsed = toolSchemas[name].safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ');
    return { result: fail(`Invalid arguments for ${name}: ${problems}`), args: json };
  }
  try {
    const result = await (handlers[name] as Handler<ToolName>)(ctx, parsed.data as never);
    return { result, args: parsed.data };
  } catch (e) {
    if ((e as Error).name === 'AbortError') return { result: fail('Stopped.'), args: parsed.data };
    return { result: fail(`${name} crashed: ${(e as Error).message}`), args: parsed.data };
  }
}
