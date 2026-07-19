/* global console, fetch, process, setTimeout */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import GhostAdminAPI from '@tryghost/admin-api';
import { GhostPublisher } from '../dist/publisher.js';

const ghostUrl = process.env.GHOST_INTEGRATION_URL ?? 'http://localhost:2368';
const email = 'owner@example.com';
const password = 'correct horse battery staple 2026';
const uploadRoot = await mkdtemp(path.join(tmpdir(), 'ghost-publisher-integration-'));
const imagePath = path.join(uploadRoot, 'pixel.png');
await writeFile(
  imagePath,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVR4nO3OIQEAAAgDMLoQjfiEgBg3E/Ornr2kEhAQEBAQEBAQEBAQEBAQSAcecybAiG90aXEAAAAASUVORK5CYII=',
    'base64',
  ),
);

async function request(path, options = {}) {
  const response = await fetch(`${ghostUrl}${path}`, options);
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path} failed: ${response.status} ${await response.text()}`);
  return response;
}

async function waitForGhost() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      if ((await fetch(`${ghostUrl}/ghost/api/admin/authentication/setup/`)).ok) return;
    } catch {
      // Ghost is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error('Ghost did not start within three minutes');
}

async function createAdminKey() {
  await request('/ghost/api/admin/authentication/setup/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ setup: [{ name: 'Integration Owner', email, password, blogTitle: 'MCP Test' }] }),
  });
  const session = await request('/ghost/api/admin/session/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ghostUrl },
    body: JSON.stringify({ grant_type: 'password', username: email, password }),
    redirect: 'manual',
  });
  const cookie = session.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ');
  const integration = await request('/ghost/api/admin/integrations/?include=api_keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ghostUrl, cookie },
    body: JSON.stringify({ integrations: [{ name: 'Ghost Publisher Integration Test' }] }),
  }).then((response) => response.json());
  const adminKey = integration.integrations[0].api_keys.find((key) => key.type === 'admin')?.secret;
  assert.match(adminKey, /^[a-f\d]{24}:[a-f\d]{64}$/i);
  return adminKey;
}

await waitForGhost();
const adminKey = await createAdminKey();
const config = {
  ghostUrl,
  ghostAdminApiKey: adminKey,
  ghostApiVersion: 'v5.0',
  readOnly: false,
  uploadRoots: [uploadRoot],
};
const publisher = new GhostPublisher(config);
const api = new GhostAdminAPI({ url: ghostUrl, key: adminKey, version: 'v5.0' });
let created;

try {
  const image = await publisher.uploadImage(imagePath);
  assert.equal(image.mime_type, 'image/png');
  assert.match(image.url, /^https?:\/\//);

  const slug = `ghost-publisher-integration-${Date.now()}`;
  const batch = await publisher.createDrafts([{ title: 'Integration draft', slug, markdown: '# It works' }]);
  assert.equal(batch.failed.length, 0);
  created = batch.succeeded[0];
  assert.equal(created.status, 'draft');

  const updated = await publisher.updateDraft({
    id: created.id,
    updated_at: created.updated_at,
    excerpt: 'Updated through optimistic locking',
  });
  const published = await publisher.transitionPosts([{ id: updated.id, updated_at: updated.updated_at }], 'published');
  assert.equal(published.succeeded[0]?.status, 'published');
  const publishedDetails = await publisher.getPost(published.succeeded[0].id);
  const optimized = await publisher.updatePublishedPost({
    id: publishedDetails.id,
    updated_at: publishedDetails.updated_at,
    meta_title: 'Integration SEO title',
    meta_description: 'Updated published SEO metadata',
  });
  assert.equal(optimized.status, 'published');
  const optimizedDetails = await publisher.getPost(optimized.id);
  assert.equal(optimizedDetails.status, 'published');
  assert.equal(optimizedDetails.meta_title, 'Integration SEO title');
  assert.equal(optimizedDetails.meta_description, 'Updated published SEO metadata');
  assert.match(optimizedDetails.html, /It works/);
  const unpublished = await publisher.transitionPosts(
    [{ id: optimized.id, updated_at: optimized.updated_at }],
    'draft',
  );
  assert.equal(unpublished.succeeded[0]?.status, 'draft');
  console.log(`Ghost ${process.env.GHOST_IMAGE ?? ''} integration passed`);
} finally {
  if (created) await api.posts.delete({ id: created.id });
  await rm(uploadRoot, { recursive: true, force: true });
}
