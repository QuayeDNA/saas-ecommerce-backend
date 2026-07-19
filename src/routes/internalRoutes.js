import express from 'express';
import { authenticateCrossAppKey } from '../middlewares/authenticateCrossAppKey.js';

const router = express.Router();

router.get('/verify', authenticateCrossAppKey, (req, res) => {
  res.json({ verified: true, message: 'Integration key is valid' });
});

export default router;
