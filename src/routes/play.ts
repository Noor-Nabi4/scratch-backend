import express from 'express';
import { playService } from '../services/playService';
import { tokenService } from '../services/tokenService';
import { validate, schemas } from '../middleware/validation';
import { createError } from '../middleware/errorHandler';

const router = express.Router();

// Validate token
router.post('/validate-token', async (req, res, next) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      throw createError('Token is required.', 400);
    }

    const validation = await tokenService.validateToken(token);

    res.json({
      success: true,
      data: validation
    });
  } catch (error) {
    next(error);
  }
});

// Claim token and play
router.post('/claim', validate(schemas.playClaim), async (req, res, next) => {
  try {
    const result = await playService.claimTokenAndPlay({
      ...req.body,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// Get play status
router.get('/:playId/status', async (req, res, next) => {
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

export default router;

