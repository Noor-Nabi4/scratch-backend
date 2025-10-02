import express from 'express';
import { authenticate, requireStaff, AuthRequest } from '../middleware/auth';
import { validate, schemas } from '../middleware/validation';
import { playService } from '../services/playService';
import { createError } from '../middleware/errorHandler';

const router = express.Router();

// Search play by code or phone
router.get('/play/search', authenticate, requireStaff, async (req: AuthRequest, res, next) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      throw createError('Search query is required.', 400);
    }

    const plays = await playService.searchPlay(query as string);

    res.json({
      success: true,
      data: plays
    });
  } catch (error) {
    next(error);
  }
});

// Get play details
router.get('/play/:playId', authenticate, requireStaff, async (req: AuthRequest, res, next) => {
  try {
    const { playId } = req.params;
    
    if (!playId) {
      throw createError('Play ID is required.', 400);
    }

    const play = await playService.getPlayStatus(playId);

    res.json({
      success: true,
      data: play
    });
  } catch (error) {
    next(error);
  }
});

// Redeem play
router.post('/play/:playId/redeem', authenticate, requireStaff, async (req: AuthRequest, res, next) => {
  try {
    const { playId } = req.params;
    const { notes } = req.body;

    const play = await playService.redeemPlay(playId, req.user!.email, notes);

    res.json({
      success: true,
      data: {
        message: 'Play redeemed successfully.',
        play
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;

