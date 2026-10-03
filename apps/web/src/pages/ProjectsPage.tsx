import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertDialog, Button, Card, Chip, Dropdown, Input, Label, Modal, Skeleton, TextField, toast } from '@heroui/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Project } from '../api/types';
import { Icon } from '../components/Icon';
import { timeAgo, useProjects } from '../lib/hooks';

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
            <Modal.Heading>New project</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <form id="new-project" className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); if (title.trim()) create.mutate(); }}>
              <TextField value={title} onChange={setTitle} autoFocus isRequired>
                <Label>Project title</Label>
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
            <Button type="submit" form="new-project" variant="primary" isDisabled={!title.trim() || create.isPending}>Create project</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function ProjectCard({ project, onDelete }: { project: Project; onDelete: () => void }) {
  const nav = useNavigate();
  const portrait = project.aspect === '9:16';
  return (
    <Card className="group overflow-hidden p-0 transition-shadow hover:shadow-lg" variant="default">
      <button onClick={() => nav(`/projects/${project.id}`)} className="block w-full text-left" aria-label={`Open ${project.title}`}>
        <div className="luma-gradient relative grid h-40 place-items-center">
          <div className={`rounded-md bg-white/15 ring-1 ring-white/50 backdrop-blur-sm ${portrait ? 'h-28 w-16' : 'h-24 w-44'}`}>
            <div className="grid h-full place-items-center text-white/90"><Icon name="film" size={28} /></div>
          </div>
        </div>
        <div className="p-4">
          <h3 className="truncate text-base font-semibold">{project.title}</h3>
          <div className="mt-2 flex items-center gap-2 text-xs text-[#5b6b8f]">
            <Chip size="sm" color="accent"><Chip.Label>{project.aspect}</Chip.Label></Chip>
            <span>Edited {timeAgo(project.updatedAt)}</span>
          </div>
        </div>
      </button>
      <div className="absolute right-2 top-2">
        <Dropdown>
          <Dropdown.Trigger aria-label={`Actions for ${project.title}`} className="grid h-8 w-8 place-items-center rounded-full bg-white/90 text-[#2970ec] shadow outline-none">
            <Icon name="list" size={16} />
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu onAction={(k) => k === 'delete' && onDelete()}>
              <Dropdown.Item id="delete" textValue="Delete project">Delete project</Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
    </Card>
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

  return (
    <div className="scroll-y h-full">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#1557d1]">Your projects</h1>
            <p className="text-sm text-[#5b6b8f]">Describe a video, watch Luma build it, download the MP4.</p>
          </div>
          <Button variant="primary" onPress={() => setCreating(true)}>
            <Icon name="plus" /> New project
          </Button>
        </div>

        {projects.isLoading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-60 rounded-2xl" />)}</div>
        )}
        {projects.data && projects.data.length === 0 && (
          <div className="luma-gradient rounded-3xl p-10 text-center text-white">
            <h2 className="text-2xl font-bold">Make your first motion-graphics video</h2>
            <p className="mx-auto mt-2 max-w-md text-white/90">Add your model and ElevenLabs key in Settings, then create a project and tell Luma what to make.</p>
            <Button variant="secondary" className="mt-5" onPress={() => setCreating(true)}>Create a project</Button>
          </div>
        )}
        {projects.data && projects.data.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.data.map((p) => <div key={p.id} className="relative"><ProjectCard project={p} onDelete={() => setDeleting(p)} /></div>)}
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
