import { z } from 'zod';

/**
 * Password policy.
 *
 * A length floor with a maximum, not a character-class maze. Length is what
 * actually resists guessing, and the 72-byte cap is bcrypt's own limit —
 * without it, everything past byte 72 is silently ignored, which would make
 * two different long passwords interchangeable.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(255)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  role: z.enum(['AGENT', 'SUPERVISOR', 'ADMIN']).default('AGENT'),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(72),
});

export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    email: emailSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(72),
  newPassword: passwordSchema,
});
