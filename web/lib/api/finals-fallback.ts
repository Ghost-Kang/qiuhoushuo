import { isFinalsMode } from './finals-mode';

export function shouldDegradeGracefully(): boolean {
  return isFinalsMode();
}
