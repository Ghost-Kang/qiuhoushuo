/** POST /api/admin/xhs-note — 手动生成某场「小红书」内容(运营/回填)。详见 makeSocialNoteHandler。 */
import { makeSocialNoteHandler } from '@/lib/api/social-note-route';

export const maxDuration = 60;
export const POST = makeSocialNoteHandler('xhs');
