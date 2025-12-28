import express, { Request, Response } from 'express';
import { Task } from '../models/Task';
import { User } from '../models/User';

const router = express.Router();

/**
 * Verify Canva webhook signature
 * In production, implement proper HMAC verification
 */
function verifyCanvaWebhookSignature(signature: string | undefined, body: any): boolean {
  // In production, implement proper signature verification:
  // const webhookSecret = process.env.CANVA_WEBHOOK_SECRET;
  // const computedSignature = crypto
  //   .createHmac('sha256', webhookSecret)
  //   .update(JSON.stringify(body))
  //   .digest('hex');
  // return signature === computedSignature;

  // For demo, always return true
  return true;
}

/**
 * @route   POST /api/webhooks/canva
 * @desc    Handle Canva webhook events (design:publish, etc.)
 * @access  Public (validated via webhook signature in production)
 */
router.post('/canva', async (req: Request, res: Response) => {
  try {
    const { event_type, design_id, user_id, export_url, timestamp } = req.body;

    console.log('[Canva Webhook] Received event:', {
      event_type,
      design_id,
      user_id,
      timestamp,
      has_export_url: !!export_url
    });

    // Validate required fields
    if (!event_type || !design_id) {
      console.error('[Canva Webhook] Missing required fields:', req.body);
      return res.status(400).json({
        success: false,
        message: 'Missing required webhook fields',
        error: 'INVALID_WEBHOOK_PAYLOAD'
      });
    }

    // In production, verify the webhook signature here
    const signature = req.headers['x-canva-signature'] as string;
    if (!verifyCanvaWebhookSignature(signature, req.body)) {
      console.error('[Canva Webhook] Invalid signature');
      return res.status(401).json({
        success: false,
        message: 'Invalid webhook signature',
        error: 'INVALID_SIGNATURE'
      });
    }

    // Handle design:publish event
    if (event_type === 'design:publish') {
      console.log(`[Canva Webhook] Processing design:publish for design ${design_id}`);

      // Find the task associated with this Canva design
      const task = await Task.findOne({ canvaDesignId: design_id });

      if (!task) {
        console.warn(`[Canva Webhook] No task found for Canva design: ${design_id}`);
        return res.status(404).json({
          success: false,
          message: 'Task not found for this design',
          error: 'TASK_NOT_FOUND'
        });
      }

      console.log(`[Canva Webhook] Found task ${task._id} for design ${design_id}`);

      // In production, you would:
      // 1. Download the exported design from export_url
      // 2. Upload to your S3 bucket
      // 3. Update the task with the new S3 URL
      // Example:
      // if (export_url) {
      //   const imageBuffer = await downloadImage(export_url);
      //   const s3Url = await uploadTaskImage({ buffer: imageBuffer, mimetype: 'image/png' });
      //   task.designedImage = s3Url;
      // }

      // For demo, we'll just update the designedImage with the export URL
      if (export_url) {
        const oldImage = task.designedImage;
        task.designedImage = export_url;
        await task.save();

        console.log(`[Canva Webhook] Task ${task._id} updated:`, {
          oldImage,
          newImage: export_url
        });
      } else {
        console.warn(`[Canva Webhook] No export_url provided for design ${design_id}`);
      }

      return res.json({
        success: true,
        message: 'Webhook processed successfully',
        taskId: task._id,
        updated: !!export_url
      });
    }

    // Handle other event types as needed
    console.log(`[Canva Webhook] Unhandled event type: ${event_type}`);
    res.json({
      success: true,
      message: 'Webhook received but no action taken',
      event_type
    });
  } catch (error: any) {
    console.error('[Canva Webhook] Error processing webhook:', {
      message: error.message,
      stack: error.stack,
      body: req.body
    });
    res.status(500).json({
      success: false,
      message: 'Error processing webhook. Please try again.',
      error: error.message || 'INTERNAL_SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

export default router;
