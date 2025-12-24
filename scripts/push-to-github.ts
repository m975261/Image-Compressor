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

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

function getAllFiles(dir: string, baseDir: string = dir): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);
    
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'scripts') {
      continue;
    }
    
    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else {
      files.push(relativePath);
    }
  }
  
  return files;
}

async function main() {
  const accessToken = await getAccessToken();
  const octokit = new Octokit({ auth: accessToken });
  
  const owner = 'm975261';
  const repo = 'file-tools';
  const branch = 'main';
  const workspaceDir = '/home/runner/workspace';
  
  const filesToPush = getAllFiles(workspaceDir);
  console.log(`Found ${filesToPush.length} files to push`);
  
  // For empty repos, we need to use the contents API to create the first file
  // This will initialize the repo with a main branch
  console.log('Initializing repository with README...');
  
  const readmePath = path.join(workspaceDir, 'README.md');
  const readmeContent = fs.existsSync(readmePath) 
    ? fs.readFileSync(readmePath, 'utf8') 
    : '# File Tools\n\nA web application for GIF conversion and temporary file sharing.';
  
  try {
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: 'README.md',
      message: 'Initial commit',
      content: Buffer.from(readmeContent).toString('base64'),
      branch
    });
    console.log('Repository initialized with README.md');
  } catch (e: any) {
    if (e.status === 422 && e.message.includes('sha')) {
      console.log('README.md already exists, updating...');
      const { data: existingFile } = await octokit.repos.getContent({
        owner,
        repo,
        path: 'README.md'
      });
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: 'README.md',
        message: 'Update README',
        content: Buffer.from(readmeContent).toString('base64'),
        sha: (existingFile as any).sha,
        branch
      });
    } else {
      throw e;
    }
  }
  
  // Now push remaining files
  console.log('Pushing remaining files...');
  
  for (const filePath of filesToPush) {
    if (filePath === 'README.md') continue;
    
    const fullPath = path.join(workspaceDir, filePath);
    try {
      const content = fs.readFileSync(fullPath);
      
      // Check if file exists
      let existingSha: string | undefined;
      try {
        const { data: existingFile } = await octokit.repos.getContent({
          owner,
          repo,
          path: filePath
        });
        existingSha = (existingFile as any).sha;
      } catch (e) {
        // File doesn't exist, that's fine
      }
      
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: `Add ${filePath}`,
        content: content.toString('base64'),
        sha: existingSha,
        branch
      });
      console.log(`Pushed: ${filePath}`);
    } catch (e) {
      console.log(`Error pushing ${filePath}: ${e}`);
    }
  }
  
  console.log('Successfully pushed to GitHub!');
  console.log(`View at: https://github.com/${owner}/${repo}`);
}

main().catch(console.error);
