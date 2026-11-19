import { onUserDeactivated } from '../services/lifecycle';
import express, { Request, Response } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { User, UserRole, canUseConnector } from '../models/User';
import { revokeUserTokens } from '../oauth/oauthService';
import { isAuthenticated } from '../middleware/auth';
import { canManageUsers } from '../middleware/rbac';
import { validateUserCreation, validateUserUpdate, validateMongoId } from '../middleware/validation';
import { logUserCreated, logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import { AppConfig } from '../models/AppConfig';
import { DEFAULT_ALLOWANCE, aiUsage } from '../services/aiAllowance';
import { uploadToS3, deleteFromS3 } from '../utils/s3Service';

const router = express.Router();

// Configure multer for logo uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit for logos
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for logos'));
    }
  }
});

/**
 * @route   POST /api/users
 * @desc    Create a new user (System Admin only)
 * @access  Private (System Admin)
 */
router.post('/', isAuthenticated, canManageUsers, validateUserCreation, async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, role, accessMode, mcpEnabled, assistantEnabled, libraryEnabled, publishingEnabled } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Create user
    const user = await User.create({
      email,
      password,
      firstName,
      lastName,
      role,
      ...(accessMode ? { accessMode } : {}),
      ...(typeof mcpEnabled === 'boolean' ? { mcpEnabled } : {}),
      ...(typeof assistantEnabled === 'boolean' ? { assistantEnabled } : {}),
      ...(typeof libraryEnabled === 'boolean' ? { libraryEnabled } : {}),
      ...(typeof publishingEnabled === 'boolean' ? { publishingEnabled } : {})
    });

    // Log user creation
    await logUserCreated(req.user!._id, user._id, { email, role, accessMode: user.accessMode, mcpEnabled: user.mcpEnabled }, req);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        accessMode: user.accessMode,
        mcpEnabled: user.mcpEnabled,
        assistantEnabled: user.assistantEnabled,
        libraryEnabled: user.libraryEnabled,
        publishingEnabled: user.publishingEnabled,
        tags: user.tags || [],
        isActive: user.isActive
      }
    });
  } catch (error: any) {
    console.error('Error creating user:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating user',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/users
 * @desc    Get all users (System Admin only) with pagination
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    // Only System Admins can list all users
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Only System Administrators can list users'
      });
    }

    // Pagination parameters
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit as string) || 10));
    const skip = (page - 1) * limit;
    // Deactivated accounts are listed only when asked for (Admin › Users shows them).
    const filter = req.query.includeInactive === 'true' ? {} : { isActive: true };

    // Get total count for pagination metadata
    const total = await User.countDocuments(filter);

    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      users,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users'
    });
  }
});

/**
 * @route   GET /api/users/:id
 * @desc    Get user by ID with detailed information
 * @access  Private (System Admin only)
 */
router.get('/:id', isAuthenticated, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    // Only System Admins can view user details
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Only System Administrators can view user details'
      });
    }

    const user = await User.findById(req.params.id)
      .select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get campaign count for this user
    const { Campaign } = await import('../models/Campaign');
    const campaignCount = await Campaign.countDocuments({ createdBy: user._id });

    // Prepare user data with additional info
    const userData = {
      ...user.toObject(),
      campaignCount,
      loginMethod: user.authProvider === 'google' ? 'Google OAuth' : 'Email/Password',
      hasCanvaIntegration: user.integrations?.canva?.connected || false
    };

    res.json({
      success: true,
      user: userData
    });
  } catch (error: any) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user'
    });
  }
});

/**
 * @route   PUT /api/users/:id
 * @desc    Update user (System Admin only)
 * @access  Private (System Admin)
 */
router.put('/:id', isAuthenticated, canManageUsers, validateMongoId('id'), validateUserUpdate, async (req: Request, res: Response) => {
  try {
    const { email, firstName, lastName, role, isActive, accessMode, mcpEnabled, assistantEnabled, libraryEnabled, publishingEnabled, tags } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const oldData = { ...user.toObject() };

    // Update fields
    if (email) user.email = email;
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (role) user.role = role;
    if (accessMode) user.accessMode = accessMode;
    if (typeof mcpEnabled === 'boolean') user.mcpEnabled = mcpEnabled;
    if (typeof assistantEnabled === 'boolean') user.assistantEnabled = assistantEnabled;
    if (typeof libraryEnabled === 'boolean') user.libraryEnabled = libraryEnabled;
    if (typeof publishingEnabled === 'boolean') user.publishingEnabled = publishingEnabled;
    if (Array.isArray(tags)) {
      // Labels for targeting Inbox messages: lower-case, unique, short.
      user.tags = [...new Set(tags.filter((t: unknown) => typeof t === 'string').map((t: string) => t.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 30) as string[];
    }
    // Monthly AI allowance for this account: a whole number (0 = no limit), or null for the default.
    if (req.body.aiAllowance && typeof req.body.aiAllowance === 'object') {
      const next = { images: user.aiAllowance?.images ?? null, designs: user.aiAllowance?.designs ?? null, blueMessages: user.aiAllowance?.blueMessages ?? null };
      for (const key of ['images', 'designs', 'blueMessages'] as const) {
        if (!(key in req.body.aiAllowance)) continue;
        const v = req.body.aiAllowance[key];
        if (v === null || v === '') next[key] = null;
        else if (Number.isInteger(v) && v >= 0 && v <= 100000) next[key] = v;
        else return res.status(400).json({ success: false, message: `${key === 'images' ? 'AI images' : key === 'designs' ? 'Designed posters' : 'Blue messages'} must be a whole number (0 = no limit)` });
      }
      user.aiAllowance = next;
      user.markModified('aiAllowance');
    }
    const deactivating = isActive === false && user.isActive !== false;
    if (typeof isActive === 'boolean') user.isActive = isActive;

    // Email must stay unique (a duplicate would otherwise surface as a generic 500).
    if (email && user.isModified('email')) {
      const taken = await User.findOne({ email: user.email, _id: { $ne: user._id } }).select('_id');
      if (taken) {
        return res.status(400).json({ success: false, message: 'Another user already uses this email' });
      }
    }

    await user.save();

    // Turning the connector off (or deactivating the account) disconnects Claude immediately.
    if (!canUseConnector(user)) {
      await revokeUserTokens(user._id as mongoose.Types.ObjectId);
    }
    if (deactivating) {
      await onUserDeactivated(user._id as mongoose.Types.ObjectId, req.user!._id as mongoose.Types.ObjectId);
    }

    // Log update
    await logAudit({
      action: AuditAction.USER_UPDATED,
      userId: req.user!._id,
      targetType: 'User',
      targetId: user._id,
      changes: { old: oldData, new: user.toObject() },
      req
    });

    res.json({
      success: true,
      message: 'User updated successfully',
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        accessMode: user.accessMode,
        mcpEnabled: user.mcpEnabled,
        assistantEnabled: user.assistantEnabled,
        libraryEnabled: user.libraryEnabled,
        publishingEnabled: user.publishingEnabled,
        tags: user.tags || [],
        isActive: user.isActive
      }
    });
  } catch (error: any) {
    console.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user'
    });
  }
});

/**
 * @route   PATCH /api/users/me
 * @desc    Change your own name. Body: { firstName?, lastName? }
 * @access  Private
 */
router.patch('/me', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.user!._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const clean = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 80) : undefined);
    const firstName = clean(req.body?.firstName);
    const lastName = clean(req.body?.lastName);
    if (firstName === '' || lastName === '') return res.status(400).json({ success: false, message: 'First and last name can’t be empty.' });
    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    await user.save();
    await logAudit({ action: AuditAction.USER_UPDATED, userId: req.user!._id, targetType: 'User', targetId: user._id, metadata: { self: true, fields: ['firstName', 'lastName'] }, req });
    res.json({ success: true, message: 'Saved', user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email } });
  } catch (error: any) {
    console.error('Error updating own profile:', error);
    res.status(500).json({ success: false, message: 'Couldn’t save your name.' });
  }
});

/**
 * @route   POST /api/users/me/password
 * @desc    Change your own password. Body: { currentPassword, newPassword }. Google sign-in accounts
 *          without a password can set one (no current password needed).
 * @access  Private
 */
router.post('/me/password', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.user!._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const current = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const next = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    if (next.length < 8) return res.status(400).json({ success: false, message: 'Use at least 8 characters for the new password.' });
    if (next.length > 200) return res.status(400).json({ success: false, message: 'That password is too long.' });
    if (user.password) {
      if (!current || !(await user.comparePassword(current))) {
        return res.status(400).json({ success: false, message: 'Your current password isn’t right.' });
      }
      if (await user.comparePassword(next)) return res.status(400).json({ success: false, message: 'Choose a password different from the current one.' });
    }
    user.password = next;
    await user.save();
    await logAudit({ action: AuditAction.USER_UPDATED, userId: req.user!._id, targetType: 'User', targetId: user._id, metadata: { self: true, passwordChanged: true }, req });
    res.json({ success: true, message: 'Password changed' });
  } catch (error: any) {
    console.error('Error changing password:', error);
    res.status(500).json({ success: false, message: 'Couldn’t change your password.' });
  }
});

/**
 * @route   GET /api/users/me/ai-usage
 * @desc    This month's AI images and Blue messages, and the allowance.
 * @access  Private
 */
router.get('/me/ai-usage', isAuthenticated, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, usage: await aiUsage(req.user!) });
  } catch (error) {
    console.error('Error loading AI usage:', error);
    res.status(500).json({ success: false, message: 'Couldn’t load your AI use.' });
  }
});

/**
 * @route   GET /api/users/settings/ai-allowance
 * @desc    The workspace's monthly AI allowance per account (System Admin).
 * @route   PATCH /api/users/settings/ai-allowance  Body: { aiImagesPerMonth?, aiDesignsPerMonth?, blueMessagesPerMonth? } (0 = no limit)
 */
router.get('/settings/ai-allowance', isAuthenticated, canManageUsers, async (_req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();
    res.json({ success: true, aiImagesPerMonth: config.aiImagesPerMonth ?? DEFAULT_ALLOWANCE.images, aiDesignsPerMonth: config.aiDesignsPerMonth ?? DEFAULT_ALLOWANCE.designs, blueMessagesPerMonth: config.blueMessagesPerMonth ?? DEFAULT_ALLOWANCE.blueMessages });
  } catch (error) {
    console.error('Error loading AI allowance:', error);
    res.status(500).json({ success: false, message: 'Couldn’t load the AI allowance.' });
  }
});

router.patch('/settings/ai-allowance', isAuthenticated, canManageUsers, async (req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();
    for (const key of ['aiImagesPerMonth', 'aiDesignsPerMonth', 'blueMessagesPerMonth'] as const) {
      if (req.body?.[key] === undefined) continue;
      const v = req.body[key];
      if (!Number.isInteger(v) || v < 0 || v > 100000) return res.status(400).json({ success: false, message: 'Use a whole number (0 = no limit).' });
      config[key] = v;
    }
    await config.save();
    await logAudit({ action: AuditAction.USER_UPDATED, userId: req.user!._id, targetType: 'AppConfig', targetId: config._id as any, metadata: { aiAllowance: { images: config.aiImagesPerMonth, designs: config.aiDesignsPerMonth, blueMessages: config.blueMessagesPerMonth } }, req });
    res.json({ success: true, aiImagesPerMonth: config.aiImagesPerMonth, aiDesignsPerMonth: config.aiDesignsPerMonth, blueMessagesPerMonth: config.blueMessagesPerMonth });
  } catch (error) {
    console.error('Error saving AI allowance:', error);
    res.status(500).json({ success: false, message: 'Couldn’t save the AI allowance.' });
  }
});

/**
 * @route   GET /api/users/:id/ai-usage
 * @desc    An account's AI use this month (System Admin).
 */
router.get('/:id/ai-usage', isAuthenticated, canManageUsers, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.params.id).select('role aiAllowance');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, usage: await aiUsage(user), aiAllowance: { images: user.aiAllowance?.images ?? null, designs: user.aiAllowance?.designs ?? null, blueMessages: user.aiAllowance?.blueMessages ?? null } });
  } catch (error) {
    console.error('Error loading AI usage:', error);
    res.status(500).json({ success: false, message: 'Couldn’t load AI use.' });
  }
});

/**
 * @route   GET /api/users/me/company-info
 * @desc    Get company information for current user
 * @access  Private
 */
router.get('/me/company-info', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.user!._id).select('companyInfo');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      companyInfo: user.companyInfo || {}
    });
  } catch (error: any) {
    console.error('Error fetching company info:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching company information'
    });
  }
});

/**
 * @route   PATCH /api/users/me/company-info
 * @desc    Update company information for current user
 * @access  Private (Hybrid Users)
 */
router.patch('/me/company-info', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const {
      companyName,
      sector,
      about,
      productsServices,
      usp,
      brandTone,
      audienceProfile,
      globalRules,
      brandGuidelines,
      primaryLogoUrl,
      secondaryLogoUrl,
      tertiaryLogoUrl
    } = req.body;

    const user = await User.findById(req.user!._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update company info (only for Hybrid users, but we'll allow it for all authenticated users)
    user.companyInfo = {
      companyName: companyName !== undefined ? companyName : user.companyInfo?.companyName,
      sector: sector !== undefined ? sector : user.companyInfo?.sector,
      about: about !== undefined ? about : user.companyInfo?.about,
      productsServices: productsServices !== undefined ? productsServices : user.companyInfo?.productsServices,
      usp: usp !== undefined ? usp : user.companyInfo?.usp,
      brandTone: brandTone !== undefined ? brandTone : user.companyInfo?.brandTone,
      audienceProfile: audienceProfile !== undefined ? audienceProfile : user.companyInfo?.audienceProfile,
      globalRules: globalRules !== undefined ? globalRules : user.companyInfo?.globalRules,
      brandGuidelines: brandGuidelines !== undefined ? brandGuidelines : user.companyInfo?.brandGuidelines,
      primaryLogoUrl: primaryLogoUrl !== undefined ? primaryLogoUrl : user.companyInfo?.primaryLogoUrl,
      secondaryLogoUrl: secondaryLogoUrl !== undefined ? secondaryLogoUrl : user.companyInfo?.secondaryLogoUrl,
      tertiaryLogoUrl: tertiaryLogoUrl !== undefined ? tertiaryLogoUrl : user.companyInfo?.tertiaryLogoUrl
    };

    await user.save();

    // Log update
    await logAudit({
      action: AuditAction.USER_UPDATED,
      userId: req.user!._id,
      targetType: 'User',
      targetId: user._id,
      metadata: { companyInfoUpdated: true },
      req
    });

    res.json({
      success: true,
      message: 'Company information updated successfully',
      companyInfo: user.companyInfo
    });
  } catch (error: any) {
    console.error('Error updating company info:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating company information'
    });
  }
});

/**
 * @route   POST /api/users/me/upload-logo
 * @desc    Upload company logo (primary, secondary, or tertiary)
 * @access  Private
 */
router.post('/me/upload-logo', isAuthenticated, upload.single('logo'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No logo file uploaded'
      });
    }

    const { logoType } = req.body;

    // Validate logoType
    const validTypes = ['primary', 'secondary', 'tertiary'];
    if (!logoType || !validTypes.includes(logoType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid logo type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    const user = await User.findById(req.user!._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Delete old logo from S3 if it exists
    const logoUrlField = `${logoType}LogoUrl` as 'primaryLogoUrl' | 'secondaryLogoUrl' | 'tertiaryLogoUrl';
    const oldLogoUrl = user.companyInfo?.[logoUrlField];
    if (oldLogoUrl) {
      try {
        // Extract key from URL (format: https://bucket.s3.region.amazonaws.com/folder/file.ext)
        // Only files this route stored itself: the main logo address may point at the brand kit's files.
        const urlParts = oldLogoUrl.split('.amazonaws.com/');
        if (urlParts.length === 2 && urlParts[1].startsWith('company-logos/')) {
          const key = urlParts[1];
          await deleteFromS3(key);
        }
      } catch (error) {
        console.error('Error deleting old logo from S3:', error);
        // Continue with upload even if deletion fails
      }
    }

    // Upload new logo to S3
    const { location } = await uploadToS3(req.file, 'company-logos');

    // Update user's company info
    if (!user.companyInfo) {
      user.companyInfo = {};
    }
    user.companyInfo[logoUrlField] = location;

    await user.save();

    // The main logo is also the brand kit's: prepare it there too (one brand, one logo).
    if (logoType === 'primary') {
      try {
        const { BrandKitModel } = await import('../models/BrandKit');
        const kit = await BrandKitModel.findOne({ ownerId: user._id });
        if (kit) {
          const { storeLogoFiles, syncCompanyLogo } = await import('../services/designBrand');
          const variants = await storeLogoFiles(req.file.buffer, location);
          const old = kit.logos.find((l) => l.role === 'primary');
          kit.logos = [{ id: old?.id || String(Date.now()), name: old?.name || 'Main logo', role: 'primary', variants, clearSpace: old?.clearSpace ?? 0.25, minHeight: old?.minHeight ?? 0.05 } as any, ...kit.logos.filter((l) => l.role !== 'primary')];
          kit.markModified('logos');
          await kit.save();
          await syncCompanyLogo(kit);
        }
      } catch (error) {
        console.error('[brand] Couldn’t add the logo to the brand kit:', error);
      }
    }

    // Log upload
    await logAudit({
      action: AuditAction.USER_UPDATED,
      userId: req.user!._id,
      targetType: 'User',
      targetId: user._id,
      metadata: { logoType, logoUrl: location },
      req
    });

    res.json({
      success: true,
      message: `${logoType.charAt(0).toUpperCase() + logoType.slice(1)} logo uploaded successfully`,
      logoUrl: location,
      logoType
    });
  } catch (error: any) {
    console.error('Error uploading logo:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error uploading logo'
    });
  }
});

/**
 * @route   DELETE /api/users/:id
 * @desc    Delete user (System Admin only)
 * @access  Private (System Admin)
 */
router.delete('/:id', isAuthenticated, canManageUsers, validateMongoId('id'), async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (String(user._id) === String(req.user!._id)) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account' });
    }

    // Soft delete by setting isActive to false
    user.isActive = false;
    await user.save();
    await revokeUserTokens(user._id as mongoose.Types.ObjectId);
    await onUserDeactivated(user._id as mongoose.Types.ObjectId, req.user!._id as mongoose.Types.ObjectId);

    // Log deletion
    await logAudit({
      action: AuditAction.USER_DELETED,
      userId: req.user!._id,
      targetType: 'User',
      targetId: user._id,
      req
    });

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting user'
    });
  }
});

export default router;
