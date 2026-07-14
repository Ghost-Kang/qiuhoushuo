/** POST /api/admin/channels-note — 手动生成某场「视频号」短视频脚本(运营/回填)。详见 makeSocialNoteHandler。 */
import { makeSocialNoteHandler } from '@/lib/api/social-note-route';

export const maxDuration = 60;
export const POST = makeSocialNoteHandler('channels');
