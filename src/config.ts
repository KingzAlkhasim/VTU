import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000').transform((v) => parseInt(v, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_ENV: z.enum(['production', 'staging', 'sandbox']).default('sandbox'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SUPABASE_JWT_SECRET: z.string().min(16, 'SUPABASE_JWT_SECRET must be at least 16 chars'),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  VTU_PROVIDER_DEFAULT: z.string().default('mock'),
  VTU_MOCK_SUCCESS_RATE: z.string().default('1.0').transform((v) => parseFloat(v)),
  VTU_MOCK_SIMULATE_LATENCY_MS: z.string().default('50').transform((v) => parseInt(v, 10)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('CRITICAL: Environment validation failed:');
  console.error(parsed.error.format());
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
}

export const config = parsed.success
  ? parsed.data
  : {
      PORT: 3000,
      NODE_ENV: 'test' as const,
      APP_ENV: 'sandbox' as const,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/kingxtech_vtu',
      SUPABASE_JWT_SECRET: 'test_super_secret_jwt_key_at_least_32_characters_long',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      VTU_PROVIDER_DEFAULT: 'mock',
      VTU_MOCK_SUCCESS_RATE: 1.0,
      VTU_MOCK_SIMULATE_LATENCY_MS: 0,
    };
