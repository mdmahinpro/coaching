#!/usr/bin/env node
/** Server/operator-only synthetic showcase fixture. Dry-run by default. */
import crypto from 'node:crypto';
import process from 'node:process';
import { assertStrictTarget, pgConfig } from './lib/provisioning.mjs';

const apply = process.env.SHOWCASE_FIXTURE_APPLY === '1';
const runId = process.env.SHOWCASE_FIXTURE_RUN_ID?.trim() || crypto.randomUUID();
const databaseUrl = process.env.CUSTOMER_DATABASE_URL?.trim();
const projectRef = process.env.CUSTOMER_PROJECT_REF?.trim();
const environment = process.env.CUSTOMER_ENVIRONMENT?.trim();
const customerId = process.env.CUSTOMER_ID?.trim();

async function main() {
  if (!customerId) throw new Error('CUSTOMER_ID is required');
  assertStrictTarget({ databaseUrl, projectRef, environment, allowedEnvironment: 'showcase' });
  const plan = {
    mode: apply ? 'apply' : 'dry-run',
    run_id: runId,
    project_ref: projectRef,
    environment,
    fixture: 'minimal-synthetic-showcase-v1',
    ownership: 'Every inserted row is recorded in showcase_fixture_rows and linked to showcase_fixture_runs.',
  };
  if (!apply) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  const { Client } = await import('pg');
  const client = new Client(pgConfig(databaseUrl));
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE IF NOT EXISTS public.showcase_fixture_runs (
      run_id UUID PRIMARY KEY, fixture_version TEXT NOT NULL, customer_id TEXT NOT NULL,
      project_ref TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS public.showcase_fixture_rows (
      run_id UUID NOT NULL REFERENCES public.showcase_fixture_runs(run_id) ON DELETE RESTRICT,
      table_name TEXT NOT NULL, row_id UUID NOT NULL, PRIMARY KEY(run_id, table_name, row_id)
    )`);
    await client.query('INSERT INTO public.showcase_fixture_runs(run_id,fixture_version,customer_id,project_ref) VALUES ($1,$2,$3,$4)', [runId, plan.fixture, customerId, projectRef]);

    const teacher = (await client.query(`INSERT INTO public.teachers(name,email,subject,qualification,is_active)
      VALUES ('Showcase Teacher', $1, 'Mathematics', 'Synthetic fixture', true) RETURNING id`, [`teacher+${runId}@example.invalid`])).rows[0];
    await client.query('INSERT INTO public.showcase_fixture_rows(run_id,table_name,row_id) VALUES ($1,$2,$3)', [runId, 'teachers', teacher.id]);
    const batch = (await client.query(`INSERT INTO public.batches(name,subject,teacher,teacher_id,class_level,fee,monthly_fee,capacity,max_seats,is_active)
      VALUES ($1,'Mathematics','Showcase Teacher',$2,'Class 9-10',500,500,20,20,true) RETURNING id`, [`Showcase batch ${runId}`, teacher.id])).rows[0];
    await client.query('INSERT INTO public.showcase_fixture_rows(run_id,table_name,row_id) VALUES ($1,$2,$3)', [runId, 'batches', batch.id]);
    const student = (await client.query(`INSERT INTO public.students(name,email,phone,guardian_name,guardian_phone,batch_id,class_level,student_id,status,is_approved,password)
      VALUES ('Showcase Student',$1,$2,'Showcase Guardian',$3,$4,'Class 9',$5,'active',true,crypt($6,gen_salt('bf'))) RETURNING id`,
      [`student+${runId}@example.invalid`, `98${runId.replaceAll('-', '').slice(0, 9)}`, `97${runId.replaceAll('-', '').slice(0, 9)}`, batch.id, `SHOW-${runId.slice(0, 8)}`, crypto.randomBytes(18).toString('base64url')])).rows[0];
    await client.query('INSERT INTO public.showcase_fixture_rows(run_id,table_name,row_id) VALUES ($1,$2,$3)', [runId, 'students', student.id]);
    await client.query('COMMIT');
    console.log(JSON.stringify({ ...plan, inserted: { teachers: 1, batches: 1, students: 1 } }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
