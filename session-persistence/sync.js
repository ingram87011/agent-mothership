#!/usr/bin/env node

/**
 * 💾 Session Persistence Sync
 * 
 * Syncs your session state to GitHub so you never lose progress.
 * Run this before your session ends to save everything.
 * Run `restore.sh` on a fresh environment to pick up where you left off.
 * 
 * Usage:
 *   node sync.js              # Save current state
 *   node sync.js --auto       # Auto-save every 5 minutes
 *   node sync.js --restore    # Restore last session
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.join(__dirname, '..', '.session');
const SESSION_FILE = path.join(SESSION_DIR, 'session.json');
const HISTORY_FILE = path.join(SESSION_DIR, 'history.log');
const BACKUP_DIR = path.join(SESSION_DIR, 'backups');
const GIT_BRANCH = 'sessions';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function log(msg) { console.log(`[sync] ${msg}`); }

function run(cmd) {
  try {
    execSync(cmd, { cwd: path.join(__dirname, '..'), stdio: 'pipe' }).toString().trim();
  } catch (e) {
    return null;
  }
}

function timestamp() {
  return new Date().toISOString();
}

// ──────────────────────────────────────────────
// Collect session state
// ──────────────────────────────────────────────
function collectState() {
  const state = {
    timestamp: timestamp(),
    hostname: require('os').hostname(),
    platform: process.platform,
    nodeVersion: process.version,
    files: {},
    env: {},
  };

  // Collect all project files (not gitignored or in node_modules)
  const projectRoot = path.join(__dirname, '..');
  
  function walkDir(dir, prefix = '') {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        
        if (entry.isDirectory()) {
          walkDir(fullPath, relPath);
        } else if (entry.isFile()) {
          try {
            state.files[relPath] = {
              size: fs.statSync(fullPath).size,
              modified: fs.statSync(fullPath).mtime.toISOString(),
              hash: simpleHash(fs.readFileSync(fullPath, 'utf8')),
            };
          } catch (e) {}
        }
      }
    } catch (e) {}
  }
  
  walkDir(projectRoot);
  
  // Collect git status
  try {
    state.gitStatus = execSync('git status --short', { cwd: projectRoot, encoding: 'utf8' });
    state.gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim();
    state.gitCommit = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim();
  } catch (e) {}
  
  return state;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

// ──────────────────────────────────────────────
// Save session
// ──────────────────────────────────────────────
function saveSession() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  
  const state = collectState();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
  
  // Append to history
  fs.appendFileSync(HISTORY_FILE, `[${state.timestamp}] Session saved — ${Object.keys(state.files).length} files tracked\n`);
  
  // Backup
  fs.writeFileSync(
    path.join(BACKUP_DIR, `session-${Date.now()}.json`),
    JSON.stringify(state, null, 2)
  );
  
  // Clean old backups (keep last 10)
  try {
    const backups = fs.readdirSync(BACKUP_DIR).sort();
    while (backups.length > 10) {
      fs.unlinkSync(path.join(BACKUP_DIR, backups.shift()));
    }
  } catch (e) {}
  
  log(`✅ Session saved — ${Object.keys(state.files).length} files, ${state.gitBranch || 'unknown'} branch`);
  
  // Push to GitHub
  pushToGitHub(state);
}

// ──────────────────────────────────────────────
// Push session to GitHub
// ──────────────────────────────────────────────
function pushToGitHub(state) {
  try {
    // Check if we have a git remote
    const remote = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' }).trim();
    if (!remote) {
      log('ℹ️  No git remote configured. Skipping GitHub push.');
      return;
    }
    
    // Only stash if there are actual uncommitted changes
    const hasChanges = execSync('git status --porcelain 2>/dev/null', { encoding: 'utf8' }).trim().length > 0;
    
    if (hasChanges) {
      execSync('git stash push --include-untracked --message "session-sync-autostash" 2>/dev/null', { encoding: 'utf8' });
    }
    
    const originalBranch = state.gitBranch || execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { encoding: 'utf8' }).trim() || 'main';
    
    // Create or checkout sessions branch
    try {
      execSync(`git checkout ${GIT_BRANCH} 2>/dev/null`, { encoding: 'utf8' });
    } catch (e) {
      execSync(`git checkout --orphan ${GIT_BRANCH} 2>/dev/null`, { encoding: 'utf8' });
      run('git rm -rf . 2>/dev/null');
    }
    
    // Copy session data
    if (fs.existsSync(SESSION_FILE)) {
      const sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      fs.writeFileSync('session-snapshot.json', JSON.stringify(sessionData, null, 2));
    }
    
    // Git operations
    execSync('git add session-snapshot.json', { encoding: 'utf8' });
    try {
      execSync(`git commit -m "💾 Session save: ${state.timestamp}"`, { encoding: 'utf8' });
    } catch (e) {
      // No changes to commit — that's fine
    }
    
    // Push
    try {
      execSync(`git push origin ${GIT_BRANCH} --force 2>/dev/null`, { encoding: 'utf8' });
      log(`📤 Session pushed to GitHub (branch: ${GIT_BRANCH})`);
    } catch (e) {
      log('⚠️  Could not push to GitHub. Check your remote configuration.');
    }
    
    // Return to original branch
    try {
      execSync(`git checkout ${originalBranch} 2>/dev/null`, { encoding: 'utf8' });
    } catch (e) {
      execSync('git checkout main 2>/dev/null || git checkout master 2>/dev/null', { encoding: 'utf8' });
    }
    
    // Only pop stash if we actually stashed something
    if (hasChanges) {
      execSync('git stash pop 2>/dev/null', { encoding: 'utf8' });
    }
    
  } catch (e) {
    log(`⚠️  GitHub push failed: ${e.message}`);
  }
}

// ──────────────────────────────────────────────
// Restore session
// ──────────────────────────────────────────────
function restoreSession() {
  log('📂 Looking for previous session...');
  
  // Try local file first
  if (fs.existsSync(SESSION_FILE)) {
    const state = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    log(`📋 Found local session from ${state.timestamp}`);
    log(`   ${Object.keys(state.files).length} files tracked`);
    log(`   Branch: ${state.gitBranch || 'unknown'}`);
    return true;
  }
  
  // Try to pull from GitHub
  try {
    execSync(`git fetch origin ${GIT_BRANCH} 2>/dev/null`, { cwd: path.join(__dirname, '..') });
    execSync(`git checkout ${GIT_BRANCH} -- session-snapshot.json 2>/dev/null`, { cwd: path.join(__dirname, '..') });
    
    if (fs.existsSync(path.join(__dirname, '..', 'session-snapshot.json'))) {
      const state = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'session-snapshot.json'), 'utf8'));
      log(`📋 Restored session from GitHub (${state.timestamp})`);
      return true;
    }
  } catch (e) {}
  
  log('ℹ️  No previous session found. Starting fresh.');
  return false;
}

// ──────────────────────────────────────────────
// Auto-save mode
// ──────────────────────────────────────────────
function autoSave() {
  log('🔄 Auto-save mode enabled (every 5 minutes)');
  log('   Press Ctrl+C to stop\n');
  
  saveSession();
  setInterval(saveSession, 5 * 60 * 1000);
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--restore')) {
    restoreSession();
  } else if (args.includes('--auto')) {
    autoSave();
  } else {
    saveSession();
  }
}

module.exports = { saveSession, restoreSession, collectState };
