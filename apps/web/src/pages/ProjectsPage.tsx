import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertDialog, Button, Dropdown, Input, Label, Modal, Skeleton, TextField, toast } from '@heroui/react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Project } from '../api/types';
import { Icon } from '../components/Icon';
import { timeAgo, useModels, useProjects, useVoice } from '../lib/hooks';

function NewProjectModal({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (o: boolean) => void }) {
  const [title, setTitle] = useState('');
  const [aspect, setAspect] = useState<'16:9' | '9:16'>('16:9');
  const qc = useQueryClient();
  const nav = useNavigate();
  const create = useMutation({
    mutationFn: () => api.createProject(title.trim(), aspect),
    onSuccess: ({ project }) => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      onOpenChange(false);
      setTitle('');
      nav(`/projects/${project.id}`);
    },
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : 'Could not create the project'),
  });
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-md">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>New video</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <form id="new-project" className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); if (title.trim()) create.mutate(); }}>
              <TextField value={title} onChange={setTitle} autoFocus isRequired>
                <Label>Title</Label>
                <Input placeholder="e.g. Lumademy course ad" />
              </TextField>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">Format</legend>
                <div className="grid grid-cols-2 gap-3">
                  {([['16:9', 'Landscape', 'YouTube, web', 'h-10 w-[4.5rem]'], ['9:16', 'Portrait', 'Reels, Shorts, Stories', 'h-[4.5rem] w-10']] as const).map(([v, name, hint, shape]) => (
                    <button type="button" key={v} onClick={() => setAspect(v)} aria-pressed={aspect === v}
                      className={`flex flex-col items-center gap-2 rounded-xl border-2 p-3 text-center transition-colors ${aspect === v ? 'border-[#2970ec] bg-[#eff5ff]' : 'border-[var(--border)] hover:border-[#5daeff]'}`}>
                      <span className={`luma-gradient block rounded ${shape}`} />
                      <span className="text-sm font-semibold">{name} · {v}</span>
                      <span className="text-xs text-[#5b6b8f]">{hint}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            </form>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">Cancel</Button>
            <Button type="submit" form="new-project" variant="primary" isDisabled={!title.trim() || create.isPending}>Create</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/** The latest render's first frame (top-left tile of its 2×2 contact sheet), else a calm brand tile. */
function Thumb({ project }: { project: Project }) {
  const portrait = project.aspect === '9:16';
  const [broken, setBroken] = useState(false);
  return (
    <div className="relative grid aspect-video place-items-center overflow-hidden rounded-xl bg-[#eff5ff]">
      {project.thumbnailUrl && !broken ? (
        <div className={`relative h-full ${portrait ? 'aspect-[9/16]' : 'w-full'} overflow-hidden`}>
          <img src={project.thumbnailUrl} alt="" onError={() => setBroken(true)} className="absolute left-0 top-0 h-[200%] w-[200%] max-w-none object-cover" />
        </div>
      ) : (
        <div className={`luma-gradient grid place-items-center rounded-lg text-white/90 shadow-sm ${portrait ? 'h-[72%] aspect-[9/16]' : 'h-[62%] aspect-video'}`}>
          <Icon name="film" size={22} />
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, onDelete }: { project: Project; onDelete: () => void }) {
  const nav = useNavigate();
  return (
    <div className="group relative">
      <button onClick={() => nav(`/projects/${project.id}`)} className="block w-full rounded-2xl p-2 text-left transition-colors hover:bg-[#f5f8ff] focus-visible:outline-2 focus-visible:outline-[#2970ec]" aria-label={`Open ${project.title}`}>
        <Thumb project={project} />
        <div className="px-1 pb-1 pt-3">
          <h3 className="truncate text-[15px] font-semibold text-[#1f2937]">{project.title}</h3>
          <p className="mt-0.5 text-xs text-[#5b6b8f]">{project.aspect === '9:16' ? 'Portrait' : 'Landscape'} · edited {timeAgo(project.updatedAt)}</p>
        </div>
      </button>
      <div className="absolute right-4 top-4 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <Dropdown>
          <Dropdown.Trigger aria-label={`Actions for ${project.title}`} className="grid h-8 w-8 place-items-center rounded-full bg-white/95 text-[#5b6b8f] shadow-sm outline-none hover:text-[#2970ec]">
            <Icon name="more" size={18} weight="bold" />
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu onAction={(k) => k === 'delete' && onDelete()}>
              <Dropdown.Item id="delete" textValue="Delete project">Delete project</Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
    </div>
  );
}

/** Shown until the student has a model and a voice key: three small steps, not a wall of text. */
function GettingStarted() {
  const models = useModels();
  const voice = useVoice();
  if (models.isLoading || voice.isLoading) return null;
  const steps = [
    { done: (models.data ?? []).some((m) => m.supportsTools), label: 'Add your AI model', to: '/settings/models' },
    { done: !!voice.data?.hasKey, label: 'Add your ElevenLabs key', to: '/settings/voice' },
  ];
  if (steps.every((x) => x.done)) return null;
  return (
    <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-[var(--border)] bg-[#fafcff] px-5 py-3.5 text-sm" role="note">
      <span className="font-semibold text-[#1557d1]">Before your first video</span>
      {steps.map((x, i) => (
        <Link key={x.to} to={x.to} className={`flex items-center gap-2 ${x.done ? 'text-[#5b6b8f] line-through' : 'font-medium text-[#2970ec] hover:underline'}`}>
          <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${x.done ? 'bg-[#2970ec] text-white' : 'border border-[#2970ec]'}`}>{x.done ? <Icon name="check" size={11} weight="bold" /> : i + 1}</span>
          {x.label}
        </Link>
      ))}
    </div>
  );
}

export function ProjectsPage() {
  const projects = useProjects();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project deleted');
    },
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : 'Could not delete the project'),
  });
  const list = projects.data ?? [];

  return (
    <div className="scroll-y h-full">
      <div className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-8 sm:pt-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[#1f2937]">Your videos</h1>
            <p className="mt-1 text-[15px] text-[#5b6b8f]">Describe a video, watch Luma build it, download the MP4.</p>
          </div>
          <Button variant="primary" size="lg" onPress={() => setCreating(true)}>
            <Icon name="plus" weight="bold" /> New video
          </Button>
        </div>

        <GettingStarted />

        {projects.isLoading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />)}</div>
        )}
        {projects.data && list.length === 0 && (
          <button onClick={() => setCreating(true)} className="group grid w-full place-items-center rounded-3xl border-2 border-dashed border-[#c9d9f7] bg-[#fafcff] px-6 py-16 text-center transition-colors hover:border-[#2970ec]">
            <span className="luma-gradient mb-4 grid h-14 w-14 place-items-center rounded-2xl text-white shadow-lg shadow-[#2970ec]/25"><Icon name="spark" size={26} /></span>
            <span className="text-xl font-semibold text-[#1557d1]">Make your first motion-graphics video</span>
            <span className="mt-1 max-w-md text-sm text-[#5b6b8f]">Start a project, tell Luma what you want — a script, a topic, a style — and it writes, voices, animates and renders it.</span>
            <span className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-[#2970ec] px-4 py-2 text-sm font-semibold text-white group-hover:bg-[#1557d1]"><Icon name="plus" weight="bold" /> New video</span>
          </button>
        )}
        {list.length > 0 && (
          <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((p) => <ProjectCard key={p.id} project={p} onDelete={() => setDeleting(p)} />)}
          </div>
        )}
      </div>
      <NewProjectModal isOpen={creating} onOpenChange={setCreating} />
      <AlertDialog.Backdrop isOpen={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[420px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Delete “{deleting?.title}”?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body><p>The project disappears from your list. This can’t be undone from the app.</p></AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">Cancel</Button>
              <Button slot="close" variant="danger" onPress={() => deleting && remove.mutate(deleting.id)}>Delete project</Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  );
}
