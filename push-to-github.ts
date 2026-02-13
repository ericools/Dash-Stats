import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import * as path from 'path';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;
  if (!xReplitToken) throw new Error('X_REPLIT_TOKEN not found');
  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    { headers: { 'Accept': 'application/json', 'X_REPLIT_TOKEN': xReplitToken } }
  ).then(res => res.json()).then(data => data.items?.[0]);
  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;
  if (!connectionSettings || !accessToken) throw new Error('GitHub not connected');
  return accessToken;
}

async function getAllFiles(dir: string, base: string): Promise<{path: string, content: string}[]> {
  const results: {path: string, content: string}[] = [];
  const skipDirs = new Set(['node_modules', '.git', 'dist', '.cache', '.config', '.local', '.upm']);
  const skipFiles = new Set(['.replit', 'replit.nix', '.replit.nix']);
  
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(base, fullPath);
    
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name) || entry.name.startsWith('.')) continue;
      results.push(...await getAllFiles(fullPath, base));
    } else {
      if (skipFiles.has(entry.name)) continue;
      if (entry.name.endsWith('.log')) continue;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > 5 * 1024 * 1024) continue; // skip files > 5MB
        
        // Check if binary
        const buf = Buffer.alloc(512);
        const fd = fs.openSync(fullPath, 'r');
        const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
        fs.closeSync(fd);
        const isBinary = buf.slice(0, bytesRead).includes(0);
        
        if (isBinary) {
          const content = fs.readFileSync(fullPath).toString('base64');
          results.push({ path: relPath, content: content + '::BASE64' });
        } else {
          results.push({ path: relPath, content: fs.readFileSync(fullPath, 'utf-8') });
        }
      } catch (e) {
        // skip unreadable files
      }
    }
  }
  return results;
}

async function main() {
  const owner = 'ericools';
  const repo = 'Dash-Stats';
  const branch = 'main';
  
  const accessToken = await getAccessToken();
  const octokit = new Octokit({ auth: accessToken });
  
  console.log('Collecting files...');
  const files = await getAllFiles('/home/runner/workspace', '/home/runner/workspace');
  console.log(`Found ${files.length} files`);
  
  let repoEmpty = false;
  let baseSha: string = '';
  try {
    const { data: ref } = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
    baseSha = ref.object.sha;
    console.log(`Existing branch ${branch} at ${baseSha}`);
  } catch (e: any) {
    if (e.status === 404 || e.status === 409) {
      console.log('Repository is empty, initializing...');
      repoEmpty = true;
    } else {
      throw e;
    }
  }

  if (repoEmpty) {
    await octokit.repos.createOrUpdateFileContents({
      owner, repo,
      path: '.gitkeep',
      message: 'Initialize repository',
      content: Buffer.from('').toString('base64'),
    });
    console.log('Created initial commit');
    const { data: ref } = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
    baseSha = ref.object.sha;
  }

  console.log('Creating blobs...');
  const treeItems: any[] = [];
  let count = 0;
  
  for (const file of files) {
    const isBinary = file.content.endsWith('::BASE64');
    const content = isBinary ? file.content.replace('::BASE64', '') : file.content;
    const encoding = isBinary ? 'base64' : 'utf-8';
    
    const { data: blob } = await octokit.git.createBlob({
      owner, repo,
      content,
      encoding,
    });
    
    treeItems.push({
      path: file.path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: blob.sha,
    });
    count++;
    if (count % 20 === 0) console.log(`  ${count}/${files.length} blobs created...`);
  }
  
  console.log(`Created ${treeItems.length} blobs`);
  
  const { data: baseCommit } = await octokit.git.getCommit({ owner, repo, commit_sha: baseSha });
  const { data: tree } = await octokit.git.createTree({
    owner, repo,
    tree: treeItems,
    base_tree: baseCommit.tree.sha,
  });
  console.log(`Created tree: ${tree.sha}`);
  
  const { data: commit } = await octokit.git.createCommit({
    owner, repo,
    message: 'Dash Stats Dashboard - sync from Replit',
    tree: tree.sha,
    parents: [baseSha],
  });
  console.log(`Created commit: ${commit.sha}`);
  
  await octokit.git.updateRef({
    owner, repo,
    ref: `heads/${branch}`,
    sha: commit.sha,
    force: true,
  });
  console.log(`Updated ${branch} to ${commit.sha}`);
  
  console.log('Done! Code pushed to https://github.com/ericools/Dash-Stats');
}

main().catch(e => { console.error(e); process.exit(1); });
