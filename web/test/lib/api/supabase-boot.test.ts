import { describe, expect, it, vi } from 'vitest';
import { assertSupabaseConfiguredForBoot } from '@/lib/api/supabase-boot';

describe('assertSupabaseConfiguredForBoot', () => {
  it('does not throw outside production when Supabase env is missing', () => {
    expect(() => assertSupabaseConfiguredForBoot({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => assertSupabaseConfiguredForBoot({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('passes in production when URL, anon key, and service role key are configured', () => {
    expect(() => assertSupabaseConfiguredForBoot({
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_KEY: 'service-role',
    } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('throws when SUPABASE_URL is missing in production', () => {
    expect(() => assertSupabaseConfiguredForBoot({
      NODE_ENV: 'production',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_KEY: 'service-role',
    } as NodeJS.ProcessEnv)).toThrow('SUPABASE_URL');
  });

  it('throws when SUPABASE_ANON_KEY is missing in production', () => {
    expect(() => assertSupabaseConfiguredForBoot({
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'service-role',
    } as NodeJS.ProcessEnv)).toThrow('SUPABASE_ANON_KEY');
  });

  it('throws when SUPABASE_SERVICE_KEY is missing in production', () => {
    expect(() => assertSupabaseConfiguredForBoot({
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
    } as NodeJS.ProcessEnv)).toThrow('SUPABASE_SERVICE_KEY');
  });

  it('lists missing names without leaking configured values', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => assertSupabaseConfiguredForBoot({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow();
    const output = spy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('SUPABASE_URL');
    expect(output).toContain('SUPABASE_ANON_KEY');
    expect(output).toContain('SUPABASE_SERVICE_KEY');
    expect(output).not.toContain('service-role');
    spy.mockRestore();
  });
});
