import { execSync } from 'node:child_process';

try {
  execSync('docker info', { stdio: 'pipe' });
  console.log('Docker daemon: ok');
} catch {
  console.error(
    'Docker daemon not reachable. Start Docker Desktop and retry `pnpm dev`.',
  );
  process.exit(1);
}
