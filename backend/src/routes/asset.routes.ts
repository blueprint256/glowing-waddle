import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Asset, AssetType } from '../models/Asset';
import { Event } from '../models/Event';
import { Project } from '../models/Project';
import { Campaign } from '../models/Campaign';
import { UserRole } from '../models/User';
import { isAuthenticated } from '../middleware/auth';
import { canEditContent } from '../middleware/rbac';
import { logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import mongoose from 'mongoose';

const router = express.Router();

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';

    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Accept images, videos, and documents
  const allowedMimes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images, videos, and documents are allowed.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760') // 10MB default
  }
});

/**
 * Determine asset type from mimetype
 */
const getAssetType = (mimetype: string): AssetType => {
  if (mimetype.startsWith('image/')) return AssetType.IMAGE;
  if (mimetype.startsWith('video/')) return AssetType.VIDEO;
  if (mimetype.includes('pdf') || mimetype.includes('document') || mimetype.includes('sheet')) {
    return AssetType.DOCUMENT;
  }
  return AssetType.OTHER;
};

/**
 * @route   POST /api/assets
 * @desc    Upload asset
 * @access  Private (not Client by default)
 */
router.post('/', isAuthenticated, canEditContent, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { eventId, projectId, campaignId } = req.body;

    // At least one association is required
    if (!eventId && !projectId && !campaignId) {
      // Delete uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Asset must be associated with an event, project, or campaign'
      });
    }

    // Verify access to associated entity
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) {
      if (!req.user!.teamId) {
        fs.unlinkSync(req.file.path);
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      if (eventId) {
        const event = await Event.findById(eventId);
        if (!event || event.teamId.toString() !== req.user!.teamId.toString()) {
          fs.unlinkSync(req.file.path);
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
      } else if (projectId) {
        const project = await Project.findById(projectId);
        if (!project || project.teamId.toString() !== req.user!.teamId.toString()) {
          fs.unlinkSync(req.file.path);
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
      } else if (campaignId) {
        const campaign = await Campaign.findById(campaignId);
        if (!campaign || campaign.teamId.toString() !== req.user!.teamId.toString()) {
          fs.unlinkSync(req.file.path);
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
      }
    }

    // Create asset record
    const asset = await Asset.create({
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      type: getAssetType(req.file.mimetype),
      path: req.file.path,
      eventId: eventId ? new mongoose.Types.ObjectId(eventId) : undefined,
      projectId: projectId ? new mongoose.Types.ObjectId(projectId) : undefined,
      campaignId: campaignId ? new mongoose.Types.ObjectId(campaignId) : undefined,
      uploadedBy: req.user!._id,
      version: 1
    });

    // Log asset upload
    await logAudit({
      action: AuditAction.ASSET_UPLOADED,
      userId: req.user!._id,
      targetType: 'Asset',
      targetId: asset._id,
      metadata: { filename: req.file.originalname, size: req.file.size },
      req
    });

    const populatedAsset = await Asset.findById(asset._id)
      .populate('uploadedBy', 'firstName lastName email');

    res.status(201).json({
      success: true,
      message: 'Asset uploaded successfully',
      asset: populatedAsset
    });
  } catch (error: any) {
    // Delete file if database operation fails
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error('Error uploading asset:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error uploading asset'
    });
  }
});

/**
 * @route   GET /api/assets
 * @desc    Get assets (filtered by event/project/campaign)
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    let query: any = {};

    if (req.query.eventId) {
      query.eventId = req.query.eventId;
    } else if (req.query.projectId) {
      query.projectId = req.query.projectId;
    } else if (req.query.campaignId) {
      query.campaignId = req.query.campaignId;
    }

    const assets = await Asset.find(query)
      .populate('uploadedBy', 'firstName lastName email')
      .populate('previousVersionId', 'version filename')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      assets
    });
  } catch (error: any) {
    console.error('Error fetching assets:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching assets'
    });
  }
});

/**
 * @route   GET /api/assets/:id
 * @desc    Get asset by ID
 * @access  Private
 */
router.get('/:id', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const asset = await Asset.findById(req.params.id)
      .populate('uploadedBy', 'firstName lastName email');

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    res.json({
      success: true,
      asset
    });
  } catch (error: any) {
    console.error('Error fetching asset:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching asset'
    });
  }
});

/**
 * @route   GET /api/assets/:id/download
 * @desc    Download asset file
 * @access  Private
 */
router.get('/:id/download', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const asset = await Asset.findById(req.params.id);

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Check if file exists
    if (!fs.existsSync(asset.path)) {
      return res.status(404).json({
        success: false,
        message: 'File not found on server'
      });
    }

    res.download(asset.path, asset.originalName);
  } catch (error: any) {
    console.error('Error downloading asset:', error);
    res.status(500).json({
      success: false,
      message: 'Error downloading asset'
    });
  }
});

/**
 * @route   DELETE /api/assets/:id
 * @desc    Delete asset
 * @access  Private (not Client)
 */
router.delete('/:id', isAuthenticated, canEditContent, async (req: Request, res: Response) => {
  try {
    const asset = await Asset.findById(req.params.id);

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Check permissions
    if (req.user!.role !== UserRole.SYSTEM_ADMIN &&
        asset.uploadedBy.toString() !== req.user!._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only the uploader or system admin can delete this asset'
      });
    }

    // Delete file from filesystem
    if (fs.existsSync(asset.path)) {
      fs.unlinkSync(asset.path);
    }

    // Delete record from database
    await Asset.findByIdAndDelete(req.params.id);

    // Log deletion
    await logAudit({
      action: AuditAction.ASSET_DELETED,
      userId: req.user!._id,
      targetType: 'Asset',
      targetId: asset._id,
      req
    });

    res.json({
      success: true,
      message: 'Asset deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting asset:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting asset'
    });
  }
});

export default router;
