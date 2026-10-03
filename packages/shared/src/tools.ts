// Agent tool definitions (plan.md Appendix B). One zod schema per tool; the JSON schema sent to the model
// is derived from it, and the api validates every call against the same schema.
import { z } from 'zod';

const path = z.string().min(1).max(400).describe('Path inside the project folder, relative (e.g. "public/js/scenes/00-hook.js")');

export const toolSchemas = {
  bash: z.object({
    command: z.string().min(1).max(20_000).describe('Shell command, run with bash -lc in the project folder. node, npm, ffmpeg, git, curl are available.'),
    timeout_s: z.number().int().min(1).max(600).optional().describe('Timeout in seconds (default 120, max 600)'),
    cwd: z.string().max(400).optional().describe('Working directory relative to the project root (default: the root)'),
  }),
  read_file: z.object({
    path,
    offset: z.number().int().min(1).optional().describe('First line to read (1-based)'),
    limit: z.number().int().min(1).max(5000).optional().describe('Max lines (default 2000)'),
  }),
  write_file: z.object({
    path,
    content: z.string().max(1_000_000).describe('Complete new content of the file'),
  }),
  edit_file: z.object({
    path,
    old_string: z.string().min(1).describe('Exact text to replace (must be unique in the file unless replace_all)'),
    new_string: z.string().describe('Replacement text'),
    replace_all: z.boolean().optional().describe('Replace every occurrence'),
  }),
  list_files: z.object({
    path: z.string().max(400).optional().describe('Directory (default: project root)'),
    depth: z.number().int().min(1).max(6).optional().describe('Levels to show (default 3)'),
  }),
  update_plan: z.object({
    items: z.array(z.object({
      text: z.string().min(1).max(200),
      status: z.enum(['todo', 'doing', 'done']),
    })).min(1).max(30).describe('The whole checklist (replaces the previous one)'),
  }),
  generate_voice: z.object({
    segments: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]+$/), text: z.string().min(1) })).optional()
      .describe('Optional: replace script.json segments before generating. Omit to use script.json as it is.'),
    placeholder: z.boolean().optional().describe('Dry run: silent audio with evenly spaced word timings. Use only when no ElevenLabs key is available or to preview visuals quickly.'),
  }),
  patch_voice: z.object({
    segment_id: z.string().regex(/^[A-Za-z0-9_-]+$/).describe('Id of the segment whose text you changed in script.json'),
  }),
  preview_frames: z.object({
    times: z.array(z.number().min(0)).min(1).max(8).describe('Timeline seconds to capture, e.g. the key word of each scene'),
    width: z.number().int().min(320).max(1920).optional().describe('Image width in px (default 960)'),
  }),
  render_video: z.object({
    preset: z.enum(['draft', 'final']).describe('draft = 1080p30 fast review render, final = 1080p60 high quality'),
  }),
  ask_user: z.object({
    question: z.string().min(1).max(500),
    options: z.array(z.string().min(1).max(120)).max(6).optional().describe('Optional quick-reply buttons'),
  }),
  web_fetch: z.object({
    url: z.string().url().describe('http(s) URL to fetch; HTML is converted to readable text'),
  }),
} as const;

export type ToolName = keyof typeof toolSchemas;
export type ToolArgs<N extends ToolName> = z.infer<(typeof toolSchemas)[N]>;
export const TOOL_NAMES = Object.keys(toolSchemas) as ToolName[];

const descriptions: Record<ToolName, string> = {
  bash: 'Run a shell command in the project folder (node, npm, ffmpeg, git, curl). Output is streamed; long output is truncated in the middle. Each call is a fresh shell — state does not persist between calls.',
  read_file: 'Read a text file with line numbers, or view an image (png/jpg/webp) if the model supports vision.',
  write_file: 'Create or fully overwrite a file. Prefer edit_file for changes to existing files.',
  edit_file: 'Replace exact text in a file. old_string must match once (add context) unless replace_all is true.',
  list_files: 'List files and folders in the project (node_modules, export and .git are hidden).',
  update_plan: 'Publish/refresh the pinned checklist the student sees. Send the whole list each time.',
  generate_voice: 'Generate the voiceover with ElevenLabs from script.json and write public/audio/{voiceover.mp3,timing.json}. Returns every word with its start time so you can plan visuals on words.',
  patch_voice: 'Re-record ONE segment after editing its text in script.json and splice it into the existing audio. Later timings shift automatically.',
  preview_frames: 'Render the video at the given timeline seconds and return screenshots (and layout problems found in the page). Use it to check every scene.',
  render_video: 'Queue an MP4 render (draft or final). The student sees live progress; returns when the render is done.',
  ask_user: 'Ask the student a question and wait for the answer. Use only when you are genuinely blocked; otherwise choose sensible defaults.',
  web_fetch: 'Fetch a web page or text file (HTML converted to readable text, truncated).',
};

export interface ToolDefinition {
  type: 'function';
  function: { name: ToolName; description: string; parameters: Record<string, unknown> };
}

/** OpenAI-compatible `tools` array. */
export function toolDefinitions(names: readonly ToolName[] = TOOL_NAMES): ToolDefinition[] {
  return names.map((name) => {
    const schema = z.toJSONSchema(toolSchemas[name], { target: 'draft-7' }) as Record<string, unknown>;
    delete schema.$schema;
    return { type: 'function', function: { name, description: descriptions[name], parameters: schema } };
  });
}
