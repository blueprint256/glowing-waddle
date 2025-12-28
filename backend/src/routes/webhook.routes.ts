import express, { Request, Response } from 'express';
import { Task } from '../models/Task';
import { User } from '../models/User';

const router = express.Router();

/**
 * @route   POST /api/webhooks/canva
 * @desc    Handle Canva webhook events (design:publish, etc.)
 * @access  Public (validated via webhook signature in production)
 */
router.post('/canva', async (req: Request, res: Response) => {
  try {
    const { event_type, design_id, user_id, export_url, timestamp } = req.body;

    console.log('Canva webhook received:', { event_type, design_id, user_id, timestamp });

    // In production, verify the webhook signature here
    // const signature = req.headers['x-canva-signature'];
    // if (!verifyCanvaSignature(signature, req.body)) {
    //   return res.status(401).json({ success: false, message: 'Invalid signature' });
    // }

    // Handle design:publish event
    if (event_type === 'design:publish') {
      // Find the task associated with this Canva design
      const task = await Task.findOne({ canvaDesignId: design_id });

      if (!task) {
        console.warn(`No task found for Canva design: ${design_id}`);
        return res.status(404).json({
          success: false,
          message: 'Task not found for this design'
        });
      }

      // In production, you would:
      // 1. Download the exported design from export_url
      // 2. Upload to your S3 bucket
      // 3. Update the task with the new S3 URL

      // For demo, we'll just update the designedImage with the export URL
      if (export_url) {
        task.designedImage = export_url;
        await task.save();

        console.log(`Task ${task._id} updated with new design from Canva`);
      }

      return res.json({
        success: true,
        message: 'Webhook processed successfully',
        taskId: task._id
      });
    }

    // Handle other event types as needed
    res.json({
      success: true,
      message: 'Webhook received but no action taken'
    });
  } catch (error: any) {
    console.error('Canva webhook error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error processing webhook'
    });
  }
});

export default router;
