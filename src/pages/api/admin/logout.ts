import type { APIRoute } from 'astro';
import { clearSession } from '../../../lib/auth';

export const prerender = false;
export const POST: APIRoute = ({ cookies, redirect }) => { clearSession(cookies); return redirect('/admin/login?out=1', 303); };
