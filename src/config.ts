import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_ENV: z.enum(['production', 'staging', 'sandbox']).default('sandbox'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SUPABASE_JWT_SECRET: z.string().min(32, 'SUPABASE_JWT_SECRET must be at least 32 characters'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  VTU_PROVIDER_DEFAULT: z.enum(['mock', 'vtpass', 'clubkonnect']).default('mock'),
  VTU_MOCK_SUCCESS_RATE: z.coerce.number().min(0).max(1).default(1),
  VTU_MOCK_SIMULATE_LATENCY_MS: z.coerce.number().int().min(0).max(30000).default(50),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success && process.env.NODE_ENV !== 'test') {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

const testDefaults = {
  PORT: 3000,
  NODE_ENV: 'test' as const,
  APP_ENV: 'sandbox' as const,
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/kingxtech_vtu',
  SUPABASE_JWT_SECRET: 'test_only_secret_key_at_least_32_characters_long',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  VTU_PROVIDER_DEFAULT: 'mock' as const,
  VTU_MOCK_SUCCESS_RATE: 1,
  VTU_MOCK_SIMULATE_LATENCY_MS: 0,
};

export const config = parsed.success ? parsed.data : testDefaults;

if (config.APP_ENV === 'production' && config.VTU_PROVIDER_DEFAULT === 'mock') {
  throw new Error('Unsafe configuration: VTU_PROVIDER_DEFAULT=mock is forbidden in production.');
}
