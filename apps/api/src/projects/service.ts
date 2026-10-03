import fs from 'node:fs';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { ASPECTS, type Aspect } from '@luma/shared';
import type { DB } from '../db/index.js';
import { projects } from '../db/schema.js';
import { notFound } from '../http/errors.js';
import { getVoicePrefs } from '../settings/service.js';
import type { ProjectRef } from '../runner/exec.js';
import { allocateUid, initProjectDir, newProjectId, projectRef } from './dirs.js';

export type ProjectRow = typeof projects.$inferSelect;

export const isAspect = (a: string): a is Aspect => a in ASPECTS;

export const toRef = (p: ProjectRow): ProjectRef => projectRef(p.id, p.uid);

export function publicProject(p: ProjectRow) {
  return { id: p.id, title: p.title, aspect: p.aspect, status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt };
}

/** A project the user owns and has not deleted — or a 404 (never reveal other people's project ids). */
export function getOwnedProject(db: DB, userId: string, projectId: string): ProjectRow {
  const row = db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId), isNull(projects.deletedAt)))
    .get();
  if (!row) throw notFound('Project not found');
  return row;
}

export function listProjects(db: DB, userId: string): ProjectRow[] {
  return db.select().from(projects).where(and(eq(projects.userId, userId), isNull(projects.deletedAt))).orderBy(desc(projects.updatedAt)).all();
}

export function createProject(db: DB, userId: string, input: { title: string; aspect: Aspect }): ProjectRow {
  const voice = getVoicePrefs(db, userId);
  const id = newProjectId();
  // allocate the uid and insert in one synchronous transaction so two creates cannot share a uid
  const row = db.transaction((tx) => {
    const uid = allocateUid(tx as unknown as DB);
    tx.insert(projects).values({ id, userId, title: input.title, aspect: input.aspect, uid }).run();
    return tx.select().from(projects).where(eq(projects.id, id)).get()!;
  });
  try {
    initProjectDir(toRef(row), { title: input.title, aspect: input.aspect, voice });
  } catch (err) {
    db.delete(projects).where(eq(projects.id, id)).run();
    fs.rmSync(toRef(row).dir, { recursive: true, force: true });
    throw err;
  }
  return row;
}

export function touchProject(db: DB, projectId: string) {
  db.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, projectId)).run();
}

export function updateProject(db: DB, p: ProjectRow, patch: { title?: string }) {
  db.update(projects).set({ ...patch, updatedAt: Date.now() }).where(eq(projects.id, p.id)).run();
  return { ...p, ...patch };
}

/** Soft delete: the folder stays until the purge job removes it (7 days). */
export function softDeleteProject(db: DB, p: ProjectRow) {
  db.update(projects).set({ deletedAt: Date.now(), status: 'deleted' }).where(eq(projects.id, p.id)).run();
}
