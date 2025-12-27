import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Asset, AssetType } from '../models/Asset';
import { Task } from '../models/Task';
import { Project } from '../models/Project';
import { Campaign } from '../models/Campaign';
import { UserRole } from '../models/User';
import { isAuthenticated } from '../middleware/auth';
import { canManageTasks } from '../middleware/rbac';
import { logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import { uploadToS3, deleteFromS3, getSignedDownloadUrl } from '../utils/s3Service';
import mongoose from 'mongoose';

const router = express.Router();

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

// Configure multer for S3 uploads (using memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
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
 * @access  Private (System Admin, Hybrid)
 */
router.post('/', isAuthenticated, canManageTasks, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { taskId, projectId, campaignId } = req.body;

    // At least one association is required
    if (!taskId && !projectId && !campaignId) {
      return res.status(400).json({
        success: false,
        message: 'Asset must be associated with a task, project, or campaign'
      });
    }

    // CRITICAL: Verify ownership through parent campaign (Hybrid users only)
    if (req.user!.role === UserRole.HYBRID) {
      let targetCampaignId = null;

      if (taskId) {
        const task = await Task.findById(taskId);
        if (!task) {
          return res.status(404).json({
            success: false,
            message: 'Task not found'
          });
        }
        targetCampaignId = task.campaignId;
      } else if (projectId) {
        const project = await Project.findById(projectId);
        if (!project) {
          return res.status(404).json({
            success: false,
            message: 'Project not found'
          });
        }
        targetCampaignId = project.campaignId;
      } else if (campaignId) {
        targetCampaignId = new mongoose.Types.ObjectId(campaignId);
      }

      // Check campaign ownership
      const campaign = await Campaign.findById(targetCampaignId);
      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }

      if (campaign.createdBy.toString() !== req.user!._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only upload assets to resources under campaigns you created'
        });
      }
    }

    // Upload to S3
    const { location, key } = await uploadToS3(req.file, 'assets');

    // Create asset record
    const asset = await Asset.create({
      filename: key.split('/').pop() || req.file.originalname,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      type: getAssetType(req.file.mimetype),
      path: key,
      location,
      taskId: taskId ? new mongoose.Types.ObjectId(taskId) : undefined,
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
    console.error('Error uploading asset:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error uploading asset'
    });
  }
});

/**
 * @route   GET /api/assets
 * @desc    Get assets (filtered by task/project/campaign)
 * @access  Private
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    let query: any = {};

    if (req.query.taskId) {
      query.taskId = req.query.taskId;
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

    // If location exists (S3 URL), redirect to it or generate signed URL
    if (asset.location) {
      // For private S3 buckets, generate signed URL
      try {
        const signedUrl = await getSignedDownloadUrl(asset.path);
        res.redirect(signedUrl);
      } catch (error) {
        // If signed URL fails, try direct location (for public buckets)
        res.redirect(asset.location);
      }
    } else {
      // Fallback for local storage (if path is local file)
      if (fs.existsSync(asset.path)) {
        res.download(asset.path, asset.originalName);
      } else {
        return res.status(404).json({
          success: false,
          message: 'File not found'
        });
      }
    }
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
 * @access  Private (System Admin, Hybrid)
 */
router.delete('/:id', isAuthenticated, canManageTasks, async (req: Request, res: Response) => {
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

    // Delete file from S3 or local filesystem
    if (asset.location) {
      // S3 file
      try {
        await deleteFromS3(asset.path);
      } catch (error) {
        console.error('Error deleting from S3:', error);
        // Continue with database deletion even if S3 deletion fails
      }
    } else if (fs.existsSync(asset.path)) {
      // Local file
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
