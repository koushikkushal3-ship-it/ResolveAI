import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { forbidden } from '../utils/httpError.js';
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
} from '../validators/auth.js';
import {
  registerUser,
  loginUser,
  updateProfile,
  changePassword,
  isFirstUser,
} from '../services/auth.js';

export const authRouter = Router();

/**
 * POST /api/auth/register
 *
 * Open only for the very first account, which is bootstrapped as ADMIN.
 * After that it requires an authenticated ADMIN — an internal support console
 * must not let the public mint itself agent accounts.
 */
authRouter.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const first = await isFirstUser();

    if (first) {
      const result = await registerUser({ ...req.body, role: 'ADMIN' });
      return res.status(201).json({ data: result });
    }

    // Not the first user: authenticate and require ADMIN before proceeding.
    await new Promise((resolve, reject) =>
      authenticate(req, res, (err) => (err ? reject(err) : resolve()))
    );
    if (req.user?.role !== 'ADMIN') {
      throw forbidden('Only an administrator can create new accounts');
    }

    const result = await registerUser(req.body);
    res.status(201).json({ data: result });
  })
);

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    res.json({ data: await loginUser(req.body) });
  })
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({
      data: {
        id: req.user.id,
        email: req.user.email,
        fullName: req.user.full_name,
        role: req.user.role,
      },
    });
  })
);

authRouter.patch(
  '/me',
  authenticate,
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req, res) => {
    res.json({ data: await updateProfile(req.user.id, req.body) });
  })
);

authRouter.post(
  '/change-password',
  authenticate,
  authLimiter,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    res.json({ data: await changePassword(req.user.id, req.body) });
  })
);

/** Admin-only: list agents, for the settings screen. */
authRouter.get(
  '/users',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { supabase, unwrap } = await import('../config/supabase.js');
    const rows = unwrap(
      await supabase
        .from('app_users')
        .select('id, email, full_name, role, is_active, created_at')
        .order('created_at', { ascending: true }),
      'list users'
    );
    res.json({ data: rows });
  })
);
