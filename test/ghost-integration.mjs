/* global console, fetch, process, setTimeout */
import assert from 'node:assert/strict';
import GhostAdminAPI from '@tryghost/admin-api';
import { GhostPublisher } from '../dist/publisher.js';

const ghostUrl = process.env.GHOST_INTEGRATION_URL ?? 'http://localhost:2368';
const email = 'owner@example.com';
const password = 'correct horse battery staple 2026';

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
  uploadRoots: [],
};
const publisher = new GhostPublisher(config);
const api = new GhostAdminAPI({ url: ghostUrl, key: adminKey, version: 'v5.0' });
let created;

try {
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
  const unpublished = await publisher.transitionPosts(
    [{ id: published.succeeded[0].id, updated_at: published.succeeded[0].updated_at }],
    'draft',
  );
  assert.equal(unpublished.succeeded[0]?.status, 'draft');
  console.log(`Ghost ${process.env.GHOST_IMAGE ?? ''} integration passed`);
} finally {
  if (created) await api.posts.delete({ id: created.id });
}
