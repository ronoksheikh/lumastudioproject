// One thin wrapper so the whole app speaks one icon language: every glyph is a Phosphor icon
// (@phosphor-icons/react, MIT). Named imports only — the bundler drops the ~1,500 icons we don't use.
import {
  ArrowClockwise, ArrowCounterClockwise, ArrowSquareOut, Brain, CaretDown, CaretRight, Camera, Check, ClockCounterClockwise,
  CornersOut, DotsThree, DownloadSimple, Eye, File, FilmStrip, Folder, GearSix, GitBranch, Globe, Image, ImageSquare,
  ListBullets, Microphone, PaperPlaneRight, Paperclip, Pause, PencilSimple, Play, Plus, Question, SignOut, Sparkle,
  Stop, TerminalWindow, Trash, UserCircle, Warning, X, House, Crosshair, BookOpenText, Lightning, Robot,
  PlugsConnected, Key, SlidersHorizontal, Star, Package, CheckCircle, Waveform,
  type Icon as PhosphorIcon, type IconProps,
} from '@phosphor-icons/react';

const GLYPHS = {
  play: Play,
  lightning: Lightning,
  robot: Robot,
  pause: Pause,
  stop: Stop,
  send: PaperPlaneRight,
  clip: Paperclip,
  file: File,
  folder: Folder,
  terminal: TerminalWindow,
  clock: ClockCounterClockwise,
  check: Check,
  x: X,
  refresh: ArrowClockwise,
  download: DownloadSimple,
  camera: Camera,
  spark: Sparkle,
  chevron: CaretRight,
  down: CaretDown,
  external: ArrowSquareOut,
  brain: Brain,
  mic: Microphone,
  film: FilmStrip,
  git: GitBranch,
  plus: Plus,
  trash: Trash,
  pencil: PencilSimple,
  eye: Eye,
  list: ListBullets,
  globe: Globe,
  image: Image,
  frame: ImageSquare,
  help: Question,
  warn: Warning,
  undo: ArrowCounterClockwise,
  maximize: CornersOut,
  more: DotsThree,
  settings: GearSix,
  user: UserCircle,
  logout: SignOut,
  home: House,
  target: Crosshair,
  guide: BookOpenText,
  plug: PlugsConnected,
  key: Key,
  sliders: SlidersHorizontal,
  star: Star,
  package: Package,
  ok: CheckCircle,
  wave: Waveform,
} satisfies Record<string, PhosphorIcon>;

export type IconName = keyof typeof GLYPHS;

/** Glyphs that read better solid (media controls, the send arrow, the Luma spark). */
const FILLED = new Set<IconName>(['play', 'pause', 'stop', 'send', 'spark']);

/**
 * `weight` defaults to "regular" (the app's weight); `strokeWidth` > 2.5 is accepted for old call sites and
 * maps to "bold" (tiny check marks inside dots).
 */
export function Icon({ name, size = 16, weight, strokeWidth, className, ...rest }: { name: IconName; size?: number; weight?: IconProps['weight']; strokeWidth?: number } & Omit<IconProps, 'size' | 'weight'>) {
  const Glyph = GLYPHS[name];
  const w = weight ?? (FILLED.has(name) ? 'fill' : strokeWidth && strokeWidth > 2.5 ? 'bold' : 'regular');
  return <Glyph size={size} weight={w} className={className} aria-hidden="true" focusable="false" {...rest} />;
}
