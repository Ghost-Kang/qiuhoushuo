import { describe, expect, it, vi } from 'vitest';
import { assertLLMConfiguredForBoot } from '@/lib/api/llm-boot';

describe('assertLLMConfiguredForBoot', () => {
  it('does not throw in development when LLM env is missing', () => {
    expect(() => assertLLMConfiguredForBoot({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('does not throw in test when LLM env is missing', () => {
    expect(() => assertLLMConfiguredForBoot({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('passes in production when primary and backup provider keys are configured', () => {
    expect(() => assertLLMConfiguredForBoot({
      NODE_ENV: 'production',
      LLM_PROVIDER: 'doubao',
      DOUBAO_API_KEY: 'doubao-key',
      DOUBAO_BASE_URL: 'https://ark.example/api/v3',
      DEEPSEEK_API_KEY: 'deepseek-key',
    } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('throws when DOUBAO_API_KEY is missing in production', () => {
    expect(() => assertLLMConfiguredForBoot({
      NODE_ENV: 'production',
      DOUBAO_BASE_URL: 'https://ark.example/api/v3',
      DEEPSEEK_API_KEY: 'deepseek-key',
    } as NodeJS.ProcessEnv)).toThrow('DOUBAO_API_KEY');
  });

  it('throws when DEEPSEEK_API_KEY is missing in production', () => {
    expect(() => assertLLMConfiguredForBoot({
      NODE_ENV: 'production',
      DOUBAO_API_KEY: 'doubao-key',
      DOUBAO_BASE_URL: 'https://ark.example/api/v3',
    } as NodeJS.ProcessEnv)).toThrow('DEEPSEEK_API_KEY');
  });

  it('throws when DOUBAO_BASE_URL is missing in production', () => {
    expect(() => assertLLMConfiguredForBoot({
      NODE_ENV: 'production',
      DOUBAO_API_KEY: 'doubao-key',
      DEEPSEEK_API_KEY: 'deepseek-key',
    } as NodeJS.ProcessEnv)).toThrow('DOUBAO_BASE_URL');
  });

  it('lists all missing LLM keys without leaking configured values', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => assertLLMConfiguredForBoot({
      NODE_ENV: 'production',
      LLM_PROVIDER: 'deepseek',
      DOUBAO_API_KEY: 'doubao-secret',
    } as NodeJS.ProcessEnv)).toThrow();
    const output = spy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('DOUBAO_BASE_URL');
    expect(output).toContain('DEEPSEEK_API_KEY');
    expect(output).toContain('"LLM_PROVIDER":"deepseek"');
    expect(output).not.toContain('doubao-secret');
    spy.mockRestore();
  });
});
